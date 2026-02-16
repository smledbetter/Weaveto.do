/**
 * Unit tests for agent event validation (taskId checking).
 */

import { describe, it, expect } from "vitest";
import { validateEmittedEvent } from "../../src/lib/agents/runtime";
import type { TaskEvent, Task } from "../../src/lib/tasks/types";

const MODULE_ID = "room1:test-agent";

function makeTasks(...ids: string[]): Task[] {
  return ids.map((id) => ({
    id,
    title: `Task ${id}`,
    status: "pending" as const,
    createdBy: "user1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}

describe("Agent Event Validation", () => {
  describe("event type validation", () => {
    it("allows known event types", () => {
      const tasks = makeTasks("t1");
      const allowed = [
        "task_created",
        "subtask_created",
        "task_assigned",
        "task_status_changed",
        "task_dependencies_changed",
      ];
      for (const type of allowed) {
        const event = { type, taskId: "t1", task: {} } as TaskEvent;
        expect(() =>
          validateEmittedEvent(event, MODULE_ID, tasks),
        ).not.toThrow();
      }
    });

    it("rejects unknown event types", () => {
      const event = {
        type: "task_deleted",
        taskId: "t1",
        task: {},
      } as unknown as TaskEvent;
      expect(() => validateEmittedEvent(event, MODULE_ID, [])).toThrow(
        "Disallowed event type",
      );
    });

    it("rejects missing event type", () => {
      const event = { taskId: "t1", task: {} } as unknown as TaskEvent;
      expect(() => validateEmittedEvent(event, MODULE_ID, [])).toThrow(
        "Disallowed event type",
      );
    });
  });

  describe("taskId validation", () => {
    it("rejects missing taskId", () => {
      const event = {
        type: "task_assigned",
        task: { assignee: "u1" },
      } as unknown as TaskEvent;
      expect(() => validateEmittedEvent(event, MODULE_ID, [])).toThrow(
        "Event missing taskId",
      );
    });
  });

  describe("taskId existence check", () => {
    it("allows task_assigned for existing task", () => {
      const tasks = makeTasks("t1", "t2", "t3");
      const event: TaskEvent = {
        type: "task_assigned",
        taskId: "t2",
        task: { assignee: "user1" },
        timestamp: 0,
        actorId: "",
      };
      expect(() =>
        validateEmittedEvent(event, MODULE_ID, tasks),
      ).not.toThrow();
    });

    it("rejects task_assigned for unknown taskId", () => {
      const tasks = makeTasks("t1", "t2");
      const event: TaskEvent = {
        type: "task_assigned",
        taskId: "t-unknown",
        task: { assignee: "user1" },
        timestamp: 0,
        actorId: "",
      };
      expect(() => validateEmittedEvent(event, MODULE_ID, tasks)).toThrow(
        "Agent emitted event for unknown taskId: t-unknown",
      );
    });

    it("rejects task_status_changed for unknown taskId", () => {
      const tasks = makeTasks("t1");
      const event: TaskEvent = {
        type: "task_status_changed",
        taskId: "t-deleted",
        task: { status: "completed" },
        timestamp: 0,
        actorId: "",
      };
      expect(() => validateEmittedEvent(event, MODULE_ID, tasks)).toThrow(
        "Agent emitted event for unknown taskId: t-deleted",
      );
    });

    it("rejects task_dependencies_changed for unknown taskId", () => {
      const tasks = makeTasks("t1");
      const event: TaskEvent = {
        type: "task_dependencies_changed",
        taskId: "t-missing",
        task: { blockedBy: ["t1"] },
        timestamp: 0,
        actorId: "",
      };
      expect(() => validateEmittedEvent(event, MODULE_ID, tasks)).toThrow(
        "Agent emitted event for unknown taskId: t-missing",
      );
    });

    it("allows task_created for new taskId (task doesn't exist yet)", () => {
      const tasks = makeTasks("t1");
      const event: TaskEvent = {
        type: "task_created",
        taskId: "t-new",
        task: {
          title: "New task",
          status: "pending",
          createdBy: "agent",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        timestamp: 0,
        actorId: "",
      };
      expect(() =>
        validateEmittedEvent(event, MODULE_ID, tasks),
      ).not.toThrow();
    });

    it("allows subtask_created for new taskId", () => {
      const tasks = makeTasks("t1");
      const event: TaskEvent = {
        type: "subtask_created",
        taskId: "st-new",
        task: { title: "New subtask", parentId: "t1" },
        timestamp: 0,
        actorId: "",
      };
      expect(() =>
        validateEmittedEvent(event, MODULE_ID, tasks),
      ).not.toThrow();
    });

    it("skips existence check when task list is empty (no tasks loaded yet)", () => {
      const event: TaskEvent = {
        type: "task_assigned",
        taskId: "t1",
        task: { assignee: "user1" },
        timestamp: 0,
        actorId: "",
      };
      // Empty array means context not yet populated — don't reject
      expect(() => validateEmittedEvent(event, MODULE_ID, [])).not.toThrow();
    });
  });

  describe("actorId and timestamp forcing", () => {
    it("overwrites actorId with agent prefix", () => {
      const event: TaskEvent = {
        type: "task_created",
        taskId: "t1",
        task: { title: "Test" },
        timestamp: 0,
        actorId: "attacker",
      };
      validateEmittedEvent(event, MODULE_ID, []);
      expect(event.actorId).toBe(`agent:${MODULE_ID}`);
    });

    it("sets timestamp to current time", () => {
      const before = Date.now();
      const event: TaskEvent = {
        type: "task_created",
        taskId: "t1",
        task: { title: "Test" },
        timestamp: 0,
        actorId: "",
      };
      validateEmittedEvent(event, MODULE_ID, []);
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });
});
