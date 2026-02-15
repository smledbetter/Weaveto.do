/**
 * Agent executor.
 * Manages agent lifecycle: activation, event dispatch, tick loop, deactivation.
 */

import type { Task, TaskEvent } from "$lib/tasks/types";
import type { RoomMember } from "$lib/room/session";
import type { AgentInstance, StoredAgentModule } from "./types";
import { TICK_INTERVAL_MS, CALL_TIMEOUT_MS } from "./types";
import { deriveAgentStateKey } from "./state";
import {
  instantiateAgent,
  callWithTimeout,
  loadAgentState,
  flushAgentState,
  type HostContext,
} from "./runtime";

const encoder = new TextEncoder();

/** Max consecutive tick failures before auto-deactivation (H-4). */
const MAX_TICK_FAILURES = 3;

/**
 * Manages all active agent instances for a room.
 */
export class AgentExecutor {
  private instances = new Map<string, AgentInstance>();
  private contexts = new Map<string, HostContext>();
  private tickFailures = new Map<string, number>();
  private lastRunTimes = new Map<string, number>();
  private roomId: string;
  private prfSeed: Uint8Array | null;
  private onEmitEvent: (event: TaskEvent) => void;

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
   * Activate an agent module. Instantiates WASM, loads state, calls init(), starts tick loop.
   */
  async activate(module: StoredAgentModule): Promise<void> {
    if (this.instances.has(module.id)) {
      return; // Already active
    }

    // H-1: Derive CryptoKey eagerly, store only the derived key (not raw prfSeed)
    let stateKey: CryptoKey | null = null;
    if (this.prfSeed) {
      stateKey = await deriveAgentStateKey(this.prfSeed, module.id);
    }

    const context: HostContext = {
      tasks: [],
      members: new Map(),
      roomId: this.roomId,
      moduleId: module.id,
      stateKey,
      onEmitEvent: this.onEmitEvent,
      stateCache: null,
      stateDirty: false,
      pendingEvent: null,
    };

    // Load persisted state from IndexedDB
    await loadAgentState(context);

    // Instantiate WASM with host bindings
    const exports = await instantiateAgent(
      module.wasmBytes,
      module.manifest,
      context,
    );

    // Call init with timeout
    try {
      await callWithTimeout(() => exports.init(), CALL_TIMEOUT_MS);
    } catch (e) {
      console.error(`[agent:${module.id}] init() failed:`, e);
      throw e;
    }

    // Flush any state changes from init
    await flushAgentState(context);

    // Start tick loop with circuit breaker (H-4)
    this.tickFailures.set(module.id, 0);
    const tickInterval = setInterval(async () => {
      try {
        await callWithTimeout(() => exports.on_tick(), CALL_TIMEOUT_MS);
        await flushAgentState(context);
        this.tickFailures.set(module.id, 0); // Reset on success
        this.lastRunTimes.set(module.id, Date.now());
      } catch (e) {
        const failures = (this.tickFailures.get(module.id) ?? 0) + 1;
        this.tickFailures.set(module.id, failures);
        console.error(
          `[agent:${module.id}] on_tick() failed (${failures}/${MAX_TICK_FAILURES}):`,
          e,
        );
        if (failures >= MAX_TICK_FAILURES) {
          console.error(
            `[agent:${module.id}] Auto-deactivating after ${MAX_TICK_FAILURES} consecutive tick failures`,
          );
          this.deactivate(module.id);
        }
      }
    }, TICK_INTERVAL_MS);

    const instance: AgentInstance = {
      moduleId: module.id,
      manifest: module.manifest,
      exports,
      tickInterval,
    };

    this.instances.set(module.id, instance);
    this.contexts.set(module.id, context);
  }

  /**
   * Deactivate an agent. Flushes state, stops tick loop, destroys instance.
   */
  async deactivate(moduleId: string): Promise<void> {
    const instance = this.instances.get(moduleId);
    if (!instance) return;

    // Stop tick loop
    if (instance.tickInterval) {
      clearInterval(instance.tickInterval);
    }

    // Flush any pending state
    const context = this.contexts.get(moduleId);
    if (context) {
      await flushAgentState(context);
    }

    this.instances.delete(moduleId);
    this.contexts.delete(moduleId);
    this.tickFailures.delete(moduleId);
    this.lastRunTimes.delete(moduleId);
  }

  /**
   * Dispatch a task event to all active agents.
   * C-1: Stores event in context.pendingEvent, then calls on_task_event() with
   * no arguments. Agent reads the event via host_get_event(buf_ptr, buf_len).
   * This avoids writing to agent memory at offset 0 (which corrupts agent data).
   */
  async dispatchTaskEvent(event: TaskEvent): Promise<void> {
    const json = JSON.stringify(event);
    const bytes = encoder.encode(json);

    for (const [moduleId, instance] of this.instances) {
      const context = this.contexts.get(moduleId);
      try {
        // Set pending event in context — agent reads it via host_get_event
        if (context) {
          context.pendingEvent = bytes;
        }

        await callWithTimeout(
          () => instance.exports.on_task_event(),
          CALL_TIMEOUT_MS,
        );

        // Clear pending event and flush state
        if (context) {
          context.pendingEvent = null;
          await flushAgentState(context);
        }
      } catch (e) {
        console.error(`[agent:${moduleId}] on_task_event() failed:`, e);
        // Clear pending event even on failure
        if (context) {
          context.pendingEvent = null;
        }
      }
    }
  }

  /**
   * Update the shared context (tasks, members) for all active agents.
   * Called by the room page whenever tasks or members change.
   */
  updateContext(tasks: Task[], members: Map<string, RoomMember>): void {
    for (const context of this.contexts.values()) {
      context.tasks = tasks;
      context.members = members;
    }
  }

  /**
   * Deactivate all agents and clean up.
   */
  async shutdown(): Promise<void> {
    const moduleIds = Array.from(this.instances.keys());
    for (const id of moduleIds) {
      await this.deactivate(id);
    }
  }

  /**
   * Get list of active agent module IDs.
   */
  getActiveAgents(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Check if a specific agent is active.
   */
  isActive(moduleId: string): boolean {
    return this.instances.has(moduleId);
  }

  /**
   * Get the last successful tick time for an agent.
   * Returns undefined if the agent hasn't ticked yet.
   */
  getLastRunTime(moduleId: string): number | undefined {
    return this.lastRunTimes.get(moduleId);
  }
}
