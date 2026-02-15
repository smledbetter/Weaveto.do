import { describe, it, expect, beforeEach } from "vitest";
import { createTaskStore } from "$lib/tasks/store.svelte";
import type { TaskEvent } from "$lib/tasks/types";

function makeCreateEvent(
  taskId: string,
  overrides: Partial<TaskEvent["task"]> = {},
  actorId = "actor-aaa",
  timestamp = Date.now(),
): TaskEvent {
  return {
    type: "task_created",
    taskId,
    task: {
      title: `Task ${taskId}`,
      status: "pending",
      createdBy: actorId,
      ...overrides,
    },
    timestamp,
    actorId,
  };
}

describe("Task Dependencies", () => {
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    store = createTaskStore();
  });

  describe("blockedBy field on create", () => {
    it("creates task with blockedBy dependencies", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      const task = store.getTask("t2");
      expect(task?.blockedBy).toEqual(["t1"]);
    });

    it("creates task without blockedBy", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      expect(store.getTask("t1")?.blockedBy).toBeUndefined();
    });
  });

  describe("task_dependencies_changed event", () => {
    it("updates task dependencies", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(makeCreateEvent("t2", {}, "a", 101));

      store.applyEvent({
        type: "task_dependencies_changed",
        taskId: "t2",
        task: { blockedBy: ["t1"] },
        timestamp: 102,
        actorId: "a",
      });

      expect(store.getTask("t2")?.blockedBy).toEqual(["t1"]);
    });

    it("clears dependencies when set to empty array", () => {
      store.applyEvent(
        makeCreateEvent("t1", {}, "a", 100),
      );
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      store.applyEvent({
        type: "task_dependencies_changed",
        taskId: "t2",
        task: { blockedBy: [] },
        timestamp: 102,
        actorId: "a",
      });

      expect(store.getTask("t2")?.blockedBy).toEqual([]);
    });
  });

  describe("DAG validation", () => {
    it("prevents self-dependency", () => {
      store.applyEvent(
        makeCreateEvent("t1", { blockedBy: ["t1"] }, "a", 100),
      );

      const task = store.getTask("t1");
      expect(task?.blockedBy).toEqual([]);
    });

    it("prevents simple cycle (A → B → A)", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      // Try to make t1 blocked by t2 (cycle)
      store.applyEvent({
        type: "task_dependencies_changed",
        taskId: "t1",
        task: { blockedBy: ["t2"] },
        timestamp: 102,
        actorId: "a",
      });

      expect(store.getTask("t1")?.blockedBy).toEqual([]);
    });

    it("prevents complex cycle (A → B → C → A)", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );
      store.applyEvent(
        makeCreateEvent("t3", { blockedBy: ["t2"] }, "a", 102),
      );

      // Try to close the loop: t1 blocked by t3
      store.applyEvent({
        type: "task_dependencies_changed",
        taskId: "t1",
        task: { blockedBy: ["t3"] },
        timestamp: 103,
        actorId: "a",
      });

      expect(store.getTask("t1")?.blockedBy).toEqual([]);
    });

    it("filters out non-existent task dependencies", () => {
      store.applyEvent(
        makeCreateEvent("t1", { blockedBy: ["ghost"] }, "a", 100),
      );

      expect(store.getTask("t1")?.blockedBy).toEqual([]);
    });

    it("keeps valid deps and filters invalid ones in the same array", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1", "ghost", "t2"] }, "a", 101),
      );

      // t1 is valid, ghost doesn't exist, t2 is self-ref
      expect(store.getTask("t2")?.blockedBy).toEqual(["t1"]);
    });
  });

  describe("isBlocked", () => {
    it("returns false when task has no dependencies", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      expect(store.isBlocked("t1")).toBe(false);
    });

    it("returns false for non-existent task", () => {
      expect(store.isBlocked("nope")).toBe(false);
    });

    it("returns true when task has incomplete dependency", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      expect(store.isBlocked("t2")).toBe(true);
    });

    it("returns false when all dependencies are completed", () => {
      store.applyEvent(
        makeCreateEvent("t1", { status: "completed" }, "a", 100),
      );
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      expect(store.isBlocked("t2")).toBe(false);
    });

    it("returns true when at least one dependency is incomplete", () => {
      store.applyEvent(
        makeCreateEvent("t1", { status: "completed" }, "a", 100),
      );
      store.applyEvent(makeCreateEvent("t2", {}, "a", 101));
      store.applyEvent(
        makeCreateEvent("t3", { blockedBy: ["t1", "t2"] }, "a", 102),
      );

      expect(store.isBlocked("t3")).toBe(true);
    });
  });

  describe("getBlockingTasks", () => {
    it("returns empty array when no dependencies", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      expect(store.getBlockingTasks("t1")).toEqual([]);
    });

    it("returns incomplete blocking tasks", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      const blocking = store.getBlockingTasks("t2");
      expect(blocking).toHaveLength(1);
      expect(blocking[0].id).toBe("t1");
    });

    it("excludes completed blocking tasks", () => {
      store.applyEvent(
        makeCreateEvent("t1", { status: "completed" }, "a", 100),
      );
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      expect(store.getBlockingTasks("t2")).toEqual([]);
    });
  });

  describe("getTaskProgress", () => {
    it("returns null for tasks without subtasks", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      expect(store.getTaskProgress("t1")).toBeNull();
    });

    it("returns 0 when no subtasks are completed", () => {
      store.applyEvent(makeCreateEvent("parent", {}, "a", 100));
      store.applyEvent({
        type: "subtask_created",
        taskId: "c1",
        task: { title: "Child 1", status: "pending", parentId: "parent", createdBy: "a" },
        timestamp: 101,
        actorId: "a",
      });
      store.applyEvent({
        type: "subtask_created",
        taskId: "c2",
        task: { title: "Child 2", status: "pending", parentId: "parent", createdBy: "a" },
        timestamp: 102,
        actorId: "a",
      });

      expect(store.getTaskProgress("parent")).toBe(0);
    });

    it("returns 50 when half of subtasks are completed", () => {
      store.applyEvent(makeCreateEvent("parent", {}, "a", 100));
      store.applyEvent({
        type: "subtask_created",
        taskId: "c1",
        task: { title: "Child 1", status: "completed", parentId: "parent", createdBy: "a" },
        timestamp: 101,
        actorId: "a",
      });
      store.applyEvent({
        type: "subtask_created",
        taskId: "c2",
        task: { title: "Child 2", status: "pending", parentId: "parent", createdBy: "a" },
        timestamp: 102,
        actorId: "a",
      });

      expect(store.getTaskProgress("parent")).toBe(50);
    });

    it("returns 100 when all subtasks are completed", () => {
      store.applyEvent(makeCreateEvent("parent", {}, "a", 100));
      store.applyEvent({
        type: "subtask_created",
        taskId: "c1",
        task: { title: "Child 1", status: "completed", parentId: "parent", createdBy: "a" },
        timestamp: 101,
        actorId: "a",
      });
      store.applyEvent({
        type: "subtask_created",
        taskId: "c2",
        task: { title: "Child 2", status: "completed", parentId: "parent", createdBy: "a" },
        timestamp: 102,
        actorId: "a",
      });

      expect(store.getTaskProgress("parent")).toBe(100);
    });
  });

  describe("getRoomProgress", () => {
    it("returns zero stats for empty room", () => {
      expect(store.getRoomProgress()).toEqual({
        total: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
        blocked: 0,
      });
    });

    it("calculates correct room statistics", () => {
      store.applyEvent(
        makeCreateEvent("t1", { status: "completed" }, "a", 100),
      );
      store.applyEvent(
        makeCreateEvent("t2", { status: "in_progress" }, "a", 101),
      );
      store.applyEvent(makeCreateEvent("t3", {}, "a", 102));

      const progress = store.getRoomProgress();
      expect(progress.total).toBe(3);
      expect(progress.completed).toBe(1);
      expect(progress.inProgress).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.blocked).toBe(0);
    });

    it("counts blocked tasks", () => {
      store.applyEvent(makeCreateEvent("t1", {}, "a", 100));
      store.applyEvent(
        makeCreateEvent("t2", { blockedBy: ["t1"] }, "a", 101),
      );

      const progress = store.getRoomProgress();
      expect(progress.blocked).toBe(1);
    });
  });
});
