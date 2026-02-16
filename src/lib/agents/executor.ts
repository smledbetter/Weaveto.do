/**
 * Agent executor.
 * Manages agent lifecycle: activation, event dispatch, tick loop, deactivation.
 * Wave 2: Refactored to use Web Workers for true preemption and sandboxing.
 */

import type { Task, TaskEvent } from "$lib/tasks/types";
import type { RoomMember } from "$lib/room/session";
import type { StoredAgentModule } from "./types";
import { TICK_INTERVAL_MS, CALL_TIMEOUT_MS } from "./types";
import { deriveAgentStateKey, encryptState } from "./state";
import { loadAgentState, flushAgentState } from "./runtime";
import type {
  WorkerRequest,
  WorkerResponse,
  InstantiateRequest,
  CallRequest,
  UpdateContextRequest,
} from "./worker-protocol";

const encoder = new TextEncoder();

/** Max consecutive tick failures before auto-deactivation (H-4). */
const MAX_TICK_FAILURES = 3;

/** Per-agent worker state tracked on the main thread. */
interface WorkerState {
  worker: Worker;
  moduleId: string;
  stateKey: CryptoKey | null;
  stateCache: Uint8Array | null;
  tickInterval: ReturnType<typeof setInterval> | null;
  requestIdCounter: number;
}

/**
 * Manages all active agent instances for a room.
 * Each agent runs in its own Web Worker for true isolation and preemption.
 */
export class AgentExecutor {
  private workers = new Map<string, WorkerState>();
  private tickFailures = new Map<string, number>();
  private lastRunTimes = new Map<string, number>();
  private roomId: string;
  private prfSeed: Uint8Array | null;
  private onEmitEvent: (event: TaskEvent) => void;
  // Cache latest context for dispatchTaskEvent
  private currentTasks: Task[] = [];
  private currentMembers = new Map<string, RoomMember>();

  constructor(
    roomId: string,
    prfSeed: Uint8Array | null,
    onEmitEvent: (event: TaskEvent) => void,
  ) {
    this.roomId = roomId;
    this.prfSeed = prfSeed;
    this.onEmitEvent = onEmitEvent;
  }

  /**
   * Activate an agent module. Spawns a Web Worker, instantiates WASM, calls init(), starts tick loop.
   */
  async activate(module: StoredAgentModule): Promise<void> {
    if (this.workers.has(module.id)) {
      return; // Already active
    }

    // Derive state key on main thread (CryptoKey can't be transferred to worker)
    let stateKey: CryptoKey | null = null;
    if (this.prfSeed) {
      stateKey = await deriveAgentStateKey(this.prfSeed, module.id);
    }

    // Load persisted state from IndexedDB (decrypt on main thread)
    let stateCache: Uint8Array | null = null;
    if (stateKey) {
      try {
        const context = {
          roomId: this.roomId,
          moduleId: module.id,
          stateKey,
          stateCache: null,
          stateDirty: false,
          tasks: [],
          members: new Map(),
          onEmitEvent: this.onEmitEvent,
          pendingEvent: null,
        };
        await loadAgentState(context);
        stateCache = context.stateCache;
      } catch (e) {
        // Log suppressed — silent state load failure
      }
    }

    // Spawn Web Worker
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    // Create worker state tracker
    const workerState: WorkerState = {
      worker,
      moduleId: module.id,
      stateKey,
      stateCache,
      tickInterval: null,
      requestIdCounter: 0,
    };

    this.workers.set(module.id, workerState);

    // Listen for log messages
    worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "log") {
          // Silently drop logs (no console.log in client code)
        }
      },
    );

    // Send InstantiateRequest
    // Spread manifest to create a plain object (JSON module imports may have non-clonable prototypes)
    const instantiateRequest: InstantiateRequest = {
      type: "instantiate",
      id: workerState.requestIdCounter++,
      wasmBytes: module.wasmBytes,
      manifest: JSON.parse(JSON.stringify(module.manifest)),
      moduleId: module.id,
      roomId: this.roomId,
      stateCache,
      members: [],
      tasks: [],
    };

    await this.sendRequest(workerState, instantiateRequest, CALL_TIMEOUT_MS);

    // Call init()
    try {
      await this.callFunction(module.id, "init", [], new Map());
    } catch (e) {
      // Init failed — terminate worker and cleanup
      worker.terminate();
      this.workers.delete(module.id);
      throw e;
    }

    // Start tick loop with circuit breaker (H-4)
    this.tickFailures.set(module.id, 0);
    const tickInterval = setInterval(async () => {
      try {
        await this.callFunction(module.id, "on_tick", [], new Map());
        this.tickFailures.set(module.id, 0); // Reset on success
        this.lastRunTimes.set(module.id, Date.now());
      } catch (e) {
        const failures = (this.tickFailures.get(module.id) ?? 0) + 1;
        this.tickFailures.set(module.id, failures);
        if (failures >= MAX_TICK_FAILURES) {
          this.deactivate(module.id);
        }
      }
    }, TICK_INTERVAL_MS);

    workerState.tickInterval = tickInterval;
  }

  /**
   * Deactivate an agent. Flushes state, stops tick loop, terminates worker.
   */
  async deactivate(moduleId: string): Promise<void> {
    const workerState = this.workers.get(moduleId);
    if (!workerState) return;

    // Stop tick loop
    if (workerState.tickInterval) {
      clearInterval(workerState.tickInterval);
    }

    // Flush any pending state changes
    await this.flushState(workerState);

    // Terminate worker
    workerState.worker.terminate();

    this.workers.delete(moduleId);
    this.tickFailures.delete(moduleId);
    this.lastRunTimes.delete(moduleId);
  }

  /**
   * Dispatch a task event to all active agents.
   */
  async dispatchTaskEvent(event: TaskEvent): Promise<void> {
    const json = JSON.stringify(event);
    const bytes = encoder.encode(json);

    for (const moduleId of this.workers.keys()) {
      try {
        await this.callFunction(
          moduleId,
          "on_task_event",
          this.currentTasks,
          this.currentMembers,
          bytes,
        );
      } catch (e) {
        // Event dispatch failed — silently drop
      }
    }
  }

  /**
   * Update the shared context (tasks, members) for all active agents.
   * Called by the room page whenever tasks or members change.
   */
  updateContext(tasks: Task[], members: Map<string, RoomMember>): void {
    // Cache for dispatchTaskEvent
    this.currentTasks = tasks;
    this.currentMembers = members;

    const serializedMembers = Array.from(members.values()).map((m) => ({
      identityKey: m.identityKey,
      displayName: m.displayName,
    }));

    for (const workerState of this.workers.values()) {
      const request: UpdateContextRequest = {
        type: "update_context",
        tasks,
        members: serializedMembers,
      };
      workerState.worker.postMessage(request);
    }
  }

  /**
   * Deactivate all agents and clean up.
   */
  async shutdown(): Promise<void> {
    const moduleIds = Array.from(this.workers.keys());
    for (const id of moduleIds) {
      await this.deactivate(id);
    }
  }

  /**
   * Get list of active agent module IDs.
   */
  getActiveAgents(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Check if a specific agent is active.
   */
  isActive(moduleId: string): boolean {
    return this.workers.has(moduleId);
  }

  /**
   * Get the last successful tick time for an agent.
   * Returns undefined if the agent hasn't ticked yet.
   */
  getLastRunTime(moduleId: string): number | undefined {
    return this.lastRunTimes.get(moduleId);
  }

  // --- Private Helpers ---

  /**
   * Call a worker function and process the response.
   */
  private async callFunction(
    moduleId: string,
    fn: "init" | "on_tick" | "on_task_event",
    tasks: Task[],
    members: Map<string, RoomMember>,
    pendingEvent: Uint8Array | null = null,
  ): Promise<void> {
    const workerState = this.workers.get(moduleId);
    if (!workerState) {
      throw new Error(`Agent ${moduleId} not active`);
    }

    const serializedMembers = Array.from(members.values()).map((m) => ({
      identityKey: m.identityKey,
      displayName: m.displayName,
    }));

    const request: CallRequest = {
      type: "call",
      id: workerState.requestIdCounter++,
      fn,
      tasks,
      members: serializedMembers,
      pendingEvent,
      timeoutMs: CALL_TIMEOUT_MS,
    };

    const response = await this.sendRequest(
      workerState,
      request,
      CALL_TIMEOUT_MS,
    );

    if (response.type === "call_ok") {
      // Process emitted events
      for (const event of response.emittedEvents) {
        try {
          this.onEmitEvent(event as TaskEvent);
        } catch (e) {
          // Invalid event — drop silently
        }
      }

      // Update state cache if modified
      if (response.stateDirty && response.stateCache) {
        workerState.stateCache = response.stateCache;
        await this.flushState(workerState);
      }
    }
  }

  /**
   * Send a request to a worker and wait for response with timeout.
   * If timeout expires, terminates the worker.
   */
  private sendRequest(
    workerState: WorkerState,
    request: WorkerRequest & { id: number },
    timeoutMs: number,
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        workerState.worker.terminate();
        this.workers.delete(workerState.moduleId);
        reject(new Error(`Agent call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (event: MessageEvent<WorkerResponse>) => {
        // Only handle responses for this specific request
        if ("id" in event.data && event.data.id === request.id) {
          clearTimeout(timer);
          workerState.worker.removeEventListener("message", handler);

          if (event.data.type === "error") {
            reject(new Error(event.data.message));
          } else {
            resolve(event.data);
          }
        }
      };

      workerState.worker.addEventListener("message", handler);

      workerState.worker.postMessage(request);
    });
  }

  /**
   * Flush dirty state to IndexedDB (encrypt + save).
   */
  private async flushState(workerState: WorkerState): Promise<void> {
    if (!workerState.stateCache || !workerState.stateKey) return;

    try {
      const encrypted = await encryptState(
        workerState.stateKey,
        workerState.stateCache,
      );
      const { openStateDB, saveState } = await import("./state");
      const db = await openStateDB();
      await saveState(db, this.roomId, workerState.moduleId, encrypted);
      db.close();
    } catch (e) {
      // Flush failed — silent failure
    }
  }
}
