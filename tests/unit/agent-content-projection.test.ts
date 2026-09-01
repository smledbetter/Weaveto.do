// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  projectTaskForAgent,
  buildHostImports,
  buildAssignmentData,
} from "../../src/lib/agents/runtime";
import type { Task } from "../../src/lib/tasks/types";
import type { RoomMember } from "../../src/lib/room/session";

/**
 * An agent must not be handed what a person wrote.
 *
 * `host_get_tasks` used to write `context.tasks` verbatim into agent memory,
 * titles and descriptions included, and `host_get_members` wrote display
 * names. So `read_tasks` meant "read everything anyone ever typed in this
 * room", which is not what someone granting it would expect, and it is about
 * to be grantable to WASM modules the user uploads.
 *
 * The sandbox has no syscalls and no network, so this was never an
 * exfiltration hole. It is least privilege, and it is what makes the claim
 * about agents true rather than nearly true.
 */

const CONTENT = "Collect prescription for Margaret from the pharmacy";
const NOTE = "she prefers the Boots on the high street";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: CONTENT,
    description: NOTE,
    status: "pending",
    createdBy: "alice",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as Task;
}

function member(identityKey: string, displayName: string): RoomMember {
  return { identityKey, displayName };
}

/** Read back whatever a host function wrote into agent memory. */
function readAgentMemory(
  fn: Function,
  memory: WebAssembly.Memory,
): string {
  const len = fn(0, 65536) as number;
  return new TextDecoder().decode(new Uint8Array(memory.buffer, 0, len));
}

function hostFor(tasks: Task[], members: Map<string, RoomMember>) {
  const memory = new WebAssembly.Memory({ initial: 2 });
  const imports = buildHostImports(
    memory,
    ["read_tasks", "read_members"],
    { tasks, members } as never,
  );
  return { memory, imports };
}

describe("the projection keeps free text out", () => {
  it("drops the title", () => {
    expect(JSON.stringify(projectTaskForAgent(task()))).not.toContain(CONTENT);
  });

  it("drops the description", () => {
    expect(JSON.stringify(projectTaskForAgent(task()))).not.toContain(NOTE);
  });

  it("keeps everything an agent schedules on", () => {
    const t = task({
      assignee: "bob",
      dueAt: 5000,
      blockedBy: ["t0"],
      urgent: true,
    });
    const p = projectTaskForAgent(t);
    expect(p).toMatchObject({
      id: "t1",
      status: "pending",
      assignee: "bob",
      createdBy: "alice",
      dueAt: 5000,
      blockedBy: ["t0"],
      urgent: true,
    });
  });

  it("is an allow-list, so a new text field is excluded by default", () => {
    // A deny-list would silently start leaking the next field someone adds to
    // Task. This asserts the shape rather than the absence of two names.
    const withFuture = { ...task(), secretNote: "added later" } as unknown as Task;
    const projected = projectTaskForAgent(withFuture);
    expect(Object.keys(projected).sort()).toEqual([
      "assignee",
      "blockedBy",
      "createdAt",
      "createdBy",
      "dueAt",
      "id",
      "parentId",
      "status",
      "updatedAt",
      "urgent",
    ]);
  });
});

describe("what actually reaches agent memory", () => {
  const members = new Map([["alice", member("alice", "Margaret Thatcher")]]);

  it("host_get_tasks writes no task text", () => {
    const { memory, imports } = hostFor([task()], members);
    const written = readAgentMemory(imports.host_get_tasks, memory);
    expect(written).not.toContain(CONTENT);
    expect(written).not.toContain(NOTE);
    expect(written).toContain("t1");
  });

  it("host_get_members writes no display name", () => {
    const { memory, imports } = hostFor([task()], members);
    const written = readAgentMemory(imports.host_get_members, memory);
    expect(written).not.toContain("Margaret Thatcher");
    expect(written).toContain("alice");
  });

  it("writes nothing at all without the permission", () => {
    const memory = new WebAssembly.Memory({ initial: 2 });
    const imports = buildHostImports(memory, [], {
      tasks: [task()],
      members,
    } as never);
    expect(imports.host_get_tasks(0, 65536)).toBe(0);
    expect(imports.host_get_members(0, 65536)).toBe(0);
  });
});

describe("the built-in agent still has what it needs", () => {
  it("assignment data carries no text and still identifies the work", () => {
    // auto-balance runs on this, not on the task JSON. It has always been a
    // projection, which is why the projection above breaks nothing.
    const tasks = [
      task({ id: "t1", status: "pending" }),
      task({ id: "t2", status: "pending", assignee: "bob" }),
    ];
    const members = new Map([
      ["alice", member("alice", "Margaret Thatcher")],
      ["bob", member("bob", "Winston Churchill")],
    ]);
    const data = buildAssignmentData(tasks, members);
    const text = new TextDecoder().decode(data);

    expect(text).not.toContain(CONTENT);
    expect(text).not.toContain("Margaret Thatcher");
    expect(text).toContain("t1");
    expect(data.byteLength).toBeGreaterThan(8);
  });
});
