import { describe, it, expect, vi } from "vitest";
import { autoAssign } from "$lib/tasks/agent";
import type { Task } from "$lib/tasks/types";
import type { RoomMember } from "$lib/room/session";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "Test task",
    status: "pending",
    createdBy: "creator",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMembers(
  ...names: [string, string][]
): Map<string, RoomMember> {
  const map = new Map<string, RoomMember>();
  for (const [key, name] of names) {
    map.set(key, { identityKey: key, displayName: name });
  }
  return map;
}

describe("autoAssign", () => {
  const myKey = "my-key";

  it("distributes 3 tasks across 2 members with variance ≤1", () => {
    const tasks = [makeTask(), makeTask(), makeTask()];
    const members = makeMembers(["member-a", "Alice"]);
    const events = autoAssign(tasks, members, myKey, new Map());

    expect(events).toHaveLength(3);

    const counts = new Map<string, number>();
    for (const e of events) {
      const a = e.task?.assignee ?? "";
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }

    const values = Array.from(counts.values());
    const max = Math.max(...values);
    const min = Math.min(...values);
    expect(max - min).toBeLessThanOrEqual(1);
  });

  it("distributes 6 tasks across 3 members — exactly 2 each", () => {
    const tasks = Array.from({ length: 6 }, () => makeTask());
    const members = makeMembers(
      ["member-a", "Alice"],
      ["member-b", "Bob"],
    );
    const events = autoAssign(tasks, members, myKey, new Map());

    expect(events).toHaveLength(6);

    const counts = new Map<string, number>();
    for (const e of events) {
      const a = e.task?.assignee ?? "";
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }

    for (const count of counts.values()) {
      expect(count).toBe(2);
    }
  });

  it("returns empty array when all tasks are assigned", () => {
    const tasks = [
      makeTask({ assignee: "member-a" }),
      makeTask({ assignee: myKey }),
    ];
    const members = makeMembers(["member-a", "Alice"]);
    const events = autoAssign(tasks, members, myKey, new Map());
    expect(events).toHaveLength(0);
  });

  it("assigns all tasks to single member when alone", () => {
    const tasks = [makeTask(), makeTask()];
    const members = new Map<string, RoomMember>();
    const events = autoAssign(tasks, members, myKey, new Map());

    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.task?.assignee).toBe(myKey);
    }
  });

  it("fills lowest-load member first when loads are unequal", () => {
    // member-a already has 2 tasks, myKey has 0
    const existingTasks = [
      makeTask({ assignee: "member-a", status: "in_progress" }),
      makeTask({ assignee: "member-a", status: "in_progress" }),
    ];
    const newTask = makeTask();
    const tasks = [...existingTasks, newTask];
    const members = makeMembers(["member-a", "Alice"]);

    const events = autoAssign(tasks, members, myKey, new Map());

    expect(events).toHaveLength(1);
    expect(events[0].task?.assignee).toBe(myKey);
  });

  it("gives priority to recently active members in tie-break", () => {
    const tasks = [makeTask()];
    const members = makeMembers(["member-a", "Alice"]);

    const now = Date.now();
    // member-a was active 1 minute ago (within 10 min window)
    const lastMessageTimes = new Map([["member-a", now - 60_000]]);
    // myKey has no recent activity

    const events = autoAssign(tasks, members, myKey, lastMessageTimes);

    expect(events).toHaveLength(1);
    expect(events[0].task?.assignee).toBe("member-a");
  });

  it("returns empty array when no pending unassigned tasks exist", () => {
    const tasks = [
      makeTask({ status: "completed" }),
      makeTask({ status: "in_progress", assignee: "member-a" }),
    ];
    const members = makeMembers(["member-a", "Alice"]);
    const events = autoAssign(tasks, members, myKey, new Map());
    expect(events).toHaveLength(0);
  });

  it("returns empty array with empty members map (self only)", () => {
    // Even with no other members, self is included
    const tasks = [makeTask()];
    const events = autoAssign(tasks, new Map(), myKey, new Map());

    expect(events).toHaveLength(1);
    expect(events[0].task?.assignee).toBe(myKey);
  });

  it("ignores recency outside the 10-minute window", () => {
    const tasks = [makeTask()];
    const members = makeMembers(["member-a", "Alice"]);

    const now = Date.now();
    // member-a was active 20 minutes ago (outside window)
    const lastMessageTimes = new Map([["member-a", now - 1_200_000]]);

    const events = autoAssign(tasks, members, myKey, lastMessageTimes);

    expect(events).toHaveLength(1);
    // Both have zero recency weight, should pick first in allMembers (myKey)
    expect(events[0].task?.assignee).toBe(myKey);
  });

  it("generates valid task_assigned events", () => {
    const task = makeTask();
    const events = autoAssign([task], new Map(), myKey, new Map());

    expect(events[0].type).toBe("task_assigned");
    expect(events[0].taskId).toBe(task.id);
    expect(events[0].actorId).toBe(myKey);
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it("skips tasks that are not pending", () => {
    const tasks = [
      makeTask({ status: "in_progress" }),
      makeTask({ status: "pending" }),
    ];
    const events = autoAssign(tasks, new Map(), myKey, new Map());

    // Only the pending one without assignee should be assigned
    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe(tasks[1].id);
  });
});
