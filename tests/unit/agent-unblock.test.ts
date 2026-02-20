/**
 * Unit tests for the Unblock agent infrastructure:
 * - buildDependencyData binary format
 * - host_emit_urgency host helper
 * - task_urgency_changed store handling
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildDependencyData,
  buildHostImports,
  type HostContext,
} from "../../src/lib/agents/runtime";
import { DEP_TASK_ID_SIZE, DEP_TASK_RECORD_SIZE } from "../../src/lib/agents/types";
import type { Task, TaskEvent } from "../../src/lib/tasks/types";
import type { AgentPermission } from "../../src/lib/agents/types";

// --- Helpers ---

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: `Task ${overrides.id}`,
    status: "pending",
    createdBy: "user1",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<HostContext>): HostContext {
  return {
    tasks: [],
    members: new Map(),
    roomId: "test-room",
    moduleId: "test-agent",
    stateKey: null,
    onEmitEvent: vi.fn(),
    stateCache: null,
    stateDirty: false,
    pendingEvent: null,
    ...overrides,
  };
}

function makeMemory(pages: number = 1): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: pages, maximum: 10 });
}

function writeString(
  memory: WebAssembly.Memory,
  ptr: number,
  str: string,
): number {
  const bytes = new TextEncoder().encode(str);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  return bytes.length;
}

// --- buildDependencyData tests ---

describe("buildDependencyData", () => {
  it("returns 4-byte header for empty task list", () => {
    const data = buildDependencyData([]);
    expect(data.byteLength).toBe(4);
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(0);
  });

  it("encodes correct taskCount", () => {
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
    const data = buildDependencyData(tasks);
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(2);
    expect(data.byteLength).toBe(4 + 2 * DEP_TASK_RECORD_SIZE);
  });

  it("encodes status correctly", () => {
    const tasks = [
      makeTask({ id: "t1", status: "pending" }),
      makeTask({ id: "t2", status: "in_progress" }),
      makeTask({ id: "t3", status: "completed" }),
    ];
    const data = buildDependencyData(tasks);

    // status byte is at offset 4 + (i * 39) + 36
    expect(data[4 + 0 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE]).toBe(0); // pending
    expect(data[4 + 1 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE]).toBe(1); // in_progress
    expect(data[4 + 2 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE]).toBe(2); // completed
  });

  it("encodes isUrgent correctly", () => {
    const tasks = [
      makeTask({ id: "t1", urgent: true }),
      makeTask({ id: "t2", urgent: false }),
      makeTask({ id: "t3" }), // undefined = not urgent
    ];
    const data = buildDependencyData(tasks);

    // isUrgent byte is at offset 4 + (i * 39) + 37
    expect(data[4 + 0 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 1]).toBe(1);
    expect(data[4 + 1 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 1]).toBe(0);
    expect(data[4 + 2 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 1]).toBe(0);
  });

  it("computes dependentCount correctly", () => {
    // t1 is depended on by t2 and t3 (both pending) → dependentCount = 2
    // t2 is depended on by t3 → dependentCount = 1
    const tasks = [
      makeTask({ id: "t1" }),
      makeTask({ id: "t2", blockedBy: ["t1"] }),
      makeTask({ id: "t3", blockedBy: ["t1", "t2"] }),
    ];
    const data = buildDependencyData(tasks);

    // dependentCount byte is at offset 4 + (i * 39) + 38
    expect(data[4 + 0 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 2]).toBe(2); // t1
    expect(data[4 + 1 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 2]).toBe(1); // t2
    expect(data[4 + 2 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 2]).toBe(0); // t3
  });

  it("only counts non-completed dependents", () => {
    // t1 is depended on by t2 (completed) and t3 (pending)
    // Only t3 counts → dependentCount = 1
    const tasks = [
      makeTask({ id: "t1" }),
      makeTask({ id: "t2", status: "completed", blockedBy: ["t1"] }),
      makeTask({ id: "t3", blockedBy: ["t1"] }),
    ];
    const data = buildDependencyData(tasks);

    expect(data[4 + 0 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 2]).toBe(1);
  });

  it("zero-pads taskId to DEP_TASK_ID_SIZE bytes", () => {
    const tasks = [makeTask({ id: "abc" })];
    const data = buildDependencyData(tasks);

    // First 3 bytes should be "abc", rest should be 0
    const idBytes = data.slice(4, 4 + DEP_TASK_ID_SIZE);
    const decoder = new TextDecoder();
    expect(decoder.decode(idBytes.slice(0, 3))).toBe("abc");
    for (let i = 3; i < DEP_TASK_ID_SIZE; i++) {
      expect(idBytes[i]).toBe(0);
    }
  });

  it("caps dependentCount at 255", () => {
    // Create a task depended on by 256 other tasks
    const blocker = makeTask({ id: "blocker" });
    const dependents = Array.from({ length: 256 }, (_, i) =>
      makeTask({ id: `dep-${i}`, blockedBy: ["blocker"] }),
    );
    const tasks = [blocker, ...dependents];
    const data = buildDependencyData(tasks);

    // blocker's dependentCount should be capped at 255
    expect(data[4 + 0 * DEP_TASK_RECORD_SIZE + DEP_TASK_ID_SIZE + 2]).toBe(255);
  });
});

// --- host_emit_urgency tests ---

describe("host_emit_urgency", () => {
  const PERMS: AgentPermission[] = ["read_tasks", "emit_events"];

  it("emits task_urgency_changed event", () => {
    const task = makeTask({ id: "t1" });
    const context = makeContext({ tasks: [task] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, PERMS, context);

    const len = writeString(memory, 0, "t1");
    (imports.host_emit_urgency as Function)(0, len);

    expect(context.onEmitEvent).toHaveBeenCalledOnce();
    const event = (context.onEmitEvent as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TaskEvent;
    expect(event.type).toBe("task_urgency_changed");
    expect(event.taskId).toBe("t1");
    expect(event.task?.urgent).toBe(true);
    expect(event.actorId).toBe("agent:test-agent");
  });

  it("skips task already marked urgent", () => {
    const task = makeTask({ id: "t1", urgent: true });
    const context = makeContext({ tasks: [task] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, PERMS, context);

    const len = writeString(memory, 0, "t1");
    (imports.host_emit_urgency as Function)(0, len);

    expect(context.onEmitEvent).not.toHaveBeenCalled();
  });

  it("skips unknown taskId", () => {
    const context = makeContext({ tasks: [makeTask({ id: "t1" })] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, PERMS, context);

    const len = writeString(memory, 0, "t-unknown");
    (imports.host_emit_urgency as Function)(0, len);

    expect(context.onEmitEvent).not.toHaveBeenCalled();
  });

  it("skips empty taskId string", () => {
    const context = makeContext({ tasks: [makeTask({ id: "t1" })] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, PERMS, context);

    (imports.host_emit_urgency as Function)(0, 0);

    expect(context.onEmitEvent).not.toHaveBeenCalled();
  });

  it("is no-op without emit_events permission", () => {
    const task = makeTask({ id: "t1" });
    const context = makeContext({ tasks: [task] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["read_tasks"], context);

    const len = writeString(memory, 0, "t1");
    (imports.host_emit_urgency as Function)(0, len);

    expect(context.onEmitEvent).not.toHaveBeenCalled();
  });

  it("is no-op without read_tasks permission", () => {
    const task = makeTask({ id: "t1" });
    const context = makeContext({ tasks: [task] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["emit_events"], context);

    const len = writeString(memory, 0, "t1");
    (imports.host_emit_urgency as Function)(0, len);

    expect(context.onEmitEvent).not.toHaveBeenCalled();
  });
});

// --- host_get_dependency_data tests ---

describe("host_get_dependency_data", () => {
  it("writes binary data to memory", () => {
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2", blockedBy: ["t1"] })];
    const context = makeContext({ tasks });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["read_tasks"], context);

    const bytesWritten = (imports.host_get_dependency_data as Function)(0, 65536);
    expect(bytesWritten).toBe(4 + 2 * DEP_TASK_RECORD_SIZE);

    const view = new DataView(memory.buffer);
    expect(view.getUint32(0, true)).toBe(2);
  });

  it("returns 0 without read_tasks permission", () => {
    const context = makeContext({ tasks: [makeTask({ id: "t1" })] });
    const memory = makeMemory();
    const imports = buildHostImports(memory, [], context);

    const bytesWritten = (imports.host_get_dependency_data as Function)(0, 65536);
    expect(bytesWritten).toBe(0);
  });

  it("returns 0 if buffer too small", () => {
    const tasks = [makeTask({ id: "t1" })];
    const context = makeContext({ tasks });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["read_tasks"], context);

    // Need 4 + 39 = 43 bytes, offer only 10
    const bytesWritten = (imports.host_get_dependency_data as Function)(0, 10);
    expect(bytesWritten).toBe(0);
  });
});
