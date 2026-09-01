/**
 * Pure measurement logic for the relay load-test harness.
 *
 * Everything here is deterministic and I/O free so it can be unit tested.
 * The frame shapes and close codes are read from server/relay.ts. If the relay
 * changes its wire format, this file and tests/unit/loadtest-metrics.test.ts
 * must change with it.
 */

// --- Latency statistics -----------------------------------------------------

export interface LatencySummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/**
 * Linear-interpolated percentile over the closest ranks.
 *
 * index = (n - 1) * p, then interpolate between floor and ceil. This is the
 * numpy default ("linear"). Returns null for an empty sample.
 * `p` is a fraction in [0, 1].
 */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  if (!(p >= 0 && p <= 1)) throw new RangeError(`percentile p must be in [0,1], got ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/** Summarise a latency sample. Returns null for an empty sample. */
export function summarize(samples: readonly number[]): LatencySummary | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5) as number,
    p95: percentile(sorted, 0.95) as number,
    p99: percentile(sorted, 0.99) as number,
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

// --- Relay frame classification --------------------------------------------

export type RelayFrame =
  | { kind: "member_list"; members: Array<{ identityKey: string; displayName: string }>; roomExisted: boolean | null }
  | { kind: "new_member"; identityKey: string }
  | { kind: "member_left"; identityKey: string }
  | { kind: "encrypted"; senderIdentityKey: string; sessionId: string; timestamp: number }
  | { kind: "key_share"; targetIdentityKey: string }
  | { kind: "room_not_found" }
  | { kind: "room_full" }
  | { kind: "server_full" }
  | { kind: "room_destroyed"; reason: string }
  | { kind: "purge_unauthorized" }
  | { kind: "unknown"; type: string }
  | { kind: "malformed"; reason: "not-json" | "not-object" | "no-type" };

/**
 * Turn a raw relay frame into a tagged union.
 *
 * The harness counts these to tell "the relay refused me" (room_full,
 * server_full, room_not_found) apart from "the relay served me".
 */
export function classifyRelayFrame(raw: string): RelayFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "malformed", reason: "not-json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "malformed", reason: "not-object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string") return { kind: "malformed", reason: "no-type" };

  switch (obj.type) {
    case "member_list": {
      const members = Array.isArray(obj.members) ? obj.members : [];
      return {
        kind: "member_list",
        // Since the relay became stateless it does not refuse a join for a
        // room it has forgotten. It reconstitutes the routing entry and says
        // whether the room was already there. That flag is now the only way to
        // observe reclamation from outside.
        roomExisted: typeof obj.roomExisted === "boolean" ? obj.roomExisted : null,
        members: members.map((m) => {
          const rec = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>;
          return {
            identityKey: typeof rec.identityKey === "string" ? rec.identityKey : "",
            displayName: typeof rec.displayName === "string" ? rec.displayName : "",
          };
        }),
      };
    }
    case "new_member":
      return { kind: "new_member", identityKey: String(obj.identityKey ?? "") };
    case "member_left":
      return { kind: "member_left", identityKey: String(obj.identityKey ?? "") };
    case "encrypted":
      return {
        kind: "encrypted",
        senderIdentityKey: String(obj.senderIdentityKey ?? ""),
        sessionId: String(obj.sessionId ?? ""),
        timestamp: typeof obj.timestamp === "number" ? obj.timestamp : NaN,
      };
    case "key_share":
      return { kind: "key_share", targetIdentityKey: String(obj.targetIdentityKey ?? "") };
    case "room_not_found":
      return { kind: "room_not_found" };
    case "room_full":
      return { kind: "room_full" };
    case "server_full":
      return { kind: "server_full" };
    case "room_destroyed":
      return { kind: "room_destroyed", reason: String(obj.reason ?? "") };
    case "purge_unauthorized":
      return { kind: "purge_unauthorized" };
    default:
      return { kind: "unknown", type: obj.type };
  }
}

// --- Close codes ------------------------------------------------------------

/** Close codes the relay sends, from server/relay.ts, plus the ws standard ones we see. */
export const CLOSE_CODE_MEANINGS: Readonly<Record<number, string>> = Object.freeze({
  1000: "normal close",
  1001: "going away",
  1005: "no status received",
  1006: "abnormal close (no close frame)",
  1011: "server internal error",
  4000: "room purged",
  4001: "message too large",
  4002: "invalid JSON",
  4003: "invalid message schema",
  4004: "room not found",
  4005: "replaced by new connection",
  4008: "server full (MAX_ROOMS)",
  4009: "room full (MAX_CLIENTS_PER_ROOM)",
  4029: "rate limit exceeded (MSG_RATE_LIMIT)",
});

export function describeCloseCode(code: number): string {
  return CLOSE_CODE_MEANINGS[code] ?? `unmapped code ${code}`;
}

export interface CloseCount {
  code: number;
  label: string;
  count: number;
}

/** Counts WebSocket close codes so a step can report why connections went away. */
export class CloseTally {
  private counts = new Map<number, number>();

  record(code: number): void {
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
  }

  get total(): number {
    let n = 0;
    for (const c of this.counts.values()) n += c;
    return n;
  }

  /** Snapshot sorted by descending count, then ascending code, for stable output. */
  snapshot(): CloseCount[] {
    return [...this.counts.entries()]
      .map(([code, count]) => ({ code, label: describeCloseCode(code), count }))
      .sort((a, b) => b.count - a.count || a.code - b.code);
  }

  merge(other: readonly CloseCount[]): void {
    for (const entry of other) {
      this.counts.set(entry.code, (this.counts.get(entry.code) ?? 0) + entry.count);
    }
  }
}

// --- Upgrade failures -------------------------------------------------------

export type UpgradeFailure =
  | { cap: "origin"; status: 403 }
  | { cap: "max-connections"; status: 503 }
  | { cap: "max-connections-per-ip"; status: 429 }
  | { cap: "bad-path-or-room-id"; status: 400 }
  | { cap: "http"; status: number }
  | { cap: "transport"; status: null; code: string };

/**
 * Map a `ws` client error into the relay cap that produced it.
 *
 * `ws` reports a rejected upgrade as "Unexpected server response: 503". Socket
 * level failures (ECONNREFUSED, ECONNRESET, ETIMEDOUT) carry no status.
 */
export function parseUpgradeFailure(message: string, errnoCode?: string): UpgradeFailure {
  const m = /Unexpected server response:\s*(\d{3})/.exec(message);
  if (m) {
    const status = parseInt(m[1], 10);
    switch (status) {
      case 403:
        return { cap: "origin", status: 403 };
      case 503:
        return { cap: "max-connections", status: 503 };
      case 429:
        return { cap: "max-connections-per-ip", status: 429 };
      case 400:
        return { cap: "bad-path-or-room-id", status: 400 };
      default:
        return { cap: "http", status };
    }
  }
  const code = errnoCode ?? /\b(E[A-Z]{3,})\b/.exec(message)?.[1] ?? "UNKNOWN";
  return { cap: "transport", status: null, code };
}

// --- Process memory ---------------------------------------------------------

/**
 * Parse `ps -o rss= -p <pid>` output into bytes.
 *
 * macOS and Linux both report RSS in kibibytes for this format. Returns null
 * when the process is gone, so a dead relay reads as "no sample" and never as
 * zero bytes.
 */
export function parsePsRss(output: string): number | null {
  const trimmed = output.trim();
  if (trimmed === "") return null;
  const first = trimmed.split(/\s+/)[0];
  if (!/^\d+$/.test(first)) return null;
  return parseInt(first, 10) * 1024;
}

/** Bytes to MiB, one decimal place, for report tables. */
export function toMiB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

// --- Ramp planning ----------------------------------------------------------

export interface RampOptions {
  start: number;
  max: number;
  /** Multiplier applied to the previous step. Must be greater than 1. */
  factor: number;
}

/**
 * Build the ladder of concurrent-connection targets.
 *
 * A ramp finds the knee. A single jump to the cap only produces pass or fail.
 * Steps are strictly increasing and the last step is always `max`.
 */
export function rampSteps(opts: RampOptions): number[] {
  const { start, max, factor } = opts;
  if (start < 1) throw new RangeError(`ramp start must be >= 1, got ${start}`);
  if (max < start) throw new RangeError(`ramp max (${max}) must be >= start (${start})`);
  if (!(factor > 1)) throw new RangeError(`ramp factor must be > 1, got ${factor}`);
  const steps: number[] = [];
  let current = start;
  while (current < max) {
    steps.push(current);
    current = Math.max(current + 1, Math.round(current * factor));
  }
  steps.push(max);
  return steps;
}

// --- Step results -----------------------------------------------------------

export interface StepResult {
  target: number;
  established: number;
  connectFailures: number;
  failuresByCap: Record<string, number>;
  closesDuringStep: CloseCount[];
  /** RSS of the process serving the port. */
  rssBytes: number | null;
  /** RSS of the whole relay process tree, which is what a fly machine pays for. */
  treeRssBytes: number | null;
  heapUsedBytes: number | null;
  latency: LatencySummary | null;
  probeSent: number;
  probeReceived: number;
  wallMs: number;
}

export interface StopLimits {
  maxFailureRate: number;
  maxP95Ms: number;
  minDeliveryRate: number;
}

/**
 * Decide whether the ramp must stop after this step.
 *
 * Returns a reason string, or null to keep going. Degradation is a rate of
 * failure, not a single failure, so one dropped socket does not end a run.
 */
export function shouldStopRamp(step: StepResult, limits: StopLimits): string | null {
  const attempted = step.established + step.connectFailures;
  if (attempted > 0) {
    const failureRate = step.connectFailures / attempted;
    if (failureRate > limits.maxFailureRate) {
      return `connect failure rate ${(failureRate * 100).toFixed(1)}% exceeded ${(limits.maxFailureRate * 100).toFixed(0)}%`;
    }
  }
  if (step.latency && step.latency.p95 > limits.maxP95Ms) {
    return `p95 round trip ${step.latency.p95.toFixed(0)}ms exceeded ${limits.maxP95Ms}ms`;
  }
  if (step.probeSent > 0) {
    const delivery = step.probeReceived / step.probeSent;
    if (delivery < limits.minDeliveryRate) {
      return `probe delivery ${(delivery * 100).toFixed(1)}% below ${(limits.minDeliveryRate * 100).toFixed(0)}%`;
    }
  }
  return null;
}
