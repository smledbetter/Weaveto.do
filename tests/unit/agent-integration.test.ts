// @vitest-environment node
/**
 * Integration tests for agent infrastructure wiring.
 * Tests the full pipeline: loader → executor → event dispatch → state persistence.
 * Uses node environment for crypto.subtle compatibility.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { AgentExecutor } from "../../src/lib/agents/executor";
import {
  validateManifest,
  computeWasmHash,
  storeModule,
  listModules,
  getModule,
  deleteModule,
  setModuleActive,
  openModuleDB,
} from "../../src/lib/agents/loader";
import type {
  AgentManifest,
  StoredAgentModule,
} from "../../src/lib/agents/types";
import type { TaskEvent, Task } from "../../src/lib/tasks/types";
import type { RoomMember } from "../../src/lib/room/session";

// --- Mocks ---

// Mock runtime module since we can't instantiate real WASM in node tests
vi.mock("../../src/lib/agents/runtime", () => {
  const mockExports = {
    init: vi.fn(),
    on_task_event: vi.fn(),
    on_tick: vi.fn(),
    memory: { buffer: new ArrayBuffer(1024) },
  };

  return {
    instantiateAgent: vi.fn().mockResolvedValue(mockExports),
    callWithTimeout: vi.fn((fn: () => unknown) => Promise.resolve(fn())),
    loadAgentState: vi.fn().mockResolvedValue(undefined),
    flushAgentState: vi.fn().mockResolvedValue(undefined),
    __mockExports: mockExports,
  };
});

// Get mock references
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __mockExports: mockExports } =
  (await import("../../src/lib/agents/runtime")) as any;

describe("Agent Integration: Loader → Executor Pipeline", () => {
  const ROOM_ID = "test-room-integration";
  let db: IDBDatabase;

  const manifest: AgentManifest = {
    name: "test-agent",
    version: "1.0.0",
    description: "Integration test agent",
    author: "test",
    wasmHash: "abc123",
    permissions: ["read_tasks", "emit_events"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset fake-indexeddb
    const { IDBFactory } = await import("fake-indexeddb");
    globalThis.indexedDB = new IDBFactory();
    db = await openModuleDB();
  });

  it("stores a module via loader and activates via executor", async () => {
    // Store module via loader
    const stored = await storeModule(
      db,
      ROOM_ID,
      manifest,
      new ArrayBuffer(64),
    );
    expect(stored.id).toBe(`${ROOM_ID}:test-agent`);
    expect(stored.active).toBe(false);

    // Create executor with event callback
    const emittedEvents: TaskEvent[] = [];
    const executor = new AgentExecutor(ROOM_ID, null, (event) => {
      emittedEvents.push(event);
    });

    // Activate the stored module
    await executor.activate(stored);
    expect(executor.isActive(stored.id)).toBe(true);

    // Mark active in loader DB
    await setModuleActive(db, stored.id, true);
    const reloaded = await getModule(db, stored.id);
    expect(reloaded?.active).toBe(true);

    // Clean up
    await executor.shutdown();
    db.close();
  });

  it("executor dispatches events to activated agents", async () => {
    const stored = await storeModule(
      db,
      ROOM_ID,
      manifest,
      new ArrayBuffer(64),
    );

    const executor = new AgentExecutor(ROOM_ID, null, vi.fn());
    await executor.activate(stored);

    const event: TaskEvent = {
      type: "task_created",
      taskId: "t1",
      timestamp: Date.now(),
      actorId: "user:abc",
      task: { title: "Test task" },
    };

    await executor.dispatchTaskEvent(event);
    expect(mockExports.on_task_event).toHaveBeenCalled();

    await executor.shutdown();
    db.close();
  });

  it("deactivated agents do not receive events", async () => {
    const stored = await storeModule(
      db,
      ROOM_ID,
      manifest,
      new ArrayBuffer(64),
    );

    const executor = new AgentExecutor(ROOM_ID, null, vi.fn());
    await executor.activate(stored);
    await executor.deactivate(stored.id);

    vi.clearAllMocks();

    const event: TaskEvent = {
      type: "task_created",
      taskId: "t2",
      timestamp: Date.now(),
      actorId: "user:abc",
    };

    await executor.dispatchTaskEvent(event);
    expect(mockExports.on_task_event).not.toHaveBeenCalled();

    await executor.shutdown();
    db.close();
  });

  it("context updates propagate to active agents", async () => {
    const stored = await storeModule(
      db,
      ROOM_ID,
      manifest,
      new ArrayBuffer(64),
    );

    const executor = new AgentExecutor(ROOM_ID, null, vi.fn());
    await executor.activate(stored);

    const tasks: Task[] = [
      {
        id: "t1",
        title: "Test",
        status: "pending",
        createdBy: "user1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    const members = new Map<string, RoomMember>([
      ["key1", { identityKey: "key1", displayName: "Alice" }],
    ]);

    // Should not throw
    executor.updateContext(tasks, members);

    await executor.shutdown();
    db.close();
  });

  it("full lifecycle: store → activate → dispatch → deactivate → delete", async () => {
    // 1. Store
    const stored = await storeModule(
      db,
      ROOM_ID,
      manifest,
      new ArrayBuffer(64),
    );
    expect(await listModules(db, ROOM_ID)).toHaveLength(1);

    // 2. Activate
    const executor = new AgentExecutor(ROOM_ID, null, vi.fn());
    await executor.activate(stored);
    await setModuleActive(db, stored.id, true);

    // 3. Dispatch
    await executor.dispatchTaskEvent({
      type: "task_assigned",
      taskId: "t1",
      timestamp: Date.now(),
      actorId: "user:abc",
    });
    expect(mockExports.on_task_event).toHaveBeenCalledTimes(1);

    // 4. Deactivate
    await executor.deactivate(stored.id);
    expect(executor.isActive(stored.id)).toBe(false);
    await setModuleActive(db, stored.id, false);

    // 5. Delete
    await deleteModule(db, stored.id);
    expect(await listModules(db, ROOM_ID)).toHaveLength(0);

    await executor.shutdown();
    db.close();
  });

  it("multiple agents can be active simultaneously", async () => {
    const manifest2: AgentManifest = {
      ...manifest,
      name: "second-agent",
    };

    const stored1 = await storeModule(
      db,
      ROOM_ID,
      manifest,
      new ArrayBuffer(64),
    );
    const stored2 = await storeModule(
      db,
      ROOM_ID,
      manifest2,
      new ArrayBuffer(64),
    );

    const executor = new AgentExecutor(ROOM_ID, null, vi.fn());
    await executor.activate(stored1);
    await executor.activate(stored2);

    expect(executor.getActiveAgents()).toHaveLength(2);

    vi.clearAllMocks();

    await executor.dispatchTaskEvent({
      type: "task_created",
      taskId: "t1",
      timestamp: Date.now(),
      actorId: "user:abc",
    });

    // on_task_event called once per agent
    expect(mockExports.on_task_event).toHaveBeenCalledTimes(2);

    await executor.shutdown();
    db.close();
  });
});

describe("Agent Integration: Manifest Validation → Store", () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    globalThis.indexedDB = new IDBFactory();
    db = await openModuleDB();
  });

  it("rejects invalid manifest before storing", async () => {
    const badManifest = { name: "test" }; // Missing fields
    const err = validateManifest(badManifest);
    expect(err).not.toBeNull();
    // Should not attempt to store
    expect(await listModules(db, "room1")).toHaveLength(0);
    db.close();
  });

  it("accepts valid manifest and stores successfully", async () => {
    const goodManifest: AgentManifest = {
      name: "good-agent",
      version: "1.0.0",
      description: "A valid agent",
      author: "tester",
      wasmHash: "deadbeef",
      permissions: ["read_tasks"],
    };

    const err = validateManifest(goodManifest);
    expect(err).toBeNull();

    const stored = await storeModule(
      db,
      "room1",
      goodManifest,
      new ArrayBuffer(32),
    );
    expect(stored.manifest.name).toBe("good-agent");

    const list = await listModules(db, "room1");
    expect(list).toHaveLength(1);
    db.close();
  });
});
