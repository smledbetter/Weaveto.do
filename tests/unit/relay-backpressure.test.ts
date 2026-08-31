// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fanOut, admitToWindow, type FanOutSocket } from "../../server/relay";

/**
 * The relay must not queue without limit for a member who cannot keep up.
 *
 * `handleEncrypted` sent to every member and never asked whether the previous
 * send had left the process. Measured under a load every declared cap allowed,
 * that reached 463 MiB on a 1 GB machine and lost 31% of messages. The queued
 * frames were the cost: 100 MiB of `arrayBuffers` against a 29 MiB heap.
 *
 * See docs/CAPACITY.md for the measurements these tests encode.
 */

const OPEN = 1;
const CLOSING = 2;

/** A socket that records what was sent to it and whether it was cut off. */
function socket(bufferedAmount = 0, readyState = OPEN) {
  const sent: string[] = [];
  let terminated = false;
  const ws: FanOutSocket = {
    readyState,
    bufferedAmount,
    send: (d: string) => {
      sent.push(d);
    },
    terminate: () => {
      terminated = true;
    },
  };
  return {
    ws,
    sent,
    get terminated() {
      return terminated;
    },
  };
}

function room(entries: Record<string, { ws: FanOutSocket }>) {
  return new Map(Object.entries(entries));
}

describe("fan-out delivers to the room", () => {
  it("sends to every member but the sender", () => {
    const a = socket();
    const b = socket();
    const c = socket();
    const dropped = fanOut(room({ a: a, b: b, c: c }), "a", "frame");

    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual(["frame"]);
    expect(c.sent).toEqual(["frame"]);
    expect(dropped).toEqual([]);
  });

  it("skips a socket that is not open", () => {
    const b = socket(0, CLOSING);
    fanOut(room({ a: socket(), b: b }), "a", "frame");
    expect(b.sent).toEqual([]);
    expect(b.terminated).toBe(false);
  });
});

describe("fan-out drops a member who cannot drain", () => {
  it("terminates a socket already over the limit", () => {
    const slow = socket(2_000);
    const dropped = fanOut(room({ a: socket(), slow }), "a", "frame", 1_000);

    expect(slow.terminated, "a backlogged socket must be cut off").toBe(true);
    expect(dropped).toEqual(["slow"]);
  });

  it("does not add to a queue it has judged too long", () => {
    // Sending anyway is what makes the queue unbounded. The check is only
    // worth having if it actually withholds the write.
    const slow = socket(2_000);
    fanOut(room({ a: socket(), slow }), "a", "frame", 1_000);
    expect(slow.sent).toEqual([]);
  });

  it("terminates rather than closing", () => {
    // close() queues a close frame behind the backlog and leaves the memory
    // pinned. A peer that has not drained a megabyte will not drain that
    // either. The interface deliberately has no close(), so this asserts the
    // source rather than the mock.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
      "utf8",
    );
    const body = src.match(/export function fanOut\([\s\S]*?\n\}/)![0];
    expect(body).toMatch(/\.terminate\(\)/);
    expect(body).not.toMatch(/\.close\(/);
  });

  it("keeps serving everyone else in the same room", () => {
    // A slow member must not cost the room its delivery.
    const ok = socket();
    const slow = socket(2_000);
    fanOut(room({ a: socket(), slow, ok }), "a", "frame", 1_000);
    expect(ok.sent).toEqual(["frame"]);
  });

  it("lets a member at the limit through", () => {
    // The limit is a ceiling on backlog, not a target to undershoot. Cutting
    // at exactly the allowance would drop members the budget says are fine.
    const edge = socket(1_000);
    const dropped = fanOut(room({ a: socket(), edge }), "a", "frame", 1_000);
    expect(edge.sent).toEqual(["frame"]);
    expect(dropped).toEqual([]);
  });
});

describe("the caps that bound the aggregate", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
    "utf8",
  );
  const constant = (name: string): number => {
    const m = src.match(new RegExp(`const ${name} = ([\\d_]+)`));
    expect(m, `${name} not found`).toBeTruthy();
    return Number(m![1].replace(/_/g, ""));
  };

  it("holds room amplification to the measured-safe factor", () => {
    // Each message to a room of n is relayed n-1 times. At 50 the relay lost a
    // third of all messages inside its own caps.
    expect(constant("MAX_CLIENTS_PER_ROOM")).toBeLessThanOrEqual(10);
  });

  it("lets the protocol's own burst through", () => {
    // Joining or re-keying emits one key_share per member with no pacing, so a
    // client in a full room legitimately sends MAX_CLIENTS_PER_ROOM - 1 frames
    // back to back. A global limit below that disconnects key rotation with
    // 4029. Cutting the single rate limit to 5 did exactly this.
    expect(constant("MSG_RATE_LIMIT")).toBeGreaterThan(
      constant("MAX_CLIENTS_PER_ROOM"),
    );
  });

  it("averages the broadcast budget rather than policing each second", () => {
    // A one-second window charges a client for the arrival pattern of its
    // packets. Measured: senders pacing at 4/s against a 5-per-second budget
    // still collected 6,317 disconnects, starting exactly where the relay
    // itself slowed past a second and bunched their sends.
    expect(constant("BROADCAST_WINDOW_MS")).toBeGreaterThan(1000);
  });

  it("keeps the sustained rate the averaging is meant to preserve", () => {
    // Widening the window must not quietly raise the throughput the caps
    // permit, because that is what the aggregate bound is computed from. The
    // shipped budget has to follow from the rate and the window: an earlier
    // version of this test recomputed the product and compared it to itself,
    // so a hand-set budget of 80 passed while quadrupling the real rate.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
      "utf8",
    );
    const decl = src.match(/const BROADCAST_BUDGET =[\s\S]*?;/)![0];
    expect(decl).toMatch(/BROADCAST_RATE_LIMIT/);
    expect(decl).toMatch(/BROADCAST_WINDOW_MS/);
    expect(decl).not.toMatch(/=\s*\d+\s*;/);
  });

  it("charges only the type that is broadcast to the tight budget", () => {
    // `encrypted` is the only type the relay multiplies. Pricing a unicast
    // key_share the same way is what made the burst look like abuse.
    expect(constant("BROADCAST_RATE_LIMIT")).toBeLessThan(
      constant("MSG_RATE_LIMIT"),
    );
  });

  it("keeps the worst case the caps permit at or under what was measured", () => {
    // Backpressure decides who suffers, not how much work the relay is asked
    // to do. Only the caps bound the product, so the product is asserted.
    const worstCase =
      constant("MAX_CONNECTIONS") *
      constant("BROADCAST_RATE_LIMIT") *
      (constant("MAX_CLIENTS_PER_ROOM") - 1);
    // Message loss began above roughly 240,000 outbound per second.
    expect(worstCase).toBeLessThanOrEqual(240_000);
  });

  it("does not claim a room ceiling above what connections allow", () => {
    // A room needs a live client, so live rooms can never exceed connections.
    // A larger MAX_ROOMS is dead code that reads like a guard rail.
    expect(constant("MAX_ROOMS")).toBeLessThanOrEqual(
      constant("MAX_CONNECTIONS"),
    );
  });
});

describe("the sliding window", () => {
  it("admits up to the limit and then refuses", () => {
    const w: number[] = [];
    for (let i = 0; i < 5; i++) expect(admitToWindow(w, 1000, 5)).toBe(true);
    expect(admitToWindow(w, 1000, 5)).toBe(false);
  });

  it("does not record a refused event", () => {
    // Recording it would extend the window by the very thing it refused, so a
    // client that kept trying could never recover even after going quiet.
    const w: number[] = [];
    for (let i = 0; i < 5; i++) admitToWindow(w, 1000, 5);
    admitToWindow(w, 1000, 5);
    expect(w).toHaveLength(5);
  });

  it("forgets events older than a second", () => {
    const w: number[] = [];
    for (let i = 0; i < 5; i++) admitToWindow(w, 1000, 5);
    expect(admitToWindow(w, 2001, 5)).toBe(true);
    expect(w).toEqual([2001]);
  });

  it("keeps an event exactly one second old", () => {
    // The relay drops on `> 1000`, so the boundary belongs to the window.
    const w: number[] = [];
    admitToWindow(w, 1000, 1);
    expect(admitToWindow(w, 2000, 1)).toBe(false);
  });

  it("counts the two budgets separately", () => {
    // The whole point of the split: a client may fill its broadcast budget and
    // still send unicast frames, and vice versa.
    const global: number[] = [];
    const broadcast: number[] = [];
    for (let i = 0; i < 5; i++) {
      expect(admitToWindow(global, 1000, 20)).toBe(true);
      expect(admitToWindow(broadcast, 1000, 5)).toBe(true);
    }
    expect(admitToWindow(broadcast, 1000, 5)).toBe(false);
    expect(admitToWindow(global, 1000, 20)).toBe(true);
  });
});

describe("the averaged broadcast budget", () => {
  it("absorbs a burst that a one-second window would refuse", () => {
    // 8 frames landing in the same instant is a stalled client catching up,
    // not an attack. Over four seconds it is well inside a 5/s average.
    const w: number[] = [];
    for (let i = 0; i < 8; i++) {
      expect(admitToWindow(w, 1000, 20, 4000)).toBe(true);
    }
  });

  it("still refuses a client that sustains more than the average", () => {
    // The point of averaging is tolerance of shape, not of volume.
    const w: number[] = [];
    for (let i = 0; i < 20; i++) admitToWindow(w, 1000 + i, 20, 4000);
    expect(admitToWindow(w, 1500, 20, 4000)).toBe(false);
  });

  it("holds the budget for the whole window, not just a second", () => {
    // An earlier version tested recovery at 5001ms, which is past both a
    // one-second and a four-second window, so it passed against a relay that
    // ignored the window argument entirely. 2001ms tells them apart: the
    // events are 1001ms old, expired under a second and live under four.
    const w: number[] = [];
    for (let i = 0; i < 20; i++) admitToWindow(w, 1000, 20, 4000);
    expect(admitToWindow(w, 2001, 20, 4000)).toBe(false);
  });

  it("lets the budget recover once the window rolls past", () => {
    const w: number[] = [];
    for (let i = 0; i < 20; i++) admitToWindow(w, 1000, 20, 4000);
    expect(admitToWindow(w, 5001, 20, 4000)).toBe(true);
  });

  it("defaults to a one-second window when none is given", () => {
    // The global pre-parse limit relies on the default.
    const w: number[] = [];
    for (let i = 0; i < 3; i++) admitToWindow(w, 1000, 3);
    expect(admitToWindow(w, 1500, 3)).toBe(false);
    expect(admitToWindow(w, 2001, 3)).toBe(true);
  });
});

describe("the two budgets compose", () => {
  it("bounds one instant by the global limit, not the averaged budget", () => {
    // A client that fires everything at once cannot spend a budget that is
    // averaged over seconds. The global per-second limit binds first, and one
    // of its slots is already taken by the join. Measured against the real
    // relay: 19 frames relayed from a 30-frame burst, not 20.
    const global: number[] = [];
    const broadcast: number[] = [];
    admitToWindow(global, 1000, 20); // the join

    let relayed = 0;
    for (let i = 0; i < 30; i++) {
      if (!admitToWindow(global, 1000, 20)) break;
      if (!admitToWindow(broadcast, 1000, 20, 4000)) break;
      relayed++;
    }
    expect(relayed).toBe(19);
  });

  it("lets the averaged budget bind when the sending is spread out", () => {
    // Spread across the window the global limit never fills, so the broadcast
    // budget is what stops them. This is the case the budget exists for.
    const global: number[] = [];
    const broadcast: number[] = [];
    let relayed = 0;
    for (let i = 0; i < 30; i++) {
      const now = 1000 + i * 150; // under 20/s, spread over 4.5s
      if (!admitToWindow(global, now, 20)) break;
      if (!admitToWindow(broadcast, now, 20, 4000)) break;
      relayed++;
    }
    expect(relayed).toBeGreaterThan(19);
    expect(relayed).toBeLessThan(30);
  });
});
