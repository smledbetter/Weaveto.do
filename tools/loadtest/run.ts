/**
 * Relay load-test driver.
 *
 *   npm run loadtest -- --profile=smoke
 *   npm run loadtest -- --profile=small
 *   npm run loadtest -- --profile=full
 *   npm run loadtest -- --profile=caps
 *
 * The driver starts its own relay from server/relay.ts, ramps virtual clients
 * against it, and samples memory and round-trip latency at each step. Nothing
 * here needs the fly deployment.
 *
 * Read docs/CAPACITY.md for what the numbers mean and what they do not.
 */

import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CloseTally, shouldStopRamp, summarize, rampSteps, toMiB } from "./metrics.js";
import type { CloseCount, LatencySummary, StepResult } from "./metrics.js";
import { resolveProfile } from "./profiles.js";
import type { Profile } from "./profiles.js";
import {
  startRelay,
  attachRelay,
  stopRelay,
  sampleMemory,
  samplePeakMemory,
  REPO_ROOT,
} from "./relay-process.js";
import { RELAY_LIMITS } from "./protocol.js";
import { runCapChecks } from "./caps.js";
import { runPushChecks } from "./push.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(HERE, "worker.ts");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Worker pool ------------------------------------------------------------

interface WorkerReply {
  id: number;
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

class Worker {
  private child: ChildProcess;
  private nextId = 1;
  private waiting = new Map<number, (reply: WorkerReply) => void>();

  constructor(public readonly id: number) {
    this.child = fork(WORKER_PATH, [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    this.child.on("message", (raw) => {
      const reply = raw as WorkerReply;
      if (typeof reply.id !== "number") return;
      const resolve = this.waiting.get(reply.id);
      if (resolve) {
        this.waiting.delete(reply.id);
        resolve(reply);
      }
    });
  }

  send(cmd: string, payload: Record<string, unknown> = {}): Promise<WorkerReply> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (reply) => {
        if (reply.ok) resolve(reply);
        else reject(new Error(`worker ${this.id} ${cmd}: ${reply.error ?? "unknown error"}`));
      });
      this.child.send({ id, cmd, ...payload });
    });
  }

  kill(): void {
    this.child.kill("SIGKILL");
  }
}

// --- Argument parsing -------------------------------------------------------

interface Args {
  profile: string;
  port: number | null;
  out: string;
  verbose: boolean;
  /** Measure a relay this harness did not start, for example one in a container. */
  attach: string | null;
  statusUrl: string | null;
  rssCommand: string | null;
  peakCommand: string | null;
  label: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    profile: "small",
    port: null,
    out: path.join(os.tmpdir(), "weaveto-loadtest"),
    verbose: false,
    attach: null,
    statusUrl: null,
    rssCommand: null,
    peakCommand: null,
    label: null,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = (eq === -1 ? raw : raw.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? undefined : raw.slice(eq + 1);
    switch (key) {
      case "profile":
        args.profile = value ?? "small";
        break;
      case "port":
        args.port = parseInt(value ?? "", 10);
        break;
      case "out":
        args.out = value ?? args.out;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "attach":
        args.attach = value ?? null;
        break;
      case "status-url":
        args.statusUrl = value ?? null;
        break;
      case "rss-cmd":
        args.rssCommand = value ?? null;
        break;
      case "peak-cmd":
        args.peakCommand = value ?? null;
        break;
      case "label":
        args.label = value ?? null;
        break;
      default:
        throw new Error(`unknown argument "${raw}"`);
    }
  }
  if (args.attach !== null && !/^\d+$/.test(args.attach)) {
    throw new Error('--attach takes the relay port, for example --attach=3081');
  }
  // These profiles restart the relay themselves, between phases and with
  // different hook settings, so they cannot drive one somebody else started.
  // Accepting --attach and quietly ignoring it produced a run that looked like
  // it measured a container and did not.
  if (args.attach !== null && SELF_HOSTED_PROFILES.has(args.profile)) {
    throw new Error(
      `--profile=${args.profile} starts and restarts its own relay, so it cannot attach to one. ` +
        "Drop --attach, or use a ramp profile to measure an attached relay.",
    );
  }
  return args;
}

/** Profiles that own their relay process and therefore reject --attach. */
const SELF_HOSTED_PROFILES = new Set(["caps", "push"]);

async function portIsFree(port: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return stdout.trim() === "";
  } catch {
    // lsof exits non-zero when nothing matches.
    return true;
  }
}

/**
 * Pick the relay port.
 *
 * 3001 is the project's relay port, so it is the default. Another process on
 * this machine may already hold it (a dev relay, another agent's run), and
 * silently measuring somebody else's relay would produce a wrong number, so
 * the driver moves to a free port and says so.
 */
async function choosePort(requested: number | null): Promise<number> {
  if (requested !== null) return requested;
  if (await portIsFree(3001)) return 3001;
  for (let port = 3051; port < 3100; port++) {
    if (await portIsFree(port)) {
      console.log(`note: port 3001 is already in use, running the relay under test on ${port}`);
      return port;
    }
  }
  throw new Error("no free port found between 3001 and 3099");
}

// --- Environment record -----------------------------------------------------

async function describeHost(): Promise<Record<string, unknown>> {
  const read = async (cmd: string, cmdArgs: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync(cmd, cmdArgs);
      return stdout.trim();
    } catch {
      return "unavailable";
    }
  };
  return {
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    fileDescriptorSoftLimit: await read("bash", ["-c", "ulimit -n"]),
    listenBacklogMax: await read("sysctl", ["-n", "kern.ipc.somaxconn"]),
  };
}

// --- Run --------------------------------------------------------------------

interface RunReport {
  profile: string;
  startedAt: string;
  /** Where the relay ran. "spawned" is this host; "attached" is somewhere else. */
  relayTarget: string;
  host: Record<string, unknown>;
  relayLimits: typeof RELAY_LIMITS;
  ipSpread: { enabled: boolean; connectionsPerSyntheticAddress: number };
  port: number;
  idleMemory: {
    psRssBytes: number | null;
    treeRssBytes: number | null;
    treePidCount: number;
    selfRssBytes: number | null;
  };
  steps: StepResult[];
  stoppedEarly: string | null;
  throughput: Array<{
    ratePerPairPerSecond: number;
    pairs: number;
    /** Messages the clients sent in, per second. */
    aggregateMessagesPerSecond: number;
    /** Messages the relay sent out, which is inbound times room size minus one. */
    relayedMessagesPerSecond: number;
    sent: number;
    received: number;
    latency: LatencySummary | null;
  }>;
  teardown: {
    afterCloseRssBytes: number | null;
    afterCloseGcRssBytes: number | null;
    afterCloseHeapUsedBytes: number | null;
    afterCloseTreeRssBytes: number | null;
  };
  /** Memory high-water mark, which step sampling cannot see. */
  peakMemory: { beforeRunBytes: number | null; afterRunBytes: number | null };
  totalCloses: CloseCount[];
}

async function runRamp(profile: Profile, args: Args): Promise<RunReport> {
  const attaching = args.attach !== null;
  const port = attaching ? parseInt(args.attach as string, 10) : await choosePort(args.port);
  const statusPort = port + 1000;

  console.log(`\nprofile: ${profile.name} — ${profile.description}`);
  if (attaching) {
    console.log(
      `target: an already-running relay on port ${port} (${args.label ?? "unlabelled"}). ` +
        `This harness did not start it and will not stop it.`,
    );
  }
  console.log(
    `ramp: ${rampSteps(profile.ramp).join(" -> ")} connections, ` +
      `${profile.clientsPerRoom} clients per room, ${profile.workers} client workers`,
  );
  if (profile.ipSpread) {
    console.log(
      `note: MAX_CONNECTIONS_PER_IP (${RELAY_LIMITS.MAX_CONNECTIONS_PER_IP}) is bypassed by the ` +
        `preload hook so a single host can exceed it. The per-IP cap is measured separately by ` +
        `--profile=caps.`,
    );
  }

  const relay = attaching
    ? await attachRelay({
        label: args.label ?? `relay on port ${port}`,
        healthUrl: `http://127.0.0.1:${port}/`,
        statusUrl: args.statusUrl ?? `http://127.0.0.1:${statusPort}/`,
        rssCommand: args.rssCommand,
        peakCommand: args.peakCommand,
      })
    : await startRelay({
        port,
        statusPort,
        ipSpread: profile.ipSpread,
        ipPerAddr: profile.ipPerAddr,
        verbose: args.verbose,
      });

  const peakAtStart = await samplePeakMemory(relay);
  const idle = await sampleMemory(relay, true);
  console.log(
    `idle relay: serving pid ${relay.mode === "spawned" ? (relay.listeningPid ?? "?") : "attached"}, ` +
      `rss ${fmtMem(idle.psRssBytes)}, self rss ${fmtMem(idle.self?.rss ?? null)}, ` +
      `${relay.mode === "spawned" ? `process tree ${fmtMem(idle.treeRssBytes)} over ${idle.treePidCount} pids` : `memory source total ${fmtMem(idle.treeRssBytes)}`}, ` +
      `gc available ${idle.gcAvailable}`,
  );
  if (idle.self === null) {
    console.log(
      "warning: the relay status endpoint did not answer, so heap figures will be missing.",
    );
  }

  const workers: Worker[] = [];
  for (let i = 0; i < profile.workers; i++) workers.push(new Worker(i));
  await Promise.all(
    workers.map((w) =>
      w.send("init", {
        config: {
          workerId: w.id,
          workerCount: profile.workers,
          relayUrl: `ws://127.0.0.1:${port}`,
          clientsPerRoom: profile.clientsPerRoom,
          oneTimeKeyCount: profile.oneTimeKeyCount,
          connectBatch: profile.connectBatch,
          connectGapMs: profile.connectGapMs,
          connectTimeoutMs: profile.connectTimeoutMs,
        },
      }),
    ),
  );

  const totalCloses = new CloseTally();
  const steps: StepResult[] = [];
  const throughput: RunReport["throughput"] = [];
  let stoppedEarly: string | null = null;
  let liveTotal = 0;

  header();

  for (const target of rampSteps(profile.ramp)) {
    const stepStart = Date.now();
    const delta = target - liveTotal;
    const perWorker = splitAcross(delta, profile.workers);

    const connectResults = await Promise.all(
      workers.map((w, i) => w.send("connect", { count: perWorker[i] })),
    );

    let established = 0;
    let connectFailures = 0;
    const failuresByCap: Record<string, number> = {};
    for (const r of connectResults) {
      established += r.established as number;
      connectFailures += r.failures as number;
      for (const [cap, n] of Object.entries(r.failuresByCap as Record<string, number>)) {
        failuresByCap[cap] = (failuresByCap[cap] ?? 0) + n;
      }
    }
    liveTotal += established;

    await sleep(profile.settleMs);

    const mem = await sampleMemory(relay);
    const probeResults = await Promise.all(
      workers.map((w) =>
        w.send("probe", {
          request: {
            pairs: profile.probe.pairsPerWorker,
            sendersPerRoom: profile.probe.sendersPerRoom,
            messagesPerPair: profile.probe.messagesPerPair,
            intervalMs: profile.probe.intervalMs,
            ciphertextBytes: profile.probe.ciphertextBytes,
            timeoutMs: profile.probe.timeoutMs,
          },
        }),
      ),
    );

    const samples: number[] = [];
    let probeSent = 0;
    let probeReceived = 0;
    for (const r of probeResults) {
      samples.push(...(r.samples as number[]));
      probeSent += r.sent as number;
      probeReceived += r.received as number;
    }

    const statResults = await Promise.all(workers.map((w) => w.send("stats")));
    const stepCloses = new CloseTally();
    let live = 0;
    for (const r of statResults) {
      const s = r.stats as { live: number; closes: CloseCount[] };
      live += s.live;
      stepCloses.merge(s.closes);
      totalCloses.merge(s.closes);
    }
    liveTotal = live;

    const step: StepResult = {
      target,
      established: live,
      connectFailures,
      failuresByCap,
      closesDuringStep: stepCloses.snapshot(),
      rssBytes: mem.psRssBytes,
      treeRssBytes: mem.treeRssBytes,
      heapUsedBytes: mem.self?.heapUsed ?? null,
      latency: summarize(samples),
      probeSent,
      probeReceived,
      wallMs: Date.now() - stepStart,
    };
    steps.push(step);
    row(step);

    if (steps.length === 1 && step.established === 0) {
      throw new Error(
        "no connection completed the join handshake at the first step. The harness is not " +
          "measuring the relay. Re-run with --verbose and check the relay output.",
      );
    }

    const stop = shouldStopRamp(step, profile.stop);
    if (stop) {
      stoppedEarly = `stopped after target ${target}: ${stop}`;
      console.log(`\n${stoppedEarly}`);
      break;
    }
  }

  // Throughput phase at whatever the run actually reached.
  for (const rate of profile.throughputRates) {
    if (rate > 20) throw new Error(`throughput rate ${rate}/s is too close to MSG_RATE_LIMIT`);
    const durationSec = 5;
    const results = await Promise.all(
      workers.map((w) =>
        w.send("probe", {
          request: {
            pairs: profile.probe.pairsPerWorker,
            sendersPerRoom: profile.probe.sendersPerRoom,
            messagesPerPair: Math.max(1, Math.round(rate * durationSec)),
            intervalMs: Math.round(1000 / rate),
            ciphertextBytes: profile.probe.ciphertextBytes,
            timeoutMs: profile.probe.timeoutMs,
          },
        }),
      ),
    );
    const samples: number[] = [];
    let sent = 0;
    let received = 0;
    let pairs = 0;
    for (const r of results) {
      samples.push(...(r.samples as number[]));
      sent += r.sent as number;
      received += r.received as number;
      pairs += r.pairsUsed as number;
    }
    const latency = summarize(samples);
    const inbound = Math.round(pairs * rate);
    // handleEncrypted relays each inbound message to every other room member,
    // so the work the relay actually does is inbound times (room size - 1).
    const outbound = inbound * (profile.clientsPerRoom - 1);
    throughput.push({
      ratePerPairPerSecond: rate,
      pairs,
      aggregateMessagesPerSecond: inbound,
      relayedMessagesPerSecond: outbound,
      sent,
      received,
      latency,
    });
    console.log(
      `throughput in ${String(inbound).padStart(6)} msg/s  ` +
        `out ${String(outbound).padStart(7)} msg/s  ` +
        `delivered ${received}/${sent}  ` +
        `p50 ${fmtMs(latency?.p50)}  p95 ${fmtMs(latency?.p95)}  max ${fmtMs(latency?.max)}`,
    );
  }

  // Teardown: does closing every connection give the memory back?
  await Promise.all(workers.map((w) => w.send("closeAll")));
  await sleep(2000);
  const afterClose = await sampleMemory(relay);
  await sleep(1000);
  const afterCloseGc = await sampleMemory(relay, true);
  const peakAtEnd = await samplePeakMemory(relay);
  console.log(
    `\nafter closing every connection: rss ${fmtMem(afterClose.psRssBytes)}, ` +
      `after forced gc ${fmtMem(afterCloseGc.psRssBytes)} ` +
      `(heap used ${fmtMem(afterCloseGc.self?.heapUsed ?? null)})`,
  );
  if (peakAtEnd !== null) {
    console.log(
      `memory high-water mark: ${fmtMem(peakAtEnd)} ` +
        `(was ${fmtMem(peakAtStart)} before the run). Step samples read memory between ` +
        `bursts, so this is the figure a memory limit is enforced against.`,
    );
  }

  await Promise.all(workers.map((w) => w.send("shutdown").catch(() => undefined)));
  await sleep(400);
  for (const w of workers) w.kill();
  await stopRelay(relay);

  return {
    profile: profile.name,
    startedAt: new Date().toISOString(),
    relayTarget: attaching ? `attached: ${args.label ?? `port ${port}`}` : "spawned on this host",
    host: await describeHost(),
    relayLimits: RELAY_LIMITS,
    ipSpread: { enabled: profile.ipSpread, connectionsPerSyntheticAddress: profile.ipPerAddr },
    port,
    idleMemory: {
      psRssBytes: idle.psRssBytes,
      treeRssBytes: idle.treeRssBytes,
      treePidCount: idle.treePidCount,
      selfRssBytes: idle.self?.rss ?? null,
    },
    steps,
    stoppedEarly,
    throughput,
    teardown: {
      afterCloseRssBytes: afterClose.psRssBytes,
      afterCloseGcRssBytes: afterCloseGc.psRssBytes,
      afterCloseHeapUsedBytes: afterCloseGc.self?.heapUsed ?? null,
      afterCloseTreeRssBytes: afterCloseGc.treeRssBytes,
    },
    peakMemory: { beforeRunBytes: peakAtStart, afterRunBytes: peakAtEnd },
    totalCloses: totalCloses.snapshot(),
  };
}

// --- Output helpers ---------------------------------------------------------

function splitAcross(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const out = new Array<number>(parts).fill(base);
  for (let i = 0; i < total - base * parts; i++) out[i] += 1;
  return out;
}

function fmtMem(bytes: number | null): string {
  return bytes === null ? "n/a" : `${toMiB(bytes)} MiB`;
}

function fmtMs(v: number | undefined): string {
  return v === undefined ? "n/a" : `${v.toFixed(1)}ms`;
}

function header(): void {
  console.log(
    "\n" +
      pad("target", 8) +
      pad("live", 8) +
      pad("fail", 7) +
      pad("rss", 11) +
      pad("treeRss", 11) +
      pad("heap", 11) +
      pad("p50", 10) +
      pad("p95", 10) +
      pad("max", 10) +
      "delivered",
  );
  console.log("-".repeat(105));
}

function row(step: StepResult): void {
  console.log(
    pad(String(step.target), 8) +
      pad(String(step.established), 8) +
      pad(String(step.connectFailures), 7) +
      pad(fmtMem(step.rssBytes), 11) +
      pad(fmtMem(step.treeRssBytes), 11) +
      pad(fmtMem(step.heapUsedBytes), 11) +
      pad(fmtMs(step.latency?.p50), 10) +
      pad(fmtMs(step.latency?.p95), 10) +
      pad(fmtMs(step.latency?.max), 10) +
      `${step.probeReceived}/${step.probeSent}` +
      (Object.keys(step.failuresByCap).length > 0
        ? `  [${Object.entries(step.failuresByCap)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ")}]`
        : ""),
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s} ` : s + " ".repeat(n - s.length);
}

// --- Entry point ------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  let report: unknown;
  if (args.profile === "caps") {
    const port = await choosePort(args.port);
    report = await runCapChecks(port, args.verbose);
  } else if (args.profile === "push") {
    const port = await choosePort(args.port);
    report = await runPushChecks(port, args.verbose);
  } else {
    report = await runRamp(resolveProfile(args.profile), args);
  }

  const outFile = path.join(args.out, `${args.profile}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nresults written to ${outFile}`);
  console.log(`relay source read from ${path.join(REPO_ROOT, "server", "relay.ts")}`);
}

main().catch((err) => {
  console.error(`\nload test failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500);
});
