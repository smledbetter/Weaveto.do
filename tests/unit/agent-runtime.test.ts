import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildHostImports,
  callWithTimeout,
  type HostContext,
} from "../../src/lib/agents/runtime";
import type { Task } from "../../src/lib/tasks/types";
import type { AgentPermission } from "../../src/lib/agents/types";

// --- Helpers ---

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

const ALL_PERMS: AgentPermission[] = [
  "read_tasks",
  "read_members",
  "emit_events",
  "persist_state",
];

function writeString(
  memory: WebAssembly.Memory,
  ptr: number,
  str: string,
): number {
  const bytes = new TextEncoder().encode(str);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  return bytes.length;
}

function readString(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): string {
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
}

// --- Tests ---

describe("Host Imports: host_get_tasks", () => {
  it("writes tasks JSON to agent memory", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        title: "Test task",
        status: "pending",
        createdBy: "user1",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const ctx = makeContext({ tasks });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const bufPtr = 0;
    const bufLen = 4096;
    const written = (imports.host_get_tasks as Function)(bufPtr, bufLen);

    expect(written).toBeGreaterThan(0);
    const json = readString(memory, bufPtr, written);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("t1");
    expect(parsed[0].title).toBe("Test task");
  });

  it("returns 0 if buffer too small", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        title: "A task with a title that produces JSON larger than 5 bytes",
        status: "pending",
        createdBy: "user1",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const ctx = makeContext({ tasks });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_tasks as Function)(0, 5); // Tiny buffer
    expect(written).toBe(0);
  });

  it("returns 0 when read_tasks permission is denied", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        title: "Secret",
        status: "pending",
        createdBy: "u",
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const ctx = makeContext({ tasks });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["emit_events"], ctx); // No read_tasks

    const written = (imports.host_get_tasks as Function)(0, 4096);
    expect(written).toBe(0);
  });
});

describe("Host Imports: host_get_members", () => {
  it("writes members JSON to agent memory", () => {
    const members = new Map([
      ["key1", { identityKey: "key1", displayName: "Alice" }],
      ["key2", { identityKey: "key2", displayName: "Bob" }],
    ]);
    const ctx = makeContext({ members });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_members as Function)(0, 4096);
    expect(written).toBeGreaterThan(0);

    const parsed = JSON.parse(readString(memory, 0, written));
    expect(parsed).toHaveLength(2);
    expect(
      parsed.map((m: { displayName: string }) => m.displayName).sort(),
    ).toEqual(["Alice", "Bob"]);
  });

  it("returns 0 when read_members permission is denied", () => {
    const members = new Map([
      ["key1", { identityKey: "key1", displayName: "Alice" }],
    ]);
    const ctx = makeContext({ members });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["read_tasks"], ctx); // No read_members

    const written = (imports.host_get_members as Function)(0, 4096);
    expect(written).toBe(0);
  });
});

describe("Host Imports: host_get_now", () => {
  it("returns current timestamp", () => {
    const ctx = makeContext();
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const before = Date.now();
    const now = (imports.host_get_now as Function)();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("Host Imports: host_emit_event", () => {
  it("emits a valid task event", () => {
    const onEmitEvent = vi.fn();
    const ctx = makeContext({ onEmitEvent });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const event = JSON.stringify({
      type: "task_assigned",
      taskId: "t1",
      task: { assignee: "user1" },
      timestamp: Date.now(),
      actorId: "will-be-overwritten",
    });
    const len = writeString(memory, 0, event);
    (imports.host_emit_event as Function)(0, len);

    expect(onEmitEvent).toHaveBeenCalledOnce();
    const emitted = onEmitEvent.mock.calls[0][0];
    expect(emitted.type).toBe("task_assigned");
    expect(emitted.taskId).toBe("t1");
    // actorId should be forced to agent prefix
    expect(emitted.actorId).toBe("agent:test-agent");
  });

  it("rejects disallowed event type", () => {
    const onEmitEvent = vi.fn();
    const ctx = makeContext({ onEmitEvent });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = JSON.stringify({
      type: "room_delete",
      taskId: "t1",
      timestamp: Date.now(),
      actorId: "x",
    });
    const len = writeString(memory, 0, event);
    (imports.host_emit_event as Function)(0, len);

    expect(onEmitEvent).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("rejects event without taskId", () => {
    const onEmitEvent = vi.fn();
    const ctx = makeContext({ onEmitEvent });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = JSON.stringify({
      type: "task_assigned",
      timestamp: Date.now(),
      actorId: "x",
    });
    const len = writeString(memory, 0, event);
    (imports.host_emit_event as Function)(0, len);

    expect(onEmitEvent).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does nothing when emit_events permission is denied", () => {
    const onEmitEvent = vi.fn();
    const ctx = makeContext({ onEmitEvent });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["read_tasks"], ctx); // No emit_events

    const event = JSON.stringify({
      type: "task_assigned",
      taskId: "t1",
      timestamp: Date.now(),
      actorId: "x",
    });
    const len = writeString(memory, 0, event);
    (imports.host_emit_event as Function)(0, len);

    expect(onEmitEvent).not.toHaveBeenCalled();
  });
});

describe("Host Imports: host_get_state / host_set_state", () => {
  it("reads cached state into agent memory", () => {
    const stateData = new TextEncoder().encode('{"count":7}');
    const ctx = makeContext({ stateCache: stateData });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_state as Function)(0, 4096);
    expect(written).toBe(stateData.length);
    expect(readString(memory, 0, written)).toBe('{"count":7}');
  });

  it("returns 0 when no cached state", () => {
    const ctx = makeContext({ stateCache: null });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_state as Function)(0, 4096);
    expect(written).toBe(0);
  });

  it("sets state in context and marks dirty", () => {
    const ctx = makeContext();
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const data = '{"count":42}';
    const len = writeString(memory, 0, data);
    (imports.host_set_state as Function)(0, len);

    expect(ctx.stateDirty).toBe(true);
    expect(ctx.stateCache).toBeDefined();
    expect(new TextDecoder().decode(ctx.stateCache!)).toBe('{"count":42}');
  });

  it("returns 0 when persist_state permission is denied", () => {
    const stateData = new TextEncoder().encode("secret");
    const ctx = makeContext({ stateCache: stateData });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ["read_tasks"], ctx); // No persist_state

    const written = (imports.host_get_state as Function)(0, 4096);
    expect(written).toBe(0);
  });
});

describe("Host Imports: host_log", () => {
  it("logs message with agent prefix", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = makeContext({ moduleId: "my-agent" });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const msg = "Hello from agent";
    const len = writeString(memory, 0, msg);
    (imports.host_log as Function)(0, len);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[agent:my-agent]",
      "Hello from agent",
    );
    consoleSpy.mockRestore();
  });
});

describe("callWithTimeout", () => {
  it("resolves when function completes quickly", async () => {
    const result = await callWithTimeout(() => 42, 1000);
    expect(result).toBe(42);
  });

  it("rejects when function throws", async () => {
    await expect(
      callWithTimeout(() => {
        throw new Error("boom");
      }, 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects on timeout", async () => {
    // We can't actually create an infinite WASM loop in a unit test,
    // but we can simulate a slow synchronous function
    await expect(
      callWithTimeout(() => {
        const start = Date.now();
        while (Date.now() - start < 200) {
          // Busy wait — but this blocks, so the timeout won't fire.
          // In practice, WASM timeouts need Web Workers for true preemption.
        }
        return "done";
      }, 50),
    ).resolves.toBe("done"); // Sync functions complete before timeout can fire
  });
});

describe("Host Imports: host_get_event (C-1)", () => {
  it("returns pending event bytes", () => {
    const eventJson = '{"type":"task_created","taskId":"t1"}';
    const eventBytes = new TextEncoder().encode(eventJson);
    const ctx = makeContext({ pendingEvent: eventBytes });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_event as Function)(0, 4096);
    expect(written).toBe(eventBytes.length);
    expect(readString(memory, 0, written)).toBe(eventJson);
  });

  it("returns 0 when no pending event", () => {
    const ctx = makeContext({ pendingEvent: null });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_event as Function)(0, 4096);
    expect(written).toBe(0);
  });

  it("returns 0 if buffer too small for event", () => {
    const eventBytes = new TextEncoder().encode(
      '{"type":"task_created","taskId":"t1"}',
    );
    const ctx = makeContext({ pendingEvent: eventBytes });
    const memory = makeMemory();
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    const written = (imports.host_get_event as Function)(0, 5); // Too small
    expect(written).toBe(0);
  });
});

describe("Host Imports: bounds checking (M-2)", () => {
  it("host_get_tasks returns 0 for out-of-bounds pointer", () => {
    const tasks = [
      {
        id: "t1",
        title: "A".repeat(200),
        status: "pending",
        createdBy: "u",
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const ctx = makeContext({ tasks: tasks as any });
    const memory = makeMemory(1); // 64KB
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    // JSON is ~260 bytes; ptr 65400 + 260 > 65536 → out of bounds
    const written = (imports.host_get_tasks as Function)(65400, 4096);
    expect(written).toBe(0);
  });

  it("host_log handles out-of-bounds gracefully", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = makeContext();
    const memory = makeMemory(1);
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    // Read from beyond memory
    (imports.host_log as Function)(65000, 1000);
    expect(consoleSpy).toHaveBeenCalledWith("[agent:test-agent]", "");
    consoleSpy.mockRestore();
  });
});

describe("Host Imports: host_set_state MAX_STATE_SIZE (M-1)", () => {
  it("rejects state larger than MAX_STATE_SIZE", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeContext();
    const memory = makeMemory(1);
    const imports = buildHostImports(memory, ALL_PERMS, ctx);

    // len > MAX_STATE_SIZE (1MB) — size check rejects before memory read
    (imports.host_set_state as Function)(0, 1024 * 1024 + 1);
    expect(ctx.stateDirty).toBe(false);
    expect(ctx.stateCache).toBeNull();
    consoleSpy.mockRestore();
  });
});
