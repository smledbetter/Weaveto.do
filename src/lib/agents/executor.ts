/**
 * Agent executor.
 * Manages agent lifecycle: activation, event dispatch, tick loop, deactivation.
 */

import type { Task, TaskEvent } from "$lib/tasks/types";
import type { RoomMember } from "$lib/room/session";
import type { AgentInstance, StoredAgentModule } from "./types";
import { TICK_INTERVAL_MS, CALL_TIMEOUT_MS } from "./types";
import {
  instantiateAgent,
  callWithTimeout,
  loadAgentState,
  flushAgentState,
  type HostContext,
} from "./runtime";

const encoder = new TextEncoder();

/**
 * Manages all active agent instances for a room.
 */
export class AgentExecutor {
  private instances = new Map<string, AgentInstance>();
  private contexts = new Map<string, HostContext>();
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

    const context: HostContext = {
      tasks: [],
      members: new Map(),
      roomId: this.roomId,
      moduleId: module.id,
      prfSeed: this.prfSeed,
      onEmitEvent: this.onEmitEvent,
      stateCache: null,
      stateDirty: false,
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

    // Start tick loop
    const tickInterval = setInterval(async () => {
      try {
        await callWithTimeout(() => exports.on_tick(), CALL_TIMEOUT_MS);
        await flushAgentState(context);
      } catch (e) {
        console.error(`[agent:${module.id}] on_tick() failed:`, e);
        // Deactivate on repeated failures? For now, just log.
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
  }

  /**
   * Dispatch a task event to all active agents.
   * Serializes the event to JSON, writes it into each agent's WASM memory,
   * and calls on_task_event.
   */
  async dispatchTaskEvent(event: TaskEvent): Promise<void> {
    const json = JSON.stringify(event);
    const bytes = encoder.encode(json);

    for (const [moduleId, instance] of this.instances) {
      const context = this.contexts.get(moduleId);
      try {
        // Write event JSON into agent's WASM memory at offset 0
        const memory = instance.exports.memory;
        const view = new Uint8Array(memory.buffer, 0, bytes.length);
        view.set(bytes);

        await callWithTimeout(
          () => instance.exports.on_task_event(0, bytes.length),
          CALL_TIMEOUT_MS,
        );

        // Flush state if agent modified it during event handling
        if (context) {
          await flushAgentState(context);
        }
      } catch (e) {
        console.error(`[agent:${moduleId}] on_task_event() failed:`, e);
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
}
