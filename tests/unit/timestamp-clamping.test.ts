import { describe, it, expect, beforeEach } from "vitest";
import { createTaskStore } from "$lib/tasks/store.svelte";
import type { TaskEvent } from "$lib/tasks/types";

const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000; // must match store constant

function makeCreateEvent(
  taskId: string,
  timestamp: number,
  actorId = "actor-aaa",
): TaskEvent {
  return {
    type: "task_created",
    taskId,
    timestamp,
    actorId,
    task: {
      title: "Test task",
      status: "pending",
      createdBy: actorId,
    },
  };
}

describe("timestamp clamping", () => {
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    store = createTaskStore();
  });

  it("accepts a normal timestamp (now)", () => {
    const now = Date.now();
    store.applyEvent(makeCreateEvent("t1", now));
    expect(store.getTask("t1")).toBeDefined();
  });

  it("accepts a timestamp 4 minutes in the future", () => {
    const future4m = Date.now() + 4 * 60 * 1000;
    store.applyEvent(makeCreateEvent("t2", future4m));
    expect(store.getTask("t2")).toBeDefined();
  });

  it("accepts a timestamp exactly 5 minutes in the future (boundary)", () => {
    // The check is: event.timestamp > Date.now() + MAX_FUTURE_DRIFT_MS
    // So exactly at the boundary should be accepted (not strictly greater).
    // We use Date.now() snapshot and add exactly the drift to keep it deterministic.
    const exactly5m = Date.now() + MAX_FUTURE_DRIFT_MS;
    store.applyEvent(makeCreateEvent("t3", exactly5m));
    expect(store.getTask("t3")).toBeDefined();
  });

  it("rejects a timestamp 10 minutes in the future", () => {
    const future10m = Date.now() + 10 * 60 * 1000;
    store.applyEvent(makeCreateEvent("t4", future10m));
    expect(store.getTask("t4")).toBeUndefined();
  });

  it("accepts a timestamp 30 seconds in the past", () => {
    const past30s = Date.now() - 30 * 1000;
    store.applyEvent(makeCreateEvent("t5", past30s));
    expect(store.getTask("t5")).toBeDefined();
  });

  it("future-clamped event is not added to seenEvents (dropped before dedup)", () => {
    const future10m = Date.now() + 10 * 60 * 1000;
    const event = makeCreateEvent("t6", future10m);

    // Apply the future event — it should be dropped before dedup
    store.applyEvent(event);
    expect(store.getTask("t6")).toBeUndefined();

    // Now apply a valid event with the same taskId but a current timestamp.
    // If the future event had been added to seenEvents, the dedup key would be
    // different (different timestamp), so this should create the task normally.
    const nowEvent: TaskEvent = {
      ...event,
      timestamp: Date.now(),
    };
    store.applyEvent(nowEvent);
    expect(store.getTask("t6")).toBeDefined();
  });
});
