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

export interface ProbeConfig {
  /** Ceiling on probe pairs per worker. Each pair is one sender and one receiver. */
  pairsPerWorker: number;
  /**
   * How many members of one room send at the same time.
   *
   * This separates inbound message rate from fan-out. A room of 50 with 25
   * senders carries 25 times the inbound rate at the same 49-way amplification,
   * which is the load the declared caps permit.
   */
  sendersPerRoom: number;
  messagesPerPair: number;
  /** Delay between rounds. Must keep each connection under MSG_RATE_LIMIT (30/s). */
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
    probe: { pairsPerWorker: 5, sendersPerRoom: 1, messagesPerPair: 5, intervalMs: 100, ciphertextBytes: 256, timeoutMs: 5000 },
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
    probe: { pairsPerWorker: 25, sendersPerRoom: 1, messagesPerPair: 10, intervalMs: 100, ciphertextBytes: 1024, timeoutMs: 5000 },
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
    probe: { pairsPerWorker: 40, sendersPerRoom: 1, messagesPerPair: 10, intervalMs: 100, ciphertextBytes: 1024, timeoutMs: 10_000 },
    // The last step deliberately overshoots MAX_CONNECTIONS, so a high connect
    // failure rate there is the expected result, not a reason to stop early.
    stop: { maxFailureRate: 0.999, maxP95Ms: 15_000, minDeliveryRate: 0.5 },
    ipSpread: true,
    ipPerAddr: 1,
    throughputRates: [1, 5, 10],
  },

  fanout: {
    name: "fanout",
    description:
      "Same connection count as `full`, but every room is filled to MAX_CLIENTS_PER_ROOM. " +
      "handleEncrypted relays one inbound message to every other member, so a 50-member room " +
      "turns one message into 49. This is the multiplier the declared caps allow but no other " +
      "profile exercises.",
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
    // ceiling, as what limits the load.
    probe: { pairsPerWorker: 500, sendersPerRoom: 25, messagesPerPair: 10, intervalMs: 100, ciphertextBytes: 1024, timeoutMs: 10_000 },
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
