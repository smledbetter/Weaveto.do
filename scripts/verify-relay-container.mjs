#!/usr/bin/env node
/**
 * Build the relay image, start it, and prove the running container serves the
 * current relay.
 *
 * This check exists because the relay silently ran a stale build in production.
 * server/Dockerfile copied server/relay.ts and nothing else, so once relay.ts
 * started importing ./vapid.js the image could no longer resolve its own
 * imports and exited at startup. Nothing in CI ever started the container, so
 * the failure showed up only as a production relay that never advanced.
 *
 * The probe is GET /vapid-key, and it has to inspect the body rather than the
 * status code: the relay answers every unmatched path with a 200 and the
 * literal text "OK", so a status-only health check passes against a broken
 * build. An image that predates the VAPID endpoint returns "OK" here. A current
 * one returns JSON.
 *
 * Usage:
 *   node scripts/verify-relay-container.mjs
 *   node scripts/verify-relay-container.mjs --selftest   # prove the check bites
 *   node scripts/verify-relay-container.mjs --keep       # leave the container up
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const SELFTEST = args.includes("--selftest");
const dockerfileArg = args.indexOf("--dockerfile");
const DOCKERFILE = dockerfileArg === -1 ? "server/Dockerfile" : args[dockerfileArg + 1];

const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

/**
 * The Dockerfile as it stood when the relay stopped deploying: it copies
 * relay.ts and nothing beside it, so the image cannot resolve ./vapid.js.
 * Kept here as a known-bad fixture so --selftest can confirm this script still
 * detects the exact failure it was written for. A check nobody has watched fail
 * is not yet evidence of anything.
 */
const PRE_M16_DOCKERFILE = `FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/relay.ts ./server/relay.ts
COPY tsconfig.json ./
RUN npx tsx --version
EXPOSE 3001
CMD ["npx", "tsx", "server/relay.ts"]
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...opts });
}

/** Resolve the host port Docker assigned to the container's 3001. */
function hostPort(name) {
  const r = docker(["port", name, "3001/tcp"]);
  if (r.status !== 0) return null;
  const match = /:(\d+)\s*$/m.exec(r.stdout.trim());
  return match ? Number(match[1]) : null;
}

function containerRunning(name) {
  const r = docker(["inspect", "-f", "{{.State.Running}}", name]);
  return r.status === 0 && r.stdout.trim() === "true";
}

function containerLogs(name) {
  const r = docker(["logs", name]);
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || "(no container output)";
}

/**
 * Poll until the relay answers, the container dies, or the timeout expires.
 * A container that exits during startup is reported at once with its output,
 * because that is the exact failure this check was written to catch.
 */
async function waitForRelay(name, port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!containerRunning(name)) {
      return { ok: false, reason: "the container exited during startup" };
    }
    try {
      return { ok: true, res: await fetch(`http://127.0.0.1:${port}/vapid-key`) };
    } catch {
      await sleep(POLL_INTERVAL_MS);
    }
  }
  return { ok: false, reason: `the relay did not answer within ${STARTUP_TIMEOUT_MS} ms` };
}

/** Confirm the relay completes a WebSocket handshake, which is its actual job. */
function checkWebSocketUpgrade(port) {
  return new Promise((resolve) => {
    const req = request({
      host: "127.0.0.1",
      port,
      // The relay upgrades only on /room/{32 hex}. Anything else is a 400.
      path: `/room/${"0".repeat(31)}1`,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        Origin: "http://localhost:5173",
      },
    });
    const done = (result) => {
      req.destroy();
      resolve(result);
    };
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      done({ ok: res.statusCode === 101, statusCode: res.statusCode });
    });
    req.on("response", (res) => done({ ok: false, statusCode: res.statusCode }));
    req.on("error", (err) => done({ ok: false, statusCode: `error: ${err.message}` }));
    req.setTimeout(10_000, () => done({ ok: false, statusCode: "timed out" }));
    req.end();
  });
}

/**
 * Build and probe one Dockerfile.
 * Returns { ok, reason, details } — it never exits, so --selftest can assert on
 * a failure without taking the process down with it.
 */
async function runCheck(dockerfile, { quiet = false } = {}) {
  // A unique tag and name per run, so concurrent jobs cannot collide and a
  // stale image can never satisfy the check.
  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const tag = `weaveto-relay-verify:${stamp}`;
  const name = `weaveto-relay-verify-${stamp}`;

  try {
    try {
      execFileSync("docker", ["build", "-f", dockerfile, "-t", tag, "."], {
        cwd: ROOT,
        stdio: quiet ? "ignore" : "inherit",
      });
    } catch {
      return { ok: false, reason: `the image did not build from ${dockerfile}` };
    }

    // An ephemeral loopback port, so parallel CI jobs cannot collide.
    const run = docker(["run", "-d", "--name", name, "-p", "127.0.0.1::3001", tag], { cwd: ROOT });
    if (run.status !== 0) {
      return { ok: false, reason: "the container did not start", details: run.stderr };
    }

    const port = hostPort(name);
    if (!port) {
      return {
        ok: false,
        reason: "could not resolve the published host port",
        details: containerLogs(name),
      };
    }

    const waited = await waitForRelay(name, port);
    if (!waited.ok) {
      return {
        ok: false,
        reason: waited.reason,
        details: `Container output:\n${containerLogs(name)}`,
      };
    }

    const res = waited.res;
    const body = (await res.text()).trim();

    if (res.status !== 200) {
      return { ok: false, reason: `GET /vapid-key returned ${res.status}, expected 200`, details: body };
    }

    // The load-bearing assertion. "OK" is the relay's catch-all for an
    // unmatched path, so receiving it here means the image predates the
    // /vapid-key endpoint and is not built from the current relay.ts.
    if (body === "OK") {
      return {
        ok: false,
        reason: 'GET /vapid-key returned the catch-all "OK" instead of JSON',
        details:
          "The running image predates the /vapid-key endpoint, so the container\n" +
          "is not built from the current server/relay.ts.",
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, reason: "GET /vapid-key did not return JSON", details: body.slice(0, 200) };
    }

    if (typeof parsed.publicKey !== "string" || parsed.publicKey.length === 0) {
      return {
        ok: false,
        reason: "GET /vapid-key returned JSON without a publicKey string",
        details: body.slice(0, 200),
      };
    }

    const ws = await checkWebSocketUpgrade(port);
    if (!ws.ok) {
      return {
        ok: false,
        reason: `the WebSocket handshake returned ${ws.statusCode}, expected 101`,
        details: containerLogs(name),
      };
    }

    return { ok: true, contentType: res.headers.get("content-type"), publicKey: parsed.publicKey };
  } finally {
    if (KEEP) {
      console.log(`\n--keep: container ${name} and image ${tag} left in place.`);
    } else {
      docker(["rm", "-f", name], { stdio: "ignore" });
      docker(["image", "rm", "-f", tag], { stdio: "ignore" });
    }
  }
}

/**
 * Prove this script fails against the Dockerfile that shipped the stale relay.
 * If the known-bad fixture passes, the check has lost its teeth and is worse
 * than no check at all, because it reports safety it is not measuring.
 */
async function selftest() {
  const dir = mkdtempSync(join(tmpdir(), "weaveto-relay-selftest-"));
  const fixture = join(dir, "Dockerfile.pre-m16");
  writeFileSync(fixture, PRE_M16_DOCKERFILE);

  console.log("Selftest: running the check against the pre-M16 one-file Dockerfile ...");
  const result = await runCheck(fixture, { quiet: true });

  if (result.ok) {
    console.error(
      "\nFAIL: the check passed against the known-bad Dockerfile.\n" +
        "  That Dockerfile copies relay.ts without vapid.ts, so the container\n" +
        "  cannot start. A check that accepts it is not detecting the regression\n" +
        "  it exists to catch."
    );
    return false;
  }

  console.log(`  rejected as expected: ${result.reason}`);
  console.log("  PASS: the check detects the regression that shipped the stale relay.\n");
  return true;
}

async function main() {
  if (SELFTEST && !(await selftest())) return false;

  console.log(`Building ${DOCKERFILE} ...`);
  const result = await runCheck(DOCKERFILE);

  if (!result.ok) {
    console.error(`\nFAIL: ${result.reason}.`);
    if (result.details) console.error(result.details);
    return false;
  }

  console.log(`  GET /vapid-key -> 200 ${result.contentType}`);
  console.log(`  publicKey: ${result.publicKey.slice(0, 16)}... (${result.publicKey.length} chars)`);
  console.log(`  WebSocket /room/{id} -> 101 Switching Protocols`);
  console.log("\nPASS: the relay container builds, starts, and serves the current build.");
  return true;
}

if (!(await main())) process.exitCode = 1;
