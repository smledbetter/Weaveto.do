// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { replayTaskEvents } from "$lib/tasks/replay";
import type { TaskEvent, Task } from "$lib/tasks/types";

/**
 * Replaying an offline backlog, including the case that used to lose it.
 *
 * This logic lived in a setTimeout inside a handler inside joinRoom(), so the
 * only way to reach it was Playwright, and no Playwright test ever arranged
 * for the socket to drop part-way through a replay. That is precisely the
 * scenario a replay runs in: it happens immediately after a reconnect, on a
 * connection that has just proven itself unreliable.
 *
 * The old loop emptied the queue before sending. A throw on the third of five
 * events lost the last three from memory, left pendingSync cleared on events
 * that never went anywhere, and skipped the line that stopped the spinner.
 */

function task(id: string): Task {
  return {
    id,
    title: `task ${id}`,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
    pendingSync: true,
  } as Task;
}

function event(id: string): TaskEvent {
  return {
    type: "task_created",
    taskId: id,
    task: task(id),
    timestamp: 0,
    actorId: "me",
  } as TaskEvent;
}

/** A transport that accepts everything. */
const acceptAll = () => {};

/** A transport that throws on the nth call, counting from 1. */
function failsOn(n: number) {
  let calls = 0;
  return vi.fn(() => {
    calls += 1;
    if (calls === n) throw new Error("Not connected to room");
  });
}

describe("replayTaskEvents", () => {
  describe("the happy path", () => {
    it("sends every event, in order", () => {
      const events = [event("a"), event("b"), event("c")];
      const send = vi.fn();

      const out = replayTaskEvents(events, send);

      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls.map((c) => (c[0] as TaskEvent).taskId)).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(out.complete).toBe(true);
      expect(out.remaining).toEqual([]);
      expect(out.sent).toHaveLength(3);
    });

    it("clears pendingSync on what it sent", () => {
      const events = [event("a"), event("b")];
      replayTaskEvents(events, acceptAll);
      expect(events.every((e) => e.task?.pendingSync === false)).toBe(true);
    });

    it("an empty queue is complete and sends nothing", () => {
      const send = vi.fn();
      const out = replayTaskEvents([], send);
      expect(send).not.toHaveBeenCalled();
      expect(out.complete).toBe(true);
    });
  });

  describe("the socket drops part-way through", () => {
    it("keeps the failed event and everything after it", () => {
      // The case the old code lost. Three of five go, two are still owed, and
      // the one that threw is owed as well because it never arrived.
      const events = [event("a"), event("b"), event("c"), event("d"), event("e")];

      const out = replayTaskEvents(events, failsOn(3));

      expect(out.complete).toBe(false);
      expect(out.sent.map((e) => e.taskId)).toEqual(["a", "b"]);
      expect(out.remaining.map((e) => e.taskId)).toEqual(["c", "d", "e"]);
    });

    it("stops rather than skipping the failure and carrying on", () => {
      // These are ordered events against a shared log. Continuing past a
      // refusal reorders that log for every other member.
      const send = failsOn(2);
      replayTaskEvents([event("a"), event("b"), event("c")], send);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("leaves pendingSync set on everything it did not send", () => {
      // The old code cleared the flag before the send, so an event that never
      // left showed in the UI as though it had synced.
      const events = [event("a"), event("b"), event("c")];

      replayTaskEvents(events, failsOn(2));

      expect(events[0].task?.pendingSync).toBe(false);
      expect(events[1].task?.pendingSync).toBe(true);
      expect(events[2].task?.pendingSync).toBe(true);
    });

    it("loses nothing: sent and remaining together are the whole queue", () => {
      // The property that matters. Whatever the transport does, every event is
      // accounted for exactly once.
      const events = [event("a"), event("b"), event("c"), event("d")];

      const out = replayTaskEvents(events, failsOn(3));

      expect([...out.sent, ...out.remaining].map((e) => e.taskId)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    });

    it("a transport that refuses immediately keeps the entire queue", () => {
      const events = [event("a"), event("b")];
      const out = replayTaskEvents(events, failsOn(1));
      expect(out.sent).toEqual([]);
      expect(out.remaining).toHaveLength(2);
      expect(out.complete).toBe(false);
    });
  });

  describe("it does not mutate the queue it was given", () => {
    it("returns a new array rather than splicing the input", () => {
      // The caller assigns `remaining` back to reactive state. Handing back a
      // mutated copy of the same array would make that assignment a no-op.
      const events = [event("a"), event("b"), event("c")];
      const out = replayTaskEvents(events, failsOn(2));

      expect(events).toHaveLength(3);
      expect(out.remaining).not.toBe(events);
    });
  });

  describe("events with no task attached", () => {
    it("sends them without touching pendingSync", () => {
      // `task` is optional on TaskEvent. A status change carries only the id.
      const bare: TaskEvent = {
        type: "task_status_changed",
        taskId: "x",
        timestamp: 0,
        actorId: "me",
      };
      const out = replayTaskEvents([bare], acceptAll);
      expect(out.complete).toBe(true);
      expect(out.sent).toHaveLength(1);
    });

    it("does not throw when the failing event has no task either", () => {
      const bare: TaskEvent = {
        type: "task_status_changed",
        taskId: "x",
        timestamp: 0,
        actorId: "me",
      };
      expect(() => replayTaskEvents([bare], failsOn(1))).not.toThrow();
    });
  });
});
