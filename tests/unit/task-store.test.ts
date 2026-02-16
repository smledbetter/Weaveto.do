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

describe("TaskStore", () => {
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    store = createTaskStore();
  });

  describe("task_created", () => {
    it("creates a task in the store", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: {
            title: "Buy groceries",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      const task = store.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.title).toBe("Buy groceries");
      expect(task!.status).toBe("pending");
      expect(task!.id).toBe("t1");
    });

    it("creates task with minimal fields (defaults applied)", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t-min",
          type: "task_created",
          timestamp: 100,
          task: {},
        }),
      );

      const task = store.getTask("t-min");
      expect(task).toBeDefined();
      expect(task!.title).toBe("");
      expect(task!.status).toBe("pending");
      expect(task!.createdBy).toBe("actor-aaa");
      expect(task!.createdAt).toBe(100);
    });

    it("ignores create event with no task payload", () => {
      store.applyEvent(makeEvent({ taskId: "t-none", type: "task_created" }));
      expect(store.getTask("t-none")).toBeUndefined();
    });

    it("preserves optional fields (assignee, parentId, dueAt)", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t-full",
          type: "task_created",
          task: {
            title: "Full",
            status: "pending",
            createdBy: "actor-aaa",
            assignee: "member-bbb",
            parentId: "parent-1",
            dueAt: 9999999,
          },
        }),
      );

      const task = store.getTask("t-full");
      expect(task!.assignee).toBe("member-bbb");
      expect(task!.parentId).toBe("parent-1");
      expect(task!.dueAt).toBe(9999999);
    });

    it("sets createdAt and updatedAt from event timestamp", () => {
      const ts = 1700000000000;
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Test", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      const task = store.getTask("t1");
      expect(task!.createdAt).toBe(ts);
      expect(task!.updatedAt).toBe(ts);
    });
  });

  describe("subtask_created", () => {
    it("creates a child task linked to parent", () => {
      store.applyEvent(
        makeEvent({
          taskId: "parent",
          type: "task_created",
          task: { title: "Parent", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "child1",
          type: "subtask_created",
          task: {
            title: "Child 1",
            status: "pending",
            parentId: "parent",
            createdBy: "actor-aaa",
          },
        }),
      );

      const child = store.getTask("child1");
      expect(child).toBeDefined();
      expect(child!.parentId).toBe("parent");
      expect(child!.title).toBe("Child 1");
    });
  });

  describe("task_assigned", () => {
    it("sets assignee and transitions status to in_progress", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_assigned",
          timestamp: Date.now() + 1,
          task: { assignee: "member-bbb" },
        }),
      );

      const task = store.getTask("t1");
      expect(task!.assignee).toBe("member-bbb");
      expect(task!.status).toBe("in_progress");
    });
  });

  describe("task_status_changed", () => {
    it("transitions status correctly", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_status_changed",
          timestamp: Date.now() + 1,
          task: { status: "completed" },
        }),
      );

      expect(store.getTask("t1")!.status).toBe("completed");
    });
  });

  describe("update edge cases", () => {
    it("ignores update on non-existent task", () => {
      store.applyEvent(
        makeEvent({
          taskId: "ghost",
          type: "task_assigned",
          task: { assignee: "member-bbb" },
        }),
      );
      expect(store.getTask("ghost")).toBeUndefined();
    });

    it("ignores update event with no task payload", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: { title: "Task", status: "pending", createdBy: "a" },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_assigned",
          timestamp: Date.now() + 1,
        }),
      );
      expect(store.getTask("t1")!.assignee).toBeUndefined();
    });
  });

  describe("conflict resolution", () => {
    it("rejects events with older timestamp than task updatedAt", () => {
      const ts = 1700000000000;
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      // Update at ts+100
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_assigned",
          timestamp: ts + 100,
          task: { assignee: "member-bbb" },
        }),
      );

      // Try to assign with older timestamp — should be rejected
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_assigned",
          timestamp: ts + 50,
          task: { assignee: "member-ccc" },
        }),
      );

      expect(store.getTask("t1")!.assignee).toBe("member-bbb");
    });

    it("breaks ties by actorId lexicographic order", () => {
      const ts = 1700000000000;
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      // Two events with same timestamp, different actors
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_assigned",
          timestamp: ts + 100,
          actorId: "actor-bbb",
          task: { assignee: "member-bbb" },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_assigned",
          timestamp: ts + 100,
          actorId: "actor-zzz",
          task: { assignee: "member-zzz" },
        }),
      );

      // actor-zzz > actor-bbb lexicographically, so it wins
      expect(store.getTask("t1")!.assignee).toBe("member-zzz");
    });
  });

  describe("duplicate detection", () => {
    it("skips events with same taskId + type + timestamp", () => {
      const ts = 1700000000000;
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: {
            title: "Original",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      // Duplicate event — same taskId, type, timestamp but different title
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: {
            title: "Duplicate",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      expect(store.getTask("t1")!.title).toBe("Original");
    });
  });

  describe("clear", () => {
    it("empties all tasks", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: { title: "Task", status: "pending", createdBy: "actor-aaa" },
        }),
      );

      expect(store.getTasks().length).toBe(1);
      store.clear();
      expect(store.getTasks().length).toBe(0);
    });
  });

  describe("derived values", () => {
    it("pendingTasks filters correctly", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: 100,
          task: { title: "Pending", status: "pending", createdBy: "a" },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "t2",
          type: "task_created",
          timestamp: 101,
          task: { title: "Done", status: "pending", createdBy: "a" },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "t2",
          type: "task_status_changed",
          timestamp: 102,
          task: { status: "completed" },
        }),
      );

      const pending = store.getPendingTasks();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe("t1");
    });

    it("tasksByParent groups correctly", () => {
      store.applyEvent(
        makeEvent({
          taskId: "parent",
          type: "task_created",
          timestamp: 100,
          task: { title: "Parent", status: "pending", createdBy: "a" },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "c1",
          type: "subtask_created",
          timestamp: 101,
          task: {
            title: "Child 1",
            status: "pending",
            parentId: "parent",
            createdBy: "a",
          },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "c2",
          type: "subtask_created",
          timestamp: 102,
          task: {
            title: "Child 2",
            status: "pending",
            parentId: "parent",
            createdBy: "a",
          },
        }),
      );

      const children = store.getTasksByParent("parent");
      expect(children.length).toBe(2);
    });

    it("taskCount returns correct count", () => {
      expect(store.getTaskCount()).toBe(0);

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: { title: "A", status: "pending", createdBy: "a" },
        }),
      );
      store.applyEvent(
        makeEvent({
          taskId: "t2",
          type: "task_created",
          timestamp: Date.now() + 1,
          task: { title: "B", status: "pending", createdBy: "a" },
        }),
      );

      expect(store.getTaskCount()).toBe(2);
    });
  });

  describe("description and urgent fields", () => {
    it("creates task with description", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: {
            title: "Task with description",
            status: "pending",
            createdBy: "actor-aaa",
            description: "This is a detailed description",
          },
        }),
      );

      const task = store.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.description).toBe("This is a detailed description");
    });

    it("creates task with urgent flag", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: {
            title: "Urgent task",
            status: "pending",
            createdBy: "actor-aaa",
            urgent: true,
          },
        }),
      );

      const task = store.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.urgent).toBe(true);
    });

    it("creates task without optional fields", () => {
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          task: {
            title: "Basic task",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      const task = store.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.description).toBeUndefined();
      expect(task!.urgent).toBeUndefined();
    });

    it("updates task via task_updated event", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: {
            title: "Original task",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_updated",
          timestamp: ts + 100,
          task: {
            description: "new desc",
          },
        }),
      );

      const task = store.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.description).toBe("new desc");
      expect(task!.updatedAt).toBe(ts + 100);
    });

    it("task_updated respects conflict resolution", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: {
            title: "Task",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      // Two updates with same timestamp, different actors
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_updated",
          timestamp: ts + 100,
          actorId: "actor-bbb",
          task: {
            description: "Description from bbb",
          },
        }),
      );

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_updated",
          timestamp: ts + 100,
          actorId: "actor-zzz",
          task: {
            description: "Description from zzz",
          },
        }),
      );

      // actor-zzz > actor-bbb lexicographically, so it wins
      const task = store.getTask("t1");
      expect(task!.description).toBe("Description from zzz");
    });

    it("task_updated rejects stale events", () => {
      const ts = 1700000000000;

      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_created",
          timestamp: ts,
          task: {
            title: "Task",
            status: "pending",
            createdBy: "actor-aaa",
          },
        }),
      );

      // Update at ts+100
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_updated",
          timestamp: ts + 100,
          task: {
            description: "Latest description",
          },
        }),
      );

      // Try to update with older timestamp — should be rejected
      store.applyEvent(
        makeEvent({
          taskId: "t1",
          type: "task_updated",
          timestamp: ts + 50,
          task: {
            description: "Stale description",
          },
        }),
      );

      const task = store.getTask("t1");
      expect(task!.description).toBe("Latest description");
      expect(task!.updatedAt).toBe(ts + 100);
    });
  });
});
