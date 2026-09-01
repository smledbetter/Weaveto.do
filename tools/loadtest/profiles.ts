/**
 * Load-test profiles.
 *
 * `smoke` proves the harness works. `small` is the everyday local run.
 * `full` ramps past the relay's declared MAX_CONNECTIONS so the cap itself is
 * observed firing. `caps` checks each declared cap one at a time.
 */

import type { RampOptions, StopLimits } from "./metrics.js";
import { RELAY_LIMITS } from "./protocol.js";

const RELAY_LIMITS_MAX_CLIENTS_PER_ROOM = RELAY_LIMITS.MAX_CLIENTS_PER_ROOM;

/**
 * The fastest a connection may send and stay inside MSG_RATE_LIMIT.
 *
 * Probe traffic is all `encrypted`, so the budget that binds it is
 * BROADCAST_RATE_LIMIT, not the looser global one. The relay closes with 4029
 * on the limit-th frame in a one-second window, and real senders jitter, so
 * the sustainable rate is one below the cap.
 *
 * Derived rather than written down. It was a hardcoded 100ms, which was legal
 * against a 30/s cap and illegal against a 5/s one. A profile that exceeds the
 * cap does not measure fan-out — the relay disconnects the senders, and the
 * run reports a lower memory figure because it is carrying less load. That is
 * a stale constant producing a flattering result, which is worse than a
 * failure.
 */
const LEGAL_SEND_INTERVAL_MS = Math.ceil(1000 / (RELAY_LIMITS.BROADCAST_RATE_LIMIT - 1));

/** Half a full room sends at once: the densest traffic the caps permit. */
const HALF_A_FULL_ROOM = Math.ceil(RELAY_LIMITS_MAX_CLIENTS_PER_ROOM / 2);

export interface ProbeConfig {
  /** Ceiling on probe pairs per worker. Each pair is one sender and one receiver. */
  pairsPerWorker: number;
  /**
   * How many members of one room send at the same time.
   *
   * This separates inbound message rate from fan-out. A full room with half of
   * it sending carries that many times the inbound rate at the same
   * amplification, which is the load the declared caps permit.
   */
  sendersPerRoom: number;
  messagesPerPair: number;
  /** Delay between rounds. Must keep each connection under MSG_RATE_LIMIT. */
  intervalMs: number;
  ciphertextBytes: number;
  timeoutMs: number;
}

export interface Profile {
  name: string;
  description: string;
  ramp: RampOptions;
  clientsPerRoom: number;
  oneTimeKeyCount: number;
  workers: number;
  connectBatch: number;
  connectGapMs: number;
  connectTimeoutMs: number;
  /** Idle time after a step's connections open, before memory and latency are sampled. */
  settleMs: number;
  probe: ProbeConfig;
  stop: StopLimits;
  ipSpread: boolean;
  ipPerAddr: number;
  /** Aggregate message rates to try at the top step, in messages per second per pair. */
  throughputRates: number[];
}

const BASE_STOP: StopLimits = {
  maxFailureRate: 0.25,
  maxP95Ms: 5000,
  minDeliveryRate: 0.95,
};

export const PROFILES: Record<string, Profile> = {
  smoke: {
    name: "smoke",
    description: "Fast proof that the harness connects, joins and measures.",
    ramp: { start: 10, max: 40, factor: 2 },
    clientsPerRoom: 2,
    oneTimeKeyCount: 5,
    workers: 2,
    connectBatch: 20,
    connectGapMs: 20,
    connectTimeoutMs: 10_000,
    settleMs: 400,
    probe: { pairsPerWorker: 5, sendersPerRoom: 1, messagesPerPair: 5, intervalMs: LEGAL_SEND_INTERVAL_MS, ciphertextBytes: 256, timeoutMs: 5000 },
    stop: BASE_STOP,
    ipSpread: true,
    ipPerAddr: 1,
    throughputRates: [],
  },

  small: {
    name: "small",
    description: "Local ramp to 500 connections. Cheap enough to run on a laptop repeatedly.",
    ramp: { start: 50, max: 500, factor: 2 },
    clientsPerRoom: 2,
    oneTimeKeyCount: 5,
    workers: 4,
    connectBatch: 50,
    connectGapMs: 25,
    connectTimeoutMs: 15_000,
    settleMs: 1000,
    probe: { pairsPerWorker: 25, sendersPerRoom: 1, messagesPerPair: 10, intervalMs: LEGAL_SEND_INTERVAL_MS, ciphertextBytes: 1024, timeoutMs: 5000 },
    stop: BASE_STOP,
    ipSpread: true,
    ipPerAddr: 1,
    throughputRates: [1, 5, 10],
  },

  full: {
    name: "full",
    description:
      "Ramp past the relay's declared MAX_CONNECTIONS of 5000, so the cap is observed firing rather than assumed.",
    ramp: { start: 100, max: 5200, factor: 1.6 },
    clientsPerRoom: 2,
    oneTimeKeyCount: 5,
    workers: 5,
    connectBatch: 50,
    connectGapMs: 30,
    connectTimeoutMs: 20_000,
    settleMs: 1500,
    probe: { pairsPerWorker: 40, sendersPerRoom: 1, messagesPerPair: 10, intervalMs: LEGAL_SEND_INTERVAL_MS, ciphertextBytes: 1024, timeoutMs: 10_000 },
    // The last step deliberately overshoots MAX_CONNECTIONS, so a high connect
    // failure rate there is the expected result, not a reason to stop early.
    stop: { maxFailureRate: 0.999, maxP95Ms: 15_000, minDeliveryRate: 0.5 },
    ipSpread: true,
    ipPerAddr: 1,
    throughputRates: [1, 5, 10],
  },

  fly: {
    name: "fly",
    description:
      "A small ramp against a deployed relay over the real network. Every " +
      "connection arrives from one address, so MAX_CONNECTIONS_PER_IP binds at " +
      `${RELAY_LIMITS.MAX_CONNECTIONS_PER_IP} and capacity cannot be reached from here. ` +
      "What this measures is round-trip latency through TLS and a shared vCPU, " +
      "which no local run can produce, and whether the per-IP cap fires in " +
      "production, which is the only end-to-end proof that the proxy's " +
      "client-address header is being trusted correctly.",
    // The last step deliberately exceeds the per-IP cap so the refusal is
    // observed rather than assumed.
    ramp: { start: 2, max: RELAY_LIMITS.MAX_CONNECTIONS_PER_IP + 2, factor: 2 },
    clientsPerRoom: 2,
    oneTimeKeyCount: 5,
    workers: 2,
    connectBatch: 2,
    connectGapMs: 250,
    connectTimeoutMs: 20_000,
    settleMs: 2000,
    probe: { pairsPerWorker: 5, sendersPerRoom: 1, messagesPerPair: 10, intervalMs: LEGAL_SEND_INTERVAL_MS, ciphertextBytes: 1024, timeoutMs: 15_000 },
    // The final step is meant to be refused, so a high failure rate there is
    // the expected result rather than a reason to stop.
    stop: { maxFailureRate: 0.999, maxP95Ms: 20_000, minDeliveryRate: 0.5 },
    // The hook cannot reach a relay this harness did not start, and should not.
    ipSpread: false,
    ipPerAddr: 1,
    throughputRates: [0.5, 1],
  },

  fanout: {
    name: "fanout",
    description:
      "Same connection count as `full`, but every room is filled to MAX_CLIENTS_PER_ROOM " +
      `(${RELAY_LIMITS_MAX_CLIENTS_PER_ROOM}). handleEncrypted relays one inbound message to ` +
      `every other member, so each message becomes ${RELAY_LIMITS_MAX_CLIENTS_PER_ROOM - 1}. ` +
      "This is the multiplier the declared caps allow but no other profile exercises.",
    ramp: { start: 100, max: 5200, factor: 1.6 },
    clientsPerRoom: RELAY_LIMITS_MAX_CLIENTS_PER_ROOM,
    oneTimeKeyCount: 5,
    workers: 5,
    connectBatch: 50,
    connectGapMs: 30,
    connectTimeoutMs: 20_000,
    settleMs: 1500,
    // Half of every room sends at once, which is the densest legal traffic the
    // declared caps permit. 500 pairs per worker leaves the room count, not the
    // ceiling, as what limits the load. Both numbers follow the caps, so
    // changing a cap changes the load rather than silently invalidating it.
    probe: { pairsPerWorker: 500, sendersPerRoom: HALF_A_FULL_ROOM, messagesPerPair: 10, intervalMs: LEGAL_SEND_INTERVAL_MS, ciphertextBytes: 1024, timeoutMs: 10_000 },
    stop: { maxFailureRate: 0.999, maxP95Ms: 15_000, minDeliveryRate: 0.5 },
    ipSpread: true,
    ipPerAddr: 1,
    // Finer rates than `full` uses, to bracket where fan-out starts to hurt
    // rather than only showing that it eventually does.
    throughputRates: [0.5, 1, 2, 4, 8],
  },
};

export function resolveProfile(name: string): Profile {
  const profile = PROFILES[name];
  if (!profile) {
    throw new Error(`unknown profile "${name}". Known: ${Object.keys(PROFILES).join(", ")}, caps`);
  }
  return profile;
}
