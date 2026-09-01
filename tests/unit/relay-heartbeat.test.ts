// @vitest-environment node
/**
 * Defect: no ping/pong keepalive. A half-open TCP socket never fires `close`,
 * so its slot in the connection counters was never released and the caps
 * ratcheted closed until live clients were refused by an idle relay.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sweepHeartbeat,
  acquireConnection,
  releaseConnection,
  evaluateUpgrade,
} from "../../server/relay";

const ROOM_PATH = "/room/0123456789abcdef0123456789abcdef";
const ORIGINS: ReadonlySet<string> = new Set(["https://weaveto.do"]);

interface FakeSocket {
  isAlive?: boolean;
  pings: number;
  terminated: boolean;
  ping(): void;
  terminate(): void;
}

/**
 * A socket that records what the sweep did to it. `onTerminate` stands in for
 * the `close` event that `ws` emits when a socket is terminated.
 */
function fakeSocket(
  init: { isAlive?: boolean; onTerminate?: () => void } = {},
): FakeSocket {
  return {
    isAlive: "isAlive" in init ? init.isAlive : true,
    pings: 0,
    terminated: false,
    ping() {
      this.pings++;
    },
    terminate() {
      this.terminated = true;
      init.onTerminate?.();
    },
  };
}

/** A peer that answers every ping. */
function pong(socket: FakeSocket): void {
  socket.isAlive = true;
}

/**
 * The per-address cap, read from the relay rather than written down here.
 *
 * These assertions used to hardcode 10 and broke when the cap was raised to
 * 50, which is the wrong kind of failure: the behaviour was still correct and
 * only the number had moved. Reading it means the tests check the property and
 * survive the value changing.
 */
function perIpCap(): number {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
    "utf8",
  );
  const m = src.match(/^const MAX_CONNECTIONS_PER_IP = (\d+)/m);
  if (!m) throw new Error("MAX_CONNECTIONS_PER_IP not found");
  return Number(m[1]);
}

describe("sweepHeartbeat", () => {
  it("pings every connection and reaps nothing on the first pass", () => {
    const sockets = [fakeSocket(), fakeSocket()];
    expect(sweepHeartbeat(sockets)).toBe(0);
    expect(sockets.every((s) => s.pings === 1)).toBe(true);
    expect(sockets.every((s) => s.terminated)).toBe(false);
  });

  it("marks a socket unanswered before pinging it", () => {
    const socket = fakeSocket();
    sweepHeartbeat([socket]);
    expect(socket.isAlive).toBe(false);
  });

  it("keeps a responsive peer forever", () => {
    const socket = fakeSocket();
    for (let i = 0; i < 20; i++) {
      sweepHeartbeat([socket]);
      pong(socket);
    }
    expect(socket.terminated).toBe(false);
    expect(socket.pings).toBe(20);
  });

  it("terminates a peer that missed the previous ping", () => {
    const socket = fakeSocket();
    sweepHeartbeat([socket]); // asks
    expect(socket.terminated).toBe(false); // no answer is not yet a verdict
    sweepHeartbeat([socket]); // still no pong
    expect(socket.terminated).toBe(true);
  });

  it("does not ping a socket it just terminated", () => {
    const socket = fakeSocket();
    sweepHeartbeat([socket]);
    sweepHeartbeat([socket]);
    expect(socket.pings).toBe(1);
  });

  it("treats a socket with no flag yet as alive", () => {
    // It has not been asked, so it cannot have failed to answer.
    const socket = fakeSocket({ isAlive: undefined });
    expect(sweepHeartbeat([socket])).toBe(0);
    expect(socket.terminated).toBe(false);
  });

  it("returns the number reaped", () => {
    const dead = [fakeSocket({ isAlive: false }), fakeSocket({ isAlive: false })];
    const live = fakeSocket();
    expect(sweepHeartbeat([...dead, live])).toBe(2);
  });

  it("reaps only the silent peers in a mixed set", () => {
    const live = fakeSocket();
    const dead = fakeSocket({ isAlive: false });
    sweepHeartbeat([live, dead]);
    expect(dead.terminated).toBe(true);
    expect(live.terminated).toBe(false);
  });

  it("handles an empty set", () => {
    expect(sweepHeartbeat([])).toBe(0);
  });

  it("accepts a Set, matching wss.clients", () => {
    const socket = fakeSocket({ isAlive: false });
    expect(sweepHeartbeat(new Set([socket]))).toBe(1);
  });
});

describe("counter drift from half-open sockets", () => {
  it("gives capped-out slots back once the dead sockets are reaped", () => {
    const state = { total: 0, perIp: new Map<string, number>() };
    const ip = "203.0.113.7";
    const sockets = new Set<FakeSocket>();

    // One client fills its bucket, then every socket goes half-open: the peer
    // vanished without a FIN, so `close` never fires on its own and the slots
    // stay claimed.
    for (let i = 0; i < perIpCap(); i++) {
      acquireConnection(state, ip);
      sockets.add(fakeSocket({ onTerminate: () => releaseConnection(state, ip) }));
    }

    const refused = evaluateUpgrade(
      { origin: undefined, pathname: ROOM_PATH, ip },
      state,
      ORIGINS,
    );
    expect(refused.status).toBe(429);

    sweepHeartbeat(sockets); // asks
    expect(sweepHeartbeat(sockets)).toBe(perIpCap()); // nobody answered

    expect(state.total).toBe(0);
    expect(state.perIp.size).toBe(0);

    const allowed = evaluateUpgrade(
      { origin: undefined, pathname: ROOM_PATH, ip },
      state,
      ORIGINS,
    );
    expect(allowed.accept).toBe(true);
  });

  it("keeps the global cap from ratcheting shut on dead connections", () => {
    const state = { total: 0, perIp: new Map<string, number>() };
    const sockets = new Set<FakeSocket>();

    // 5000 half-open sockets from distinct clients is the global cap, reached
    // with no live traffic at all.
    for (let i = 0; i < 5_000; i++) {
      const ip = `203.0.113.${i}`;
      acquireConnection(state, ip);
      sockets.add(fakeSocket({ onTerminate: () => releaseConnection(state, ip) }));
    }

    expect(
      evaluateUpgrade(
        { origin: undefined, pathname: ROOM_PATH, ip: "198.51.100.1" },
        state,
        ORIGINS,
      ).status,
    ).toBe(503);

    sweepHeartbeat(sockets);
    sweepHeartbeat(sockets);

    expect(state.total).toBe(0);
    expect(
      evaluateUpgrade(
        { origin: undefined, pathname: ROOM_PATH, ip: "198.51.100.1" },
        state,
        ORIGINS,
      ).accept,
    ).toBe(true);
  });

  it("leaves a responsive client's slot claimed", () => {
    // Reaping must not free slots that are still in use.
    const state = { total: 0, perIp: new Map<string, number>() };
    const ip = "203.0.113.8";
    acquireConnection(state, ip);
    const socket = fakeSocket({ onTerminate: () => releaseConnection(state, ip) });

    for (let i = 0; i < 5; i++) {
      sweepHeartbeat([socket]);
      pong(socket);
    }

    expect(state.total).toBe(1);
    expect(state.perIp.get(ip)).toBe(1);
  });
});
