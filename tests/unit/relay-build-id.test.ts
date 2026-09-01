// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeRelayBuildId,
  relaySourceFiles,
  selectSourceFiles,
  RELAY_BUILD_HEADER,
  RELAY_SOURCE_DIR,
  SOURCE_EXTENSIONS,
} from "../../server/build-id";
import { checkRelayIsCurrent, RELAY_URL } from "../e2e/utils/relay-build";

/**
 * A local E2E run must not be able to test a relay that is not on disk.
 *
 * The relay has no hot reload, and playwright.config.ts reuses whatever is
 * already listening on 3001. A relay started before an edit therefore serves
 * the old code to every later run. The full local suite passed 270 tests that
 * way, against a rate-limit change that had broken bulk task creation. CI
 * caught it because CI always starts fresh.
 *
 * The guard is a fingerprint the relay reports and the run re-computes. These
 * tests reproduce the failure literally: they start a real relay from the real
 * server directory, then change that directory while it runs, which is what a
 * developer does when they edit relay.ts with a relay already up.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A real file added to the real source directory, then removed.
 *
 * A copy of the tree in a temp directory would prove nothing: the fingerprint
 * the run compares against is computed from this directory, so the mutation
 * has to land here. Cleanup runs in a finally and at start-up, and the name is
 * in .gitignore, so a crash cannot leave anything committable behind.
 */
const PROBE = join(RELAY_SOURCE_DIR, "__stale_relay_probe__.ts");

function writeProbe(marker: string): void {
  writeFileSync(PROBE, `export const STALE_RELAY_PROBE = ${JSON.stringify(marker)};\n`);
}

function removeProbe(): void {
  rmSync(PROBE, { force: true });
}

/** Ask the OS for a port nothing is using, then hand it to the relay. */
async function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    await res.text();
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
}

/**
 * Start the real relay on a scratch port.
 *
 * VITEST has to be stripped from the child environment. server/relay.ts skips
 * its own bootstrap when that variable is set, so an inherited value gives a
 * process that never listens.
 */
async function startRelay(port: number): Promise<ChildProcess> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(port),
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST")) delete env[key];
  }
  // detached puts the relay in its own process group, which is what makes
  // stopRelay able to take the whole tree down.
  const child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["server/relay.ts"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
    detached: true,
  });
  await waitFor(() => answers(`http://127.0.0.1:${port}/`), 30_000, "the relay to start");
  return child;
}

/**
 * Stop the relay and everything tsx started beneath it.
 *
 * tsx runs the relay in a grandchild process, so killing the direct child
 * leaves a relay listening forever. One leaked relay per test run is the same
 * class of problem this file exists to prevent, so the wait is an assertion:
 * a relay still answering after the kill fails the suite.
 */
async function stopRelay(child: ChildProcess, url: string): Promise<void> {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL"); // negative pid means the group
    } catch {
      // already gone
    }
  }
  await waitFor(async () => !(await answers(url)), 8_000, "the relay to stop");
}

describe("what the fingerprint covers", () => {
  it("covers every source file in the relay source directory", () => {
    // Scanned, not listed, so this reads the directory the same way. The
    // assertion that matters is the second one: the files the relay actually
    // loads are all inside the scan.
    const onDisk = readdirSync(RELAY_SOURCE_DIR)
      .filter((n) => SOURCE_EXTENSIONS.some((ext) => n.endsWith(ext)))
      .sort();
    expect(relaySourceFiles()).toEqual(onDisk);
    expect(relaySourceFiles()).toEqual(
      expect.arrayContaining(["build-id.ts", "push-types.ts", "relay.ts", "vapid.ts"]),
    );
  });

  it("loads nothing from outside the directory it fingerprints", () => {
    // The blind spot to fear. If relay.ts starts importing ../src/lib/x.ts,
    // the fingerprint stops describing the running code and the guard goes
    // quiet without failing, which is the failure mode it exists to remove.
    for (const name of relaySourceFiles()) {
      const source = readFileSync(join(RELAY_SOURCE_DIR, name), "utf8");
      for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']*)["']/g)) {
        const specifier = match[1];
        expect(
          specifier.startsWith("../"),
          `${name} imports ${specifier}, which is outside the fingerprinted directory`,
        ).toBe(false);
        // Compared without the extension. The relay imports "./vapid.js" and
        // that resolves to vapid.ts today, or to vapid.js after a precompile.
        const strip = (f: string) => f.replace(/\.(ts|js|mjs|cjs)$/, "");
        const target = strip(specifier.replace(/^\.\//, ""));
        expect(
          relaySourceFiles().map(strip),
          `${name} imports ${specifier}`,
        ).toContain(target);
      }
    }
  });
});

describe("a fingerprint over nothing", () => {
  /**
   * SHA-256 of the empty input.
   *
   * If the scan ever matches no files, this is what every side computes. The
   * relay would report it, the run would expect it, they would agree, and the
   * guard would pass against any relay including the stale one. It is the
   * failure this whole file exists to prevent, arrived at from the other end.
   */
  const EMPTY_DIGEST =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("is refused rather than returned", () => {
    expect(() => selectSourceFiles([])).toThrow(/fingerprint/i);
    expect(() => selectSourceFiles(["Dockerfile", "README.md"])).toThrow();
  });

  it("never comes back from the real directory", () => {
    expect(computeRelayBuildId()).not.toBe(EMPTY_DIGEST);
  });

  it("does not happen when the relay is precompiled to JavaScript", () => {
    // server/Dockerfile weighs dropping tsx and shipping compiled JS. That
    // removes every .ts file from this directory. A scan matching only .ts
    // would return nothing and agree with itself forever, so the change that
    // reads as a cleanup would disarm the guard while every run stayed green.
    expect(selectSourceFiles(["Dockerfile", "relay.js", "vapid.js"])).toEqual([
      "relay.js",
      "vapid.js",
    ]);
    expect(selectSourceFiles(["relay.mjs"])).toEqual(["relay.mjs"]);
  });
});

describe("the fingerprint responds to a source change", () => {
  beforeAll(removeProbe);
  afterAll(removeProbe);

  it("changes when a covered file's contents change", () => {
    // The property that makes the guard work at all. A fingerprint over file
    // names alone would still change when a file is added, so the added-file
    // test below can pass while an in-place edit stays invisible. That is the
    // real scenario: someone edits relay.ts.
    try {
      writeProbe("first");
      const first = computeRelayBuildId();
      writeProbe("second");
      const second = computeRelayBuildId();
      expect(second).not.toBe(first);
    } finally {
      removeProbe();
    }
  });

  it("changes when a covered file is added or removed", () => {
    const before = computeRelayBuildId();
    try {
      writeProbe("added");
      expect(computeRelayBuildId()).not.toBe(before);
    } finally {
      removeProbe();
    }
    expect(computeRelayBuildId()).toBe(before);
  });

  it("changes when a covered file is renamed", () => {
    const other = join(RELAY_SOURCE_DIR, "__stale_relay_probe_renamed__.ts");
    try {
      writeProbe("same bytes");
      const first = computeRelayBuildId();
      writeFileSync(other, readFileSync(PROBE));
      removeProbe();
      expect(computeRelayBuildId()).not.toBe(first);
    } finally {
      removeProbe();
      rmSync(other, { force: true });
    }
  });
});

describe("a running relay against a changed tree", () => {
  let child: ChildProcess | null = null;
  let url = "";

  /**
   * The probe is written before the relay starts, so its contents are part of
   * the fingerprint the relay reads at boot. Rewriting it afterwards is an
   * in-place edit to a file the running process was built from. That is the
   * failure verbatim: the developer edits, the relay does not notice, and the
   * suite reports on code that was replaced.
   */
  const AT_BOOT = "as the relay booted";

  beforeAll(async () => {
    writeProbe(AT_BOOT);
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    child = await startRelay(port);
  }, 60_000);

  afterAll(async () => {
    removeProbe();
    if (child) await stopRelay(child, `${url}/`);
  });

  it("accepts a relay started from the current tree", async () => {
    const result = await checkRelayIsCurrent(url);
    expect(result).toEqual({ current: true, buildId: computeRelayBuildId() });
  });

  it("reports the fingerprint on the liveness path the E2E suite polls", async () => {
    const res = await fetch(`${url}/`);
    await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get(RELAY_BUILD_HEADER)).toBe(computeRelayBuildId());
  });

  it("rejects the same relay once a covered file is edited in place", async () => {
    // The relay is still healthy and still answers 200. It is simply not
    // running what is on disk any more, and only the fingerprint says so.
    try {
      writeProbe("edited while the relay was up");
      const result = await checkRelayIsCurrent(url);
      expect(result.current).toBe(false);
      if (result.current) return;
      expect(result.reason).toContain("no longer on disk");
      expect(result.detail).toContain(computeRelayBuildId().slice(0, 12));
    } finally {
      writeProbe(AT_BOOT);
    }
  });

  it("rejects the same relay once a covered file is added", async () => {
    const added = join(RELAY_SOURCE_DIR, "__stale_relay_probe_added__.ts");
    try {
      writeFileSync(added, "export const ADDED = true;\n");
      const result = await checkRelayIsCurrent(url);
      expect(result.current).toBe(false);
    } finally {
      rmSync(added, { force: true });
    }
  });

  it("accepts it again once the tree is put back", async () => {
    const result = await checkRelayIsCurrent(url);
    expect(result.current).toBe(true);
  });
});

describe("a relay that reports no fingerprint", () => {
  let server: Server | null = null;
  let url = "";

  beforeAll(async () => {
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("OK");
    });
    await new Promise<void>((r) => server!.listen(port, "127.0.0.1", r));
  });

  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it("is rejected, because a relay predating the header is stale by definition", async () => {
    // A 200 and the literal "OK" is what every relay built before this guard
    // answers. Liveness alone cannot tell it from a current one.
    const result = await checkRelayIsCurrent(url);
    expect(result.current).toBe(false);
    if (result.current) return;
    expect(result.reason).toContain(RELAY_BUILD_HEADER);
  });
});

describe("the guard is wired into the E2E run", () => {
  it("every config that starts the relay runs the check", () => {
    // Found on disk, not listed here. Both configs reuse an existing relay,
    // so both can measure one that is no longer on disk, and a third added
    // later would inherit the same hole silently.
    const configs = readdirSync(ROOT).filter((n) =>
      /^playwright.*\.config\.ts$/.test(n),
    );
    expect(configs.length).toBeGreaterThan(1);

    const starters = configs.filter((name) =>
      /command:\s*['"]npm run relay['"]/.test(readFileSync(join(ROOT, name), "utf8")),
    );
    expect(starters, "no Playwright config starts the relay").not.toEqual([]);

    for (const name of starters) {
      expect(
        readFileSync(join(ROOT, name), "utf8"),
        `${name} starts the relay without the freshness check`,
      ).toMatch(/globalSetup:\s*['"]\.\/tests\/e2e\/global-setup\.ts['"]/);
    }
  });

  it("checks the port those configs actually use", () => {
    // The guard probes a URL of its own. If a relay webServer entry moved to
    // another port, the guard would probe an empty one and report "did not
    // answer" forever, which is loud but useless.
    let checked = 0;
    for (const name of readdirSync(ROOT).filter((n) =>
      /^playwright.*\.config\.ts$/.test(n),
    )) {
      const src = readFileSync(join(ROOT, name), "utf8");
      for (const m of src.matchAll(
        /command:\s*['"]npm run relay['"],\s*\n\s*url:\s*['"]([^'"]+)['"]/g,
      )) {
        expect(m[1], `${name} points the relay at another port`).toBe(RELAY_URL);
        checked++;
      }
    }
    expect(checked, "no relay webServer entry found").toBeGreaterThan(0);
  });

  it("the global setup asserts the relay is current", () => {
    const setup = readFileSync(join(ROOT, "tests/e2e/global-setup.ts"), "utf8");
    expect(setup).toContain("assertRelayIsCurrent");
  });

  it("leaves no probe file behind", () => {
    // These tests write into the relay's own source directory, so a leak would
    // change the fingerprint of every later run.
    const leftovers = readdirSync(RELAY_SOURCE_DIR).filter((n) =>
      n.startsWith("__stale_relay_probe"),
    );
    expect(leftovers).toEqual([]);
  });
});
