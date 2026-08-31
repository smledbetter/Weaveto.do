import { describe, it, expect, beforeEach } from "vitest";
import { createTaskStore } from "$lib/tasks/store.svelte";
import type { TaskEvent } from "$lib/tasks/types";

function makeEvent(
  overrides: Partial<TaskEvent> & { taskId: string },
): TaskEvent {
  return {
    type: "task_created",
    timestamp: Date.now(),
    actorId: "actor-aaa",
    ...overrides,
  };
}

describe("sync-events: TaskStore event log and sync behaviour", () => {
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    store = createTaskStore();
  });

  // ─── Event Log ───────────────────────────────────────────────────────────────

  describe("Event Log", () => {
    it("applyEvent adds event to appliedEvents log (visible via getRecentEvents)", () => {
      const ts = Date.now();
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Log me", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const recent = store.getRecentEvents();
      expect(recent.length).toBe(1);
      expect(recent[0].taskId).toBe("t1");
      expect(recent[0].type).toBe("task_created");
    });

    it("duplicate events are not added to log (seenEvents dedup)", () => {
      const ts = Date.now();
      const event = makeEvent({
        taskId: "t1",
        type: "task_created",
        timestamp: ts,
        actorId: "actor-aaa",
        task: { title: "Once", status: "pending", createdBy: "actor-aaa" },
      });

      store.applyEvent(event);
      store.applyEvent(event); // exact same reference
      store.applyEvent({ ...event }); // structurally identical copy

      // Use a 1-hour window — the event was just created so it's well within range
      const recent = store.getRecentEvents(60 * 60 * 1000);
      expect(recent.length).toBe(1);
    });

    it("clearEventLog empties the log", () => {
      const ts = Date.now();
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "A", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      expect(store.getRecentEvents().length).toBe(1);
      store.clearEventLog();
      expect(store.getRecentEvents().length).toBe(0);
    });

    it("clear() also clears the event log", () => {
      const ts = Date.now();
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "B", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      expect(store.getRecentEvents().length).toBe(1);
      store.clear();
      expect(store.getRecentEvents().length).toBe(0);
    });
  });

  // ─── getRecentEvents ─────────────────────────────────────────────────────────

  describe("getRecentEvents", () => {
    it("returns events within the time window", () => {
      const now = Date.now();
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: now - 1000, // 1 second ago — well within 24h
          task: { title: "Recent", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const recent = store.getRecentEvents(24 * 60 * 60 * 1000);
      expect(recent.length).toBe(1);
    });

    it("excludes events older than the window", () => {
      const now = Date.now();
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

      // getRecentEvents filters by timestamp, so we need to bypass the future-drift
      // guard. Events in the distant past are fine — only future events are rejected.
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: twoDaysAgo,
          task: { title: "Old", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      // Default window = 24h, so a 2-day-old event should be excluded
      const recent = store.getRecentEvents();
      expect(recent.length).toBe(0);
    });

    it("returns shallow copies — modifying returned events does not affect store", () => {
      const ts = Date.now();
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Original", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const [returned] = store.getRecentEvents();
      // Mutate the returned copy
      (returned as TaskEvent).taskId = "mutated";

      // The store's internal log should be unaffected
      const [again] = store.getRecentEvents();
      expect(again.taskId).toBe("t1");
    });

    it("default window is 24 hours — event from 23h ago is included", () => {
      const now = Date.now();
      const twentyThreeHoursAgo = now - 23 * 60 * 60 * 1000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: twentyThreeHoursAgo,
          task: { title: "Almost old", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const recent = store.getRecentEvents(); // uses default 24h window
      expect(recent.length).toBe(1);
    });

    it("custom window works — 1 hour excludes event from 2 hours ago", () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const thirtyMinutesAgo = now - 30 * 60 * 1000;

      store.applyEvent(
        makeEvent({
          taskId: "t-old",
          type: "task_created",
          timestamp: twoHoursAgo,
          task: { title: "Two hours ago", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t-new",
          type: "task_created",
          timestamp: thirtyMinutesAgo,
          task: { title: "Thirty mins ago", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const recent = store.getRecentEvents(60 * 60 * 1000); // 1 hour window
      expect(recent.length).toBe(1);
      expect(recent[0].taskId).toBe("t-new");
    });

    it("returns empty array when no events have been applied", () => {
      const recent = store.getRecentEvents();
      expect(recent).toEqual([]);
    });
  });

  // ─── Conflict Resolution ─────────────────────────────────────────────────────

  describe("Conflict Resolution (concurrent edits)", () => {
    it("two users editing same task: higher timestamp wins", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      // Actor A updates at ts+100
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-aaa",
          task: { status: "in_progress" },
        }),
      );

      // Actor B updates at ts+50 (older — loses)
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 50,
          actorId: "actor-bbb",
          task: { status: "completed" },
        }),
      );

      expect(store.getTask("t1")!.status).toBe("in_progress");
    });

    it("two users editing same task at same timestamp: higher actorId wins", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      // actor-aaa updates at ts+100
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-aaa",
          task: { status: "in_progress" },
        }),
      );

      // actor-zzz updates at same ts+100 — actor-zzz > actor-aaa lexicographically
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-zzz",
          task: { status: "completed" },
        }),
      );

      // actor-zzz wins the tie
      expect(store.getTask("t1")!.status).toBe("completed");
    });

    it("lower actorId loses the tie at same timestamp", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      // actor-zzz updates first (wins)
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-zzz",
          task: { status: "completed" },
        }),
      );

      // actor-aaa updates at same ts — actor-aaa < actor-zzz, loses
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-aaa",
          task: { status: "in_progress" },
        }),
      );

      expect(store.getTask("t1")!.status).toBe("completed");
    });

    it("creating same task twice is deduplicated", () => {
      const ts = 1700000000000;
      const event = makeEvent({
        taskId: "t1",
        type: "task_created",
        timestamp: ts,
        actorId: "actor-aaa",
        task: { title: "Once", status: "pending", createdBy: "actor-aaa" },
      });

      store.applyEvent(event);
      store.applyEvent({ ...event, task: { ...event.task, title: "Duplicate" } });
      // Second is deduplicated (same key = taskId:type:timestamp:actorId)

      expect(store.getTaskCount()).toBe(1);
      expect(store.getTask("t1")!.title).toBe("Once");
    });

    it("events replayed in any order produce same result (convergence)", () => {
      const ts = 1700000000000;

      const create = makeEvent({
        taskId: "t1",
        type: "task_created",
        timestamp: ts,
        actorId: "actor-aaa",
        task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
      });

      const updateA = makeEvent({
        taskId: "t1",
        type: "task_status_changed",
        timestamp: ts + 100,
        actorId: "actor-aaa",
        task: { status: "in_progress" },
      });

      const updateB = makeEvent({
        taskId: "t1",
        type: "task_status_changed",
        timestamp: ts + 200,
        actorId: "actor-bbb",
        task: { status: "completed" },
      });

      // Order 1: create → updateA → updateB
      store.applyEvent(create);
      store.applyEvent(updateA);
      store.applyEvent(updateB);
      const result1 = store.getTask("t1")!.status;

      store.clear();

      // Order 2: create → updateB → updateA (out of order delivery)
      store.applyEvent(create);
      store.applyEvent(updateB);
      store.applyEvent(updateA); // stale, should be rejected

      const result2 = store.getTask("t1")!.status;

      expect(result1).toBe(result2);
      expect(result1).toBe("completed");
    });
  });

  // ─── Sync Safety ─────────────────────────────────────────────────────────────

  describe("Sync Safety", () => {
    it("replaying already-seen events is safe (no effect)", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-aaa",
          task: { status: "in_progress" },
        }),
      );

      // Replay both events again (simulates receiving sync burst of events already applied)
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-aaa",
          task: { status: "in_progress" },
        }),
      );

      // State is unchanged and no crash
      expect(store.getTask("t1")!.status).toBe("in_progress");
      expect(store.getTaskCount()).toBe(1);
    });

    it("applying sync events after local events preserves local (higher-timestamp) state", () => {
      const ts = 1700000000000;

      // Local user creates a task and updates it
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-local" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 500,
          actorId: "actor-local",
          task: { status: "completed" },
        }),
      );

      // A sync burst arrives with an older remote update (lost race)
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: ts + 200, // older than local ts+500
          actorId: "actor-remote",
          task: { status: "in_progress" },
        }),
      );

      // Local state wins because it has the higher timestamp
      expect(store.getTask("t1")!.status).toBe("completed");
    });

    it("getSnapshot() after sync contains merged state", () => {
      const ts = 1700000000000;

      // Apply events from two different actors creating different tasks
      store.applyEvent(
        makeEvent({
          taskId: "t-alice",
          type: "task_created",
          timestamp: ts,
          actorId: "actor-alice",
          task: { title: "Alice task", status: "pending", createdBy: "actor-alice" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t-bob",
          type: "task_created",
          timestamp: ts + 10,
          actorId: "actor-bob",
          task: { title: "Bob task", status: "pending", createdBy: "actor-bob" },
        }),
      );

      // Simulate a sync update from Bob that modifies Alice's task
      store.applyEvent(
        makeEvent({
          taskId: "t-alice",
          type: "task_status_changed",
          timestamp: ts + 100,
          actorId: "actor-bob",
          task: { status: "in_progress" },
        }),
      );

      const snapshot = store.getSnapshot();

      expect(snapshot.length).toBe(2);

      const aliceTask = snapshot.find((t) => t.id === "t-alice");
      const bobTask = snapshot.find((t) => t.id === "t-bob");

      expect(aliceTask).toBeDefined();
      expect(aliceTask!.status).toBe("in_progress"); // sync update applied
      expect(bobTask).toBeDefined();
      expect(bobTask!.title).toBe("Bob task");
    });

    it("getSnapshot() returns plain objects (not store references)", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Snapshot task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const [snap] = store.getSnapshot();
      // Mutate the snapshot object
      snap.title = "mutated";

      // Store is unaffected
      expect(store.getTask("t1")!.title).toBe("Snapshot task");
    });
  });
});
