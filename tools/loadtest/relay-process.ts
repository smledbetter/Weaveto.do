/**
 * Spawn and measure a local relay process.
 *
 * The relay source is never modified. The preload hook in relay-hook.mjs is
 * attached through NODE_OPTIONS, and every behaviour it adds is opt-in.
 */

import { spawn, execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parsePsRss } from "./metrics.js";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const HOOK_PATH = path.join(HERE, "relay-hook.mjs");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

export interface RelayOptions {
  port: number;
  statusPort: number;
  ipSpread: boolean;
  ipPerAddr: number;
  /** Echo the relay's stdout and stderr. Useful when a run misbehaves. */
  verbose: boolean;
  /** Port of a local push stub. Set only by the push profile. */
  pushStubPort?: number;
}

export interface SpawnedRelay {
  mode: "spawned";
  child: ChildProcess;
  /** The process actually listening on the port, which may be a tsx grandchild. */
  listeningPid: number | null;
  options: RelayOptions;
}

/**
 * A relay the harness did not start, for example one inside a container.
 *
 * `rssCommand` is a shell command that prints a memory figure in kibibytes, in
 * the same format `ps -o rss=` uses, so the tested parser handles both. For a
 * container the natural source is the cgroup's memory.current, which is the
 * figure a memory limit is enforced against.
 */
export interface AttachedRelay {
  mode: "attached";
  label: string;
  statusUrl: string | null;
  rssCommand: string | null;
  /**
   * A shell command printing the memory high-water mark in kibibytes.
   *
   * Step sampling reads memory between bursts and misses what happens inside
   * one. Under fan-out the relay buffers outbound frames per socket, and the
   * spike lives and dies between two samples, so a run can report a calm
   * figure while having briefly used several times that. For a container the
   * source is the cgroup's memory.peak.
   */
  peakCommand: string | null;
}

export type RelayHandle = SpawnedRelay | AttachedRelay;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function attachRelay(opts: {
  label: string;
  healthUrl: string;
  statusUrl: string | null;
  rssCommand: string | null;
  peakCommand: string | null;
}): Promise<AttachedRelay> {
  await waitForHttp(opts.healthUrl, 30_000);
  return {
    mode: "attached",
    label: opts.label,
    statusUrl: opts.statusUrl,
    rssCommand: opts.rssCommand,
    peakCommand: opts.peakCommand,
  };
}

/** Read the memory high-water mark, in bytes, or null when no source is configured. */
export async function samplePeakMemory(handle: RelayHandle): Promise<number | null> {
  if (handle.mode !== "attached" || handle.peakCommand === null) return null;
  try {
    const { stdout } = await execFileAsync("bash", ["-c", handle.peakCommand]);
    return parsePsRss(stdout);
  } catch {
    return null;
  }
}

export async function startRelay(options: RelayOptions): Promise<SpawnedRelay> {
  // LOADTEST_EXTRA_NODE_OPTIONS lets a run reshape the relay's V8 configuration
  // without touching relay.ts. It is how the "fly-shaped heap" sensitivity run
  // is done: V8 sizes its default heap from host memory, so a 32 GB laptop and
  // a 1 GB machine do not give Node the same starting point.
  const nodeOptions = [
    process.env.NODE_OPTIONS ?? "",
    `--import ${pathToFileURL(HOOK_PATH).href}`,
    "--expose-gc",
    process.env.LOADTEST_EXTRA_NODE_OPTIONS ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const child = spawn(process.execPath, [TSX_CLI, path.join("server", "relay.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(options.port),
      NODE_OPTIONS: nodeOptions,
      LOADTEST_IP_SPREAD: options.ipSpread ? "1" : "0",
      LOADTEST_IP_PER_ADDR: String(options.ipPerAddr),
      LOADTEST_STATUS_PORT: String(options.statusPort),
      // Only set when a profile runs a push stub. The hook is a no-op
      // without it, so an ordinary run makes real outbound requests or none.
      ...(options.pushStubPort !== undefined
        ? { LOADTEST_PUSH_STUB: String(options.pushStubPort) }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  if (options.verbose) {
    child.stdout?.on("data", (d: string) => process.stderr.write(`[relay] ${d}`));
    child.stderr?.on("data", (d: string) => process.stderr.write(`[relay!] ${d}`));
  } else {
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", (d: string) => {
      if (/error|Error|ERR_/.test(d)) process.stderr.write(`[relay!] ${d}`);
    });
  }

  await waitForHttp(`http://127.0.0.1:${options.port}/`, 30_000);
  const listeningPid = await resolveListeningPid(options.port);
  return { mode: "spawned", child, listeningPid, options };
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        await res.text();
        return;
      }
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(200);
  }
  throw new Error(`relay did not answer ${url} within ${timeoutMs}ms: ${lastError}`);
}

/** Find the pid holding the listening socket. tsx runs the script in a child. */
async function resolveListeningPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    const pids = stdout
      .trim()
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n));
    return pids.length > 0 ? pids[pids.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Every pid in the relay's process tree, root included.
 *
 * The fly image runs `npx tsx server/relay.ts`, so production carries a
 * launcher process alongside the one that serves traffic. Both count against
 * the machine's 1 GB, so the harness reports the tree total as well as the
 * serving process on its own.
 */
export async function collectTreePids(rootPid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,ppid="]);
    const children = new Map<number, number[]>();
    for (const line of stdout.trim().split("\n")) {
      const [pidStr, ppidStr] = line.trim().split(/\s+/);
      const pid = parseInt(pidStr, 10);
      const ppid = parseInt(ppidStr, 10);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      const list = children.get(ppid) ?? [];
      list.push(pid);
      children.set(ppid, list);
    }
    const out: number[] = [];
    const stack = [rootPid];
    while (stack.length > 0) {
      const pid = stack.pop() as number;
      if (out.includes(pid)) continue;
      out.push(pid);
      stack.push(...(children.get(pid) ?? []));
    }
    return out;
  } catch {
    return [rootPid];
  }
}

export interface MemorySample {
  /** RSS in bytes of the process serving the port, read externally with `ps`. */
  psRssBytes: number | null;
  /**
   * Total memory for the whole relay, however the configured source reports it.
   *
   * Two different things land in this field, and they are not comparable:
   *
   * - Spawned mode sums `ps` RSS across the process tree. RSS counts the shared
   *   Node binary and its libraries once per process, so summing OVERSTATES the
   *   footprint, by roughly the size of those mappings times (processes - 1).
   *   Do not quote a spawned-mode figure as a footprint.
   * - Attached mode reports whatever `--rss-cmd` prints. Pointed at a
   *   container's cgroup `memory.current` it charges shared pages once, which
   *   is the honest figure and the one a memory limit is enforced against.
   *
   * Prefer the attached-mode cgroup reading for any capacity claim.
   */
  treeRssBytes: number | null;
  treePidCount: number;
  /** The relay's own process.memoryUsage(), read from the hook's status port. */
  self: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  } | null;
  gcAvailable: boolean;
  syntheticAddressesHandedOut: number | null;
}

export async function sampleMemory(handle: RelayHandle, forceGc = false): Promise<MemorySample> {
  let psRssBytes: number | null = null;
  let treeRssBytes: number | null = null;
  let treePidCount = 0;
  let statusUrl: string | null = null;

  if (handle.mode === "spawned") {
    if (handle.listeningPid !== null) {
      try {
        const { stdout } = await execFileAsync("ps", [
          "-o",
          "rss=",
          "-p",
          String(handle.listeningPid),
        ]);
        psRssBytes = parsePsRss(stdout);
      } catch {
        psRssBytes = null;
      }
    }

    const rootPid = handle.child.pid;
    if (rootPid !== undefined) {
      const pids = await collectTreePids(rootPid);
      treePidCount = pids.length;
      try {
        const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", pids.join(",")]);
        let sum = 0;
        let any = false;
        for (const line of stdout.trim().split("\n")) {
          const bytes = parsePsRss(line);
          if (bytes !== null) {
            sum += bytes;
            any = true;
          }
        }
        treeRssBytes = any ? sum : null;
      } catch {
        treeRssBytes = null;
      }
    }
    if (handle.options.statusPort > 0) {
      statusUrl = `http://127.0.0.1:${handle.options.statusPort}/`;
    }
  } else {
    statusUrl = handle.statusUrl;
    if (handle.rssCommand !== null) {
      try {
        const { stdout } = await execFileAsync("bash", ["-c", handle.rssCommand]);
        // The command is expected to print kibibytes, so the same parser that
        // handles `ps -o rss=` handles it. For a container the figure covers
        // every process in the memory limit, not one process.
        treeRssBytes = parsePsRss(stdout);
      } catch {
        treeRssBytes = null;
      }
    }
  }

  let self: MemorySample["self"] = null;
  let gcAvailable = false;
  let syntheticAddressesHandedOut: number | null = null;
  if (statusUrl !== null) {
    try {
      const res = await fetch(`${statusUrl}${forceGc ? "?gc=1" : ""}`);
      if (res.ok) {
        const body = (await res.json()) as {
          memory: NonNullable<MemorySample["self"]>;
          gcAvailable: boolean;
          syntheticAddressesHandedOut: number;
        };
        self = body.memory;
        gcAvailable = body.gcAvailable;
        syntheticAddressesHandedOut = body.syntheticAddressesHandedOut;
      }
    } catch {
      self = null;
    }
  }

  // An attached relay has no external per-process view, so the relay's own
  // reading of its RSS is the best available figure for the serving process.
  if (handle.mode === "attached" && psRssBytes === null && self !== null) {
    psRssBytes = self.rss;
  }

  return { psRssBytes, treeRssBytes, treePidCount, self, gcAvailable, syntheticAddressesHandedOut };
}

export async function stopRelay(handle: RelayHandle): Promise<void> {
  // An attached relay belongs to whoever started it.
  if (handle.mode !== "spawned") return;
  if (handle.listeningPid !== null) {
    try {
      process.kill(handle.listeningPid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  handle.child.kill("SIGTERM");
  await sleep(300);
  if (!handle.child.killed) handle.child.kill("SIGKILL");
}
