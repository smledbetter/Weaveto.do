// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The client must not be able to exceed the relay's broadcast budget just by
 * doing the thing the app is for.
 *
 * Task events used to go out one frame each. Creating tasks quickly then
 * looked like a flood, and the relay disconnected the client with 4029 partway
 * through, losing the rest. Raising the limit does not fix that, because
 * nothing bounds how many tasks someone creates. Sending fewer frames does.
 *
 * The flush interval and the relay's budget are set in different files, so the
 * relationship between them is asserted here rather than left to a comment.
 * Behaviour is covered by tests/e2e/task-batching.spec.ts, which drives real
 * bulk creation between two browsers.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const relaySource = read("server/relay.ts");
const sessionSource = read("src/lib/room/session.ts");

function constant(src: string, name: string): number {
  const m = src.match(new RegExp(`^const ${name} = ([\\d_]+)`, "m"));
  expect(m, `${name} not found`).toBeTruthy();
  return Number(m![1].replace(/_/g, ""));
}

describe("outbound task events stay inside the relay's budget", () => {
  const flushMs = constant(sessionSource, "TASK_EVENT_FLUSH_MS");
  const broadcastPerSecond = constant(relaySource, "BROADCAST_RATE_LIMIT");

  it("flushes slower than the broadcast budget allows", () => {
    // At the budget exactly there is no room left for chat or sync, and the
    // relay refuses on the limit-th frame rather than after it.
    expect(1000 / flushMs).toBeLessThan(broadcastPerSecond);
  });

  it("leaves headroom for the other things a client sends", () => {
    // Chat messages and sync flushes are broadcast too.
    expect(broadcastPerSecond - 1000 / flushMs).toBeGreaterThanOrEqual(1);
  });

  it("keeps the delay short enough to feel immediate to other members", () => {
    expect(flushMs).toBeLessThanOrEqual(500);
  });

  it("caps how many events ride in one frame", () => {
    // An unbounded batch eventually exceeds MAX_CIPHERTEXT_LENGTH and the
    // relay closes 4003, which is a worse failure than the one being fixed.
    const perFrame = constant(sessionSource, "MAX_TASK_EVENTS_PER_FRAME");
    expect(perFrame).toBeGreaterThan(1);
    expect(perFrame).toBeLessThanOrEqual(50);
  });

  it("still sends a lone event in the original wire shape", () => {
    // A batch of one must not become a different message, or every ordinary
    // single task creation changes shape for no reason.
    expect(sessionSource).toMatch(
      /batch\.length === 1 \? \{ taskEvent: batch\[0\] \}/,
    );
  });

  it("delivers a received batch one event at a time", () => {
    // Everything downstream — task store, agent dispatch, notifications —
    // expects one event per message. A batch that skipped that path would
    // silently stop notifying.
    expect(sessionSource).toMatch(/payload\.taskEvents/);
    expect(sessionSource).toMatch(/for \(const taskEvent of payload\.taskEvents\)/);
  });
});
