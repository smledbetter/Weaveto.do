// @vitest-environment node
/**
 * Tests for the load-test harness's measurement logic.
 *
 * The harness produces the number that decides whether launch is open or
 * invite gated, so its arithmetic and its parsing are worth more than the
 * harness itself. Everything covered here is pure: percentile maths, relay
 * frame parsing, close-code tallying, `ps` output parsing, ramp planning, the
 * stop rule, and the identifiers and messages the harness puts on the wire.
 *
 * The wire-shape tests are the important ones. A builder that generates a join
 * the relay rejects would report a capacity of zero and blame the relay.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  percentile,
  summarize,
  classifyRelayFrame,
  describeCloseCode,
  CloseTally,
  parseUpgradeFailure,
  parsePsRss,
  toMiB,
  rampSteps,
  shouldStopRamp,
} from "../../tools/loadtest/metrics";
import type { StepResult, StopLimits } from "../../tools/loadtest/metrics";
import {
  RELAY_LIMITS,
  ROOM_ID_PATTERN,
  roomIdFor,
  identityKeyFor,
  ed25519KeyFor,
  oneTimeKeysFor,
  buildJoin,
  buildProbe,
  checkJoinAgainstRelayRules,
  checkProbeAgainstRelayRules,
  buildKeyShare,
  checkKeyShareAgainstRelayRules,
  BROADCAST_BUDGET,
  MAX_PUSH_SUBS_PER_ROOM,
} from "../../tools/loadtest/protocol";

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

describe("percentile", () => {
  it("returns null for an empty sample rather than zero", () => {
    // Zero would read as "instant round trip" in the report. Null reads as
    // "not measured", which is the truth.
    expect(percentile([], 0.5)).toBeNull();
    expect(summarize([])).toBeNull();
  });

  it("returns the only value for a single-element sample", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("interpolates linearly between closest ranks", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // index = (10 - 1) * 0.5 = 4.5, halfway between 5 and 6.
    expect(percentile(s, 0.5)).toBeCloseTo(5.5, 10);
    // index = 9 * 0.95 = 8.55, between 9 and 10.
    expect(percentile(s, 0.95)).toBeCloseTo(9.55, 10);
    expect(percentile(s, 0)).toBe(1);
    expect(percentile(s, 1)).toBe(10);
  });

  it("lands exactly on a rank when the index is an integer", () => {
    // index = (5 - 1) * 0.5 = 2 exactly, so no interpolation happens.
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });

  it("sorts before measuring, so input order does not matter", () => {
    const unsorted = [9, 1, 7, 3, 5];
    const sorted = [1, 3, 5, 7, 9];
    expect(percentile(unsorted, 0.5)).toBe(percentile(sorted, 0.5));
    expect(percentile(unsorted, 0.5)).toBe(5);
  });

  it("does not mutate the caller's array", () => {
    const input = [3, 1, 2];
    percentile(input, 0.5);
    expect(input).toEqual([3, 1, 2]);
  });

  it("rejects a percentile outside 0..1", () => {
    expect(() => percentile([1, 2, 3], 95)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], -0.1)).toThrow(RangeError);
  });

  it("keeps a slow tail visible instead of averaging it away", () => {
    // 95 fast round trips and 5 very slow ones. p50 must stay fast and p99 must
    // show the tail, otherwise a relay that stalls one request in twenty would
    // look healthy in the report.
    const samples = [...Array<number>(95).fill(1), ...Array<number>(5).fill(1000)];
    const s = summarize(samples);
    expect(s).not.toBeNull();
    expect(s!.count).toBe(100);
    expect(s!.min).toBe(1);
    expect(s!.p50).toBe(1);
    expect(s!.p99).toBe(1000);
    expect(s!.max).toBe(1000);
    expect(s!.p99 / s!.p50).toBeGreaterThan(100);
  });

  it("orders the summary fields monotonically", () => {
    const s = summarize([5, 1, 9, 3, 7, 2, 8, 4, 6, 10]);
    expect(s).not.toBeNull();
    expect(s!.min).toBeLessThanOrEqual(s!.p50);
    expect(s!.p50).toBeLessThanOrEqual(s!.p95);
    expect(s!.p95).toBeLessThanOrEqual(s!.p99);
    expect(s!.p99).toBeLessThanOrEqual(s!.max);
  });
});

// ---------------------------------------------------------------------------
// Relay frame parsing
// ---------------------------------------------------------------------------

describe("classifyRelayFrame", () => {
  it("reads a member_list, which is how the harness knows a join succeeded", () => {
    const frame = classifyRelayFrame(
      JSON.stringify({
        type: "member_list",
        members: [{ identityKey: "abc" }],
      }),
    );
    expect(frame.kind).toBe("member_list");
    if (frame.kind !== "member_list") throw new Error("wrong kind");
    expect(frame.members).toEqual([{ identityKey: "abc" }]);
  });

  it("reads an empty member_list, which the first client in a room receives", () => {
    const frame = classifyRelayFrame(JSON.stringify({ type: "member_list", members: [] }));
    expect(frame.kind).toBe("member_list");
    if (frame.kind !== "member_list") throw new Error("wrong kind");
    expect(frame.members).toHaveLength(0);
  });

  it("reads roomExisted, which is how reclamation is observed now", () => {
    // The stateless relay does not refuse a join for a room it has forgotten,
    // so a refusal can no longer be the signal that a room was reclaimed. The
    // caps probe reads this flag instead.
    const gone = classifyRelayFrame(
      JSON.stringify({ type: "member_list", members: [], roomExisted: false }),
    );
    if (gone.kind !== "member_list") throw new Error("wrong kind");
    expect(gone.roomExisted).toBe(false);

    const there = classifyRelayFrame(
      JSON.stringify({ type: "member_list", members: [], roomExisted: true }),
    );
    if (there.kind !== "member_list") throw new Error("wrong kind");
    expect(there.roomExisted).toBe(true);
  });

  it("reports an absent roomExisted as unknown, not as reclaimed", () => {
    // A relay too old to send the flag must not read as "the room was gone".
    // Defaulting a missing boolean to false is how a probe silently starts
    // passing against a relay it is not actually measuring.
    const frame = classifyRelayFrame(
      JSON.stringify({ type: "member_list", members: [] }),
    );
    if (frame.kind !== "member_list") throw new Error("wrong kind");
    expect(frame.roomExisted).toBeNull();
  });

  it("recovers the probe token from a relayed encrypted frame", () => {
    // The relay echoes the validated object verbatim, so sessionId is how a
    // round trip is matched to its send time.
    const frame = classifyRelayFrame(
      JSON.stringify({
        type: "encrypted",
        senderIdentityKey: "sender",
        sessionId: "p0_3_7_12345",
        ciphertext: "xxxx",
        timestamp: 1700000000000,
      }),
    );
    expect(frame.kind).toBe("encrypted");
    if (frame.kind !== "encrypted") throw new Error("wrong kind");
    expect(frame.sessionId).toBe("p0_3_7_12345");
    expect(frame.senderIdentityKey).toBe("sender");
    expect(frame.timestamp).toBe(1700000000000);
  });

  it("tells the three refusal frames apart", () => {
    expect(classifyRelayFrame('{"type":"room_not_found"}').kind).toBe("room_not_found");
    expect(classifyRelayFrame('{"type":"room_full"}').kind).toBe("room_full");
    expect(classifyRelayFrame('{"type":"server_full"}').kind).toBe("server_full");
  });

  it("reads membership churn frames", () => {
    expect(classifyRelayFrame('{"type":"new_member","identityKey":"k1"}')).toEqual({
      kind: "new_member",
      identityKey: "k1",
    });
    expect(classifyRelayFrame('{"type":"member_left","identityKey":"k2"}')).toEqual({
      kind: "member_left",
      identityKey: "k2",
    });
    expect(classifyRelayFrame('{"type":"room_destroyed","reason":"manual"}')).toEqual({
      kind: "room_destroyed",
      reason: "manual",
    });
    expect(classifyRelayFrame('{"type":"purge_unauthorized"}').kind).toBe("purge_unauthorized");
  });

  it("reports malformed input as malformed instead of throwing", () => {
    // A parse crash mid-run would lose the whole measurement.
    expect(classifyRelayFrame("not json at all")).toEqual({ kind: "malformed", reason: "not-json" });
    expect(classifyRelayFrame("[1,2,3]")).toEqual({ kind: "malformed", reason: "not-object" });
    expect(classifyRelayFrame("null")).toEqual({ kind: "malformed", reason: "not-object" });
    expect(classifyRelayFrame('{"noType":true}')).toEqual({ kind: "malformed", reason: "no-type" });
    expect(classifyRelayFrame('{"type":123}')).toEqual({ kind: "malformed", reason: "no-type" });
  });

  it("keeps an unrecognised frame type visible instead of dropping it", () => {
    expect(classifyRelayFrame('{"type":"something_new"}')).toEqual({
      kind: "unknown",
      type: "something_new",
    });
  });
});

// ---------------------------------------------------------------------------
// Close codes
// ---------------------------------------------------------------------------

describe("close codes", () => {
  it("names every close code relay.ts can send", () => {
    // These are the codes in server/relay.ts. An unnamed one would show up in
    // a report as a bare number with no cause attached.
    expect(describeCloseCode(4001)).toMatch(/too large/);
    expect(describeCloseCode(4002)).toMatch(/JSON/);
    expect(describeCloseCode(4003)).toMatch(/schema/);
    expect(describeCloseCode(4004)).toMatch(/not found/);
    expect(describeCloseCode(4005)).toMatch(/[Rr]eplaced/);
    expect(describeCloseCode(4008)).toMatch(/MAX_ROOMS/);
    expect(describeCloseCode(4009)).toMatch(/MAX_CLIENTS_PER_ROOM/);
    expect(describeCloseCode(4029)).toMatch(/MSG_RATE_LIMIT/);
    expect(describeCloseCode(4000)).toMatch(/purged/);
  });

  it("marks an unmapped code rather than pretending it is understood", () => {
    expect(describeCloseCode(4999)).toBe("unmapped code 4999");
  });

  it("counts closes and orders the snapshot by frequency", () => {
    const tally = new CloseTally();
    tally.record(1006);
    tally.record(4029);
    tally.record(4029);
    tally.record(4029);
    tally.record(1000);
    expect(tally.total).toBe(5);
    const snap = tally.snapshot();
    expect(snap[0]).toEqual({ code: 4029, label: describeCloseCode(4029), count: 3 });
    expect(snap.map((s) => s.code)).toEqual([4029, 1000, 1006]);
  });

  it("merges worker snapshots without losing counts", () => {
    // Each worker reports its own tally; the driver sums them.
    const a = new CloseTally();
    a.record(4029);
    const b = new CloseTally();
    b.record(4029);
    b.record(1006);
    a.merge(b.snapshot());
    expect(a.total).toBe(3);
    expect(a.snapshot().find((s) => s.code === 4029)?.count).toBe(2);
  });

  it("starts empty", () => {
    const tally = new CloseTally();
    expect(tally.total).toBe(0);
    expect(tally.snapshot()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Upgrade failures
// ---------------------------------------------------------------------------

describe("parseUpgradeFailure", () => {
  it("maps each rejected upgrade status to the cap that produced it", () => {
    expect(parseUpgradeFailure("Unexpected server response: 503")).toEqual({
      cap: "max-connections",
      status: 503,
    });
    expect(parseUpgradeFailure("Unexpected server response: 429")).toEqual({
      cap: "max-connections-per-ip",
      status: 429,
    });
    expect(parseUpgradeFailure("Unexpected server response: 403")).toEqual({
      cap: "origin",
      status: 403,
    });
    expect(parseUpgradeFailure("Unexpected server response: 400")).toEqual({
      cap: "bad-path-or-room-id",
      status: 400,
    });
  });

  it("keeps an unexpected status visible instead of guessing a cap", () => {
    expect(parseUpgradeFailure("Unexpected server response: 502")).toEqual({
      cap: "http",
      status: 502,
    });
  });

  it("separates socket-level failure from a relay refusal", () => {
    // ECONNRESET is the harness or the kernel giving up. Recording it as a cap
    // hit would overstate where the relay's limit sits.
    expect(parseUpgradeFailure("connect ECONNREFUSED 127.0.0.1:3001", "ECONNREFUSED")).toEqual({
      cap: "transport",
      status: null,
      code: "ECONNREFUSED",
    });
    expect(parseUpgradeFailure("read ECONNRESET")).toEqual({
      cap: "transport",
      status: null,
      code: "ECONNRESET",
    });
    expect(parseUpgradeFailure("something went wrong")).toEqual({
      cap: "transport",
      status: null,
      code: "UNKNOWN",
    });
  });
});

// ---------------------------------------------------------------------------
// Process memory
// ---------------------------------------------------------------------------

describe("parsePsRss", () => {
  it("converts kibibytes from `ps -o rss=` into bytes", () => {
    // A wrong unit here changes the capacity answer by a factor of 1024.
    expect(parsePsRss("  95232\n")).toBe(95232 * 1024);
    expect(parsePsRss("1024")).toBe(1024 * 1024);
  });

  it("returns null for a dead process instead of zero", () => {
    // `ps` prints nothing when the pid is gone. Zero would read as "the relay
    // used no memory", which is the opposite of what happened.
    expect(parsePsRss("")).toBeNull();
    expect(parsePsRss("   \n  ")).toBeNull();
  });

  it("returns null rather than a number for unparsable output", () => {
    expect(parsePsRss("ps: no such process")).toBeNull();
    expect(parsePsRss("RSS")).toBeNull();
  });

  it("takes the first field when ps pads or adds columns", () => {
    expect(parsePsRss("  4096   1234\n")).toBe(4096 * 1024);
  });

  it("converts bytes to MiB for the report table", () => {
    expect(toMiB(1024 * 1024)).toBe(1);
    expect(toMiB(1536 * 1024)).toBe(1.5);
    expect(toMiB(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ramp planning
// ---------------------------------------------------------------------------

describe("rampSteps", () => {
  it("produces increasing steps ending exactly at max", () => {
    const steps = rampSteps({ start: 100, max: 5200, factor: 1.6 });
    expect(steps[0]).toBe(100);
    expect(steps[steps.length - 1]).toBe(5200);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });

  it("does not overshoot max on an intermediate step", () => {
    // Overshooting would skip the knee and turn the ramp back into pass/fail.
    for (const step of rampSteps({ start: 50, max: 500, factor: 2 })) {
      expect(step).toBeLessThanOrEqual(500);
    }
  });

  it("returns a single step when start equals max", () => {
    expect(rampSteps({ start: 40, max: 40, factor: 2 })).toEqual([40]);
  });

  it("still advances when rounding would stall the ramp", () => {
    // round(1 * 1.05) is 1. Without the +1 floor the loop would never end.
    const steps = rampSteps({ start: 1, max: 6, factor: 1.05 });
    expect(steps).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects a configuration that cannot produce a ramp", () => {
    expect(() => rampSteps({ start: 0, max: 100, factor: 2 })).toThrow(RangeError);
    expect(() => rampSteps({ start: 100, max: 50, factor: 2 })).toThrow(RangeError);
    expect(() => rampSteps({ start: 10, max: 100, factor: 1 })).toThrow(RangeError);
    expect(() => rampSteps({ start: 10, max: 100, factor: 0.5 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Stop rule
// ---------------------------------------------------------------------------

describe("shouldStopRamp", () => {
  const limits: StopLimits = { maxFailureRate: 0.25, maxP95Ms: 5000, minDeliveryRate: 0.95 };

  const step = (over: Partial<StepResult>): StepResult => ({
    target: 1000,
    established: 1000,
    connectFailures: 0,
    failuresByCap: {},
    closesDuringStep: [],
    rssBytes: 100 * 1024 * 1024,
    treeRssBytes: 160 * 1024 * 1024,
    heapUsedBytes: 20 * 1024 * 1024,
    latency: { count: 100, min: 1, p50: 2, p95: 5, p99: 8, max: 10, mean: 3 },
    probeSent: 100,
    probeReceived: 100,
    wallMs: 5000,
    ...over,
  });

  it("keeps going on a healthy step", () => {
    expect(shouldStopRamp(step({}), limits)).toBeNull();
  });

  it("tolerates a small number of failures", () => {
    // One dropped socket in a thousand is noise, not a capacity limit.
    expect(shouldStopRamp(step({ established: 999, connectFailures: 1 }), limits)).toBeNull();
  });

  it("stops once the connect failure rate crosses the limit", () => {
    const reason = shouldStopRamp(step({ established: 700, connectFailures: 300 }), limits);
    expect(reason).toMatch(/connect failure rate/);
    expect(reason).toMatch(/30\.0%/);
  });

  it("stops on a latency blowout even when every connection succeeded", () => {
    const reason = shouldStopRamp(
      step({ latency: { count: 100, min: 1, p50: 20, p95: 9000, p99: 12000, max: 15000, mean: 400 } }),
      limits,
    );
    expect(reason).toMatch(/p95 round trip/);
  });

  it("stops when the relay silently stops delivering messages", () => {
    // Connections can stay open while messages go nowhere. That is degradation.
    const reason = shouldStopRamp(step({ probeSent: 100, probeReceived: 50 }), limits);
    expect(reason).toMatch(/delivery/);
  });

  it("does not divide by zero when a step measured nothing", () => {
    const reason = shouldStopRamp(
      step({ established: 0, connectFailures: 0, probeSent: 0, probeReceived: 0, latency: null }),
      limits,
    );
    expect(reason).toBeNull();
  });

  it("honours a profile that deliberately overshoots the declared cap", () => {
    // The full profile ramps past MAX_CONNECTIONS on purpose, so its own limits
    // must let a near-total failure on the last step through.
    const permissive: StopLimits = { maxFailureRate: 0.999, maxP95Ms: 15000, minDeliveryRate: 0.5 };
    expect(shouldStopRamp(step({ established: 5000, connectFailures: 200 }), permissive)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wire shapes: identifiers and messages the harness sends to the relay
// ---------------------------------------------------------------------------

describe("room ids", () => {
  it("matches the relay's ROOM_ID_PATTERN", () => {
    // relay.ts rejects the upgrade with HTTP 400 for anything else, so a bad
    // generator would measure zero capacity and blame the relay.
    for (const i of [0, 1, 7, 42, 999, 5000, 9999, 123456]) {
      expect(roomIdFor(i)).toMatch(ROOM_ID_PATTERN);
      expect(roomIdFor(i)).toHaveLength(32);
    }
  });

  it("is deterministic, so a failing run can be replayed", () => {
    expect(roomIdFor(1234)).toBe(roomIdFor(1234));
  });

  it("does not collide across a full-profile range of rooms", () => {
    // Two clients landing in the same room by accident would silently change
    // the per-room fan-out being measured.
    const ids = new Set<string>();
    for (let i = 0; i < 20000; i++) ids.add(roomIdFor(i));
    expect(ids.size).toBe(20000);
  });
});

describe("client identifiers", () => {
  it("stays inside the relay's length limits", () => {
    for (const [w, c] of [
      [0, 0],
      [4, 1249],
      [9, 999999],
    ] as Array<[number, number]>) {
      expect(identityKeyFor(w, c).length).toBeGreaterThan(0);
      expect(identityKeyFor(w, c).length).toBeLessThanOrEqual(RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH);
      expect(ed25519KeyFor(w, c).length).toBeLessThanOrEqual(RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH);
    }
  });

  it("gives every client in every worker a distinct identity key", () => {
    // handleJoin closes the older socket on an identity-key collision with code
    // 4005. A colliding generator would look like the relay dropping load.
    const keys = new Set<string>();
    for (let w = 0; w < 5; w++) {
      for (let c = 0; c < 2000; c++) keys.add(identityKeyFor(w, c));
    }
    expect(keys.size).toBe(5 * 2000);
  });

  it("keeps the identity key and the Ed25519 key distinct", () => {
    expect(identityKeyFor(1, 1)).not.toBe(ed25519KeyFor(1, 1));
  });

  it("clamps the one-time key batch to the relay's 1..20 range", () => {
    expect(Object.keys(oneTimeKeysFor(0, 0, 0))).toHaveLength(1);
    expect(Object.keys(oneTimeKeysFor(0, 0, 5))).toHaveLength(5);
    expect(Object.keys(oneTimeKeysFor(0, 0, 999))).toHaveLength(RELAY_LIMITS.MAX_ONE_TIME_KEYS);
    for (const [k, v] of Object.entries(oneTimeKeysFor(3, 77, 20))) {
      expect(k.length).toBeLessThanOrEqual(RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH);
      expect(v.length).toBeLessThanOrEqual(RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH);
    }
  });
});

describe("messages the harness sends", () => {
  it("builds a join the relay's validator accepts", () => {
    for (const [w, c, otk] of [
      [0, 0, 1],
      [4, 1249, 5],
      [2, 99999, 20],
    ] as Array<[number, number, number]>) {
      expect(checkJoinAgainstRelayRules(buildJoin(w, c, otk))).toEqual([]);
    }
  });

  it("sets create on every join to avoid a room-creation race", () => {
    // handleJoin only reads `create` when the room is missing, so setting it
    // everywhere removes a race that would be counted as a relay failure.
    expect(buildJoin(0, 0, 5).create).toBe(true);
  });

  it("builds a probe the relay's validator accepts", () => {
    const probe = buildProbe("sender-key", "token-1", 1024, Date.now());
    expect(checkProbeAgainstRelayRules(probe)).toEqual([]);
    expect(probe.ciphertext).toHaveLength(1024);
    expect(probe.sessionId).toBe("token-1");
  });

  it("clamps an oversized ciphertext instead of sending a frame that gets closed", () => {
    // A ciphertext over MAX_CIPHERTEXT_LENGTH closes the socket with 4003,
    // which would be recorded as capacity loss.
    const probe = buildProbe("sender-key", "t", 10_000_000, Date.now());
    expect(probe.ciphertext).toHaveLength(RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH);
    expect(checkProbeAgainstRelayRules(probe)).toEqual([]);
  });

  it("truncates an over-long session id to the relay's limit", () => {
    const probe = buildProbe("sender-key", "t".repeat(200), 64, Date.now());
    expect(probe.sessionId).toHaveLength(RELAY_LIMITS.MAX_SESSION_ID_LENGTH);
    expect(checkProbeAgainstRelayRules(probe)).toEqual([]);
  });

  it("keeps the rule checker honest by rejecting a message that breaks a rule", () => {
    // If the checker passed everything it would guard nothing.
    const bad = buildJoin(0, 0, 5);
    bad.identityKey = "x".repeat(RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH + 1);
    expect(checkJoinAgainstRelayRules(bad)).not.toEqual([]);

    const noKeys = buildJoin(0, 0, 5);
    noKeys.oneTimeKeys = {};
    expect(checkJoinAgainstRelayRules(noKeys)).not.toEqual([]);

    const emptyCipher = buildProbe("s", "t", 64, Date.now());
    emptyCipher.ciphertext = "";
    expect(checkProbeAgainstRelayRules(emptyCipher)).not.toEqual([]);

    const badTimestamp = buildProbe("s", "t", 64, Date.now());
    badTimestamp.timestamp = NaN;
    expect(checkProbeAgainstRelayRules(badTimestamp)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The limits the harness believes the relay declares
// ---------------------------------------------------------------------------

describe("RELAY_LIMITS", () => {
  // Read the relay itself. The previous version of this test compared the
  // harness copy against a third hardcoded copy written here, so it caught
  // someone editing the harness and not someone editing the relay — which is
  // the drift it said it prevented. Changing a cap in relay.ts alone left it
  // green with the harness stale.
  const relaySource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
    "utf8",
  );

  function declared(name: string): number {
    const m = relaySource.match(new RegExp(`^const ${name} = ([\\d_]+);`, "m"));
    expect(m, `${name} is not declared in server/relay.ts`).toBeTruthy();
    return Number(m![1].replace(/_/g, ""));
  }

  it("names every limit the relay declares", () => {
    expect(Object.keys(RELAY_LIMITS).length).toBeGreaterThan(0);
  });

  for (const name of Object.keys(RELAY_LIMITS)) {
    it(`${name} matches server/relay.ts`, () => {
      expect(RELAY_LIMITS[name as keyof typeof RELAY_LIMITS]).toBe(
        declared(name),
      );
    });
  }

  it("copies the room-id pattern verbatim", () => {
    const m = relaySource.match(/^const ROOM_ID_PATTERN = (\/.*\/);/m);
    expect(m, "ROOM_ID_PATTERN not found in server/relay.ts").toBeTruthy();
    expect(m![1]).toBe(String(ROOM_ID_PATTERN));
  });

  it("derives the broadcast budget the same way the relay does", () => {
    // The relay computes it from the rate and the window rather than writing a
    // number, so a literal here would go stale the moment either input moved.
    const decl = relaySource.match(/const BROADCAST_BUDGET =[\s\S]*?;/);
    expect(decl, "BROADCAST_BUDGET not found in server/relay.ts").toBeTruthy();
    expect(decl![0]).toMatch(/BROADCAST_RATE_LIMIT/);
    expect(decl![0]).toMatch(/BROADCAST_WINDOW_MS/);
    expect(BROADCAST_BUDGET).toBe(
      declared("BROADCAST_RATE_LIMIT") * (declared("BROADCAST_WINDOW_MS") / 1000),
    );
  });

  it("derives the push subscription cap the same way the relay does", () => {
    // The relay sets it from MAX_CLIENTS_PER_ROOM rather than writing a number,
    // because a push subscription is only useful to a member.
    const decl = relaySource.match(/const MAX_PUSH_SUBS_PER_ROOM = .*;/);
    expect(decl, "MAX_PUSH_SUBS_PER_ROOM not found in server/relay.ts").toBeTruthy();
    expect(decl![0]).toMatch(/MAX_CLIENTS_PER_ROOM/);
    expect(MAX_PUSH_SUBS_PER_ROOM).toBe(declared("MAX_CLIENTS_PER_ROOM"));
  });

  it("no longer declares a room ceiling that cannot be reached", () => {
    // A room exists only while it holds at least one client, so live rooms can
    // never exceed live connections. MAX_ROOMS was 10,000 against a 5,000
    // connection cap, so the check that enforced it sat on an unreachable
    // branch while reading like a guard rail. It is now the number that binds.
    expect(RELAY_LIMITS.MAX_ROOMS).toBeLessThanOrEqual(
      RELAY_LIMITS.MAX_CONNECTIONS,
    );
  });
});

describe("buildKeyShare", () => {
  it("produces a frame the relay accepts", () => {
    // The first version used {type, body} where the relay wants
    // {messageType, ciphertext}. The relay closed 4003 and the burst probe
    // reported the relay as broken rather than the harness.
    const msg = buildKeyShare(identityKeyFor(0, 1), identityKeyFor(0, 2));
    expect(checkKeyShareAgainstRelayRules(msg)).toEqual([]);
  });

  it("names the Olm payload the way the relay validates it", () => {
    const msg = buildKeyShare(identityKeyFor(0, 1), identityKeyFor(0, 2));
    expect(Object.keys(msg.olmMessage).sort()).toEqual([
      "ciphertext",
      "messageType",
    ]);
  });

  it("catches a malformed Olm payload", () => {
    const msg = buildKeyShare(identityKeyFor(0, 1), identityKeyFor(0, 2));
    expect(
      checkKeyShareAgainstRelayRules({
        ...msg,
        olmMessage: { messageType: 7, ciphertext: "" },
      }).length,
    ).toBe(2);
  });

  it("addresses a peer other than the sender", () => {
    const msg = buildKeyShare(identityKeyFor(0, 1), identityKeyFor(0, 2));
    expect(msg.targetIdentityKey).not.toBe(msg.senderIdentityKey);
  });
});
