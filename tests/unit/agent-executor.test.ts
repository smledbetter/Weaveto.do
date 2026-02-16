import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentExecutor } from "../../src/lib/agents/executor";
import type { StoredAgentModule } from "../../src/lib/agents/types";
import type { TaskEvent } from "../../src/lib/tasks/types";
import {
  MockWorker,
  installWorkerMock,
  removeWorkerMock,
} from "./helpers/worker-mock";

// Mock state key derivation (executor derives keys eagerly on main thread)
vi.mock("../../src/lib/agents/state", () => ({
  deriveAgentStateKey: vi.fn().mockResolvedValue(null),
  encryptState: vi.fn().mockResolvedValue({ iv: "", ciphertext: "" }),
  openStateDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
  saveState: vi.fn().mockResolvedValue(undefined),
}));

// Mock runtime state loading (happens on main thread before sending to worker)
vi.mock("../../src/lib/agents/runtime", () => ({
  loadAgentState: vi.fn().mockResolvedValue(undefined),
  flushAgentState: vi.fn().mockResolvedValue(undefined),
}));

function makeModule(name: string = "test-agent"): StoredAgentModule {
  return {
    id: `room-1:${name}`,
    roomId: "room-1",
    manifest: {
      name,
      version: "1.0.0",
      description: "Test agent",
      author: "tester",
      wasmHash: "abc123",
      permissions: ["read_tasks", "emit_events"],
    },
    wasmBytes: new ArrayBuffer(8),
    uploadedAt: Date.now(),
    active: false,
  };
}

describe("AgentExecutor", () => {
  let executor: AgentExecutor;
  let emittedEvents: TaskEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    installWorkerMock();
    MockWorker.callLog = [];
    emittedEvents = [];
    executor = new AgentExecutor("room-1", new Uint8Array(32), (event) => {
      emittedEvents.push(event);
    });
  });

  afterEach(async () => {
    await executor.shutdown();
    removeWorkerMock();
  });

  it("starts with no active agents", () => {
    expect(executor.getActiveAgents()).toEqual([]);
    expect(executor.isActive("room-1:test-agent")).toBe(false);
  });

  it("activates an agent module", async () => {
    const module = makeModule();
    await executor.activate(module);

    expect(executor.isActive("room-1:test-agent")).toBe(true);
    expect(executor.getActiveAgents()).toEqual(["room-1:test-agent"]);
    // Worker should have received instantiate + init call
    expect(MockWorker.callLog).toEqual([{ fn: "init" }]);
  });

  it("does not activate the same module twice", async () => {
    const module = makeModule();
    await executor.activate(module);
    await executor.activate(module);

    expect(executor.getActiveAgents()).toHaveLength(1);
    // Only one init call
    expect(MockWorker.callLog.filter((c) => c.fn === "init")).toHaveLength(1);
  });

  it("deactivates an agent module", async () => {
    const module = makeModule();
    await executor.activate(module);
    await executor.deactivate("room-1:test-agent");

    expect(executor.isActive("room-1:test-agent")).toBe(false);
    expect(executor.getActiveAgents()).toEqual([]);
  });

  it("deactivate is a no-op for non-active agent", async () => {
    await executor.deactivate("nonexistent");
    // Should not throw
  });

  it("dispatches task events to active agents", async () => {
    const module = makeModule();
    await executor.activate(module);

    const event: TaskEvent = {
      type: "task_created",
      taskId: "t1",
      task: {
        title: "Test",
        status: "pending",
        createdBy: "u1",
        createdAt: 1,
        updatedAt: 1,
      },
      timestamp: Date.now(),
      actorId: "user1",
    };

    await executor.dispatchTaskEvent(event);
    expect(
      MockWorker.callLog.filter((c) => c.fn === "on_task_event"),
    ).toHaveLength(1);
  });

  it("dispatches events to multiple active agents", async () => {
    await executor.activate(makeModule("agent-a"));
    await executor.activate(makeModule("agent-b"));

    MockWorker.callLog = [];

    const event: TaskEvent = {
      type: "task_assigned",
      taskId: "t1",
      task: { assignee: "u1" },
      timestamp: Date.now(),
      actorId: "user1",
    };

    await executor.dispatchTaskEvent(event);
    expect(
      MockWorker.callLog.filter((c) => c.fn === "on_task_event"),
    ).toHaveLength(2);
  });

  it("does not dispatch to deactivated agents", async () => {
    const module = makeModule();
    await executor.activate(module);
    await executor.deactivate("room-1:test-agent");

    MockWorker.callLog = [];

    const event: TaskEvent = {
      type: "task_created",
      taskId: "t1",
      task: {
        title: "X",
        status: "pending",
        createdBy: "u",
        createdAt: 0,
        updatedAt: 0,
      },
      timestamp: Date.now(),
      actorId: "u",
    };

    await executor.dispatchTaskEvent(event);
    expect(
      MockWorker.callLog.filter((c) => c.fn === "on_task_event"),
    ).toHaveLength(0);
  });

  it("updates context for all active agents", async () => {
    await executor.activate(makeModule("agent-a"));
    await executor.activate(makeModule("agent-b"));

    const tasks = [
      {
        id: "t1",
        title: "Task",
        status: "pending" as const,
        createdBy: "u",
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const members = new Map([
      ["k1", { identityKey: "k1", displayName: "Alice" }],
    ]);

    executor.updateContext(tasks, members);
    // No throw — context update is fire-and-forget postMessage
  });

  it("shutdown deactivates all agents", async () => {
    await executor.activate(makeModule("agent-a"));
    await executor.activate(makeModule("agent-b"));

    expect(executor.getActiveAgents()).toHaveLength(2);

    await executor.shutdown();

    expect(executor.getActiveAgents()).toHaveLength(0);
    expect(executor.isActive("room-1:agent-a")).toBe(false);
    expect(executor.isActive("room-1:agent-b")).toBe(false);
  });

  it("processes emitted events from worker response", async () => {
    // Override MockWorker to return emitted events
    const OrigMock = MockWorker;
    class EventEmittingWorker extends OrigMock {
      postMessage(request: any, transfer?: any): void {
        if (this.terminated) return;
        this.postMessageCalls.push(request);
        queueMicrotask(() => {
          if (this.terminated) return;
          if (request.type === "call" && request.fn === "on_task_event") {
            const response = {
              type: "call_ok" as const,
              id: request.id,
              stateCache: null,
              stateDirty: false,
              emittedEvents: [
                {
                  type: "task_assigned",
                  taskId: "t1",
                  task: { assignee: "agent-user" },
                  timestamp: Date.now(),
                  actorId: "agent:test",
                },
              ],
            };
            const handlers = (this as any).listeners?.get("message");
            if (handlers) {
              for (const handler of handlers) {
                handler({ data: response } as any);
              }
            }
          } else {
            // Default behavior for instantiate/init
            super.postMessage(request, transfer);
            // Undo the double-push from super
            this.postMessageCalls.pop();
          }
        });
      }
    }
    (globalThis as any).Worker = EventEmittingWorker;

    const executor2 = new AgentExecutor("room-1", null, (event) => {
      emittedEvents.push(event);
    });
    await executor2.activate(makeModule());
    await executor2.dispatchTaskEvent({
      type: "task_created",
      taskId: "t1",
      task: { title: "Test" },
      timestamp: Date.now(),
      actorId: "user1",
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe("task_assigned");

    await executor2.shutdown();
    (globalThis as any).Worker = MockWorker;
  });
});
