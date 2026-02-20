/**
 * Agent WASM runtime.
 * Instantiates WASM modules with host function bindings.
 * Provides sandboxed execution with capability-constrained imports.
 *
 * Wave 2: Functions used by both main thread (executor) and Web Worker.
 * - Worker uses: instantiateAgent, buildHostImports, memory helpers
 * - Main thread uses: loadAgentState, flushAgentState (IndexedDB operations)
 * - callWithTimeout: deprecated, worker timeout handled by worker.terminate()
 */

import type { Task, TaskEvent } from "$lib/tasks/types";
import type { RoomMember } from "$lib/room/session";
import type { AgentExports, AgentManifest, AgentPermission } from "./types";
import {
  CALL_TIMEOUT_MS,
  MAX_MEMORY_PAGES,
  MAX_STATE_SIZE,
  DEP_TASK_ID_SIZE,
  DEP_TASK_RECORD_SIZE,
} from "./types";
import {
  encryptState,
  decryptState,
  openStateDB,
  saveState,
  loadState,
} from "./state";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- Host Function Context ---

/** Mutable context passed to host functions. Updated by the executor before each call. */
export interface HostContext {
  tasks: Task[];
  members: Map<string, RoomMember>;
  roomId: string;
  moduleId: string;
  /** Pre-derived AES-256-GCM key for state encryption. Null if no prfSeed. (H-1) */
  stateKey: CryptoKey | null;
  onEmitEvent: (event: TaskEvent) => void;
  /** Current agent state (plaintext bytes, cached in memory). */
  stateCache: Uint8Array | null;
  /** Flag set when state is modified (needs flush to IndexedDB). */
  stateDirty: boolean;
  /** Pending task event JSON bytes, set by executor before calling on_task_event. (C-1) */
  pendingEvent: Uint8Array | null;
}

// --- WASM Instantiation ---

/**
 * Instantiate a WASM agent module with host function bindings.
 * Returns the raw exports — caller is responsible for lifecycle management.
 *
 * Security: verifies WASM hash matches manifest before instantiation (H-2).
 * Security: always uses host-provided memory; ignores agent-exported memory (H-3).
 */
export async function instantiateAgent(
  wasmBytes: ArrayBuffer,
  manifest: AgentManifest,
  context: HostContext,
): Promise<AgentExports> {
  // H-2: Re-verify hash at instantiation time (TOCTOU defense)
  const hashBuffer = await crypto.subtle.digest("SHA-256", wasmBytes);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hashHex !== manifest.wasmHash) {
    throw new Error(
      `WASM hash mismatch at instantiation: expected ${manifest.wasmHash}, got ${hashHex}`,
    );
  }

  const memory = new WebAssembly.Memory({
    initial: 1, // 64KB
    maximum: MAX_MEMORY_PAGES, // 10MB cap
  });

  const imports = buildHostImports(memory, manifest.permissions, context);

  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: {
      memory,
      ...imports,
    },
  });

  const exports = instance.exports as unknown as AgentExports;

  // H-3: Always use host-provided memory. Agent-exported memory could bypass
  // the MAX_MEMORY_PAGES cap. Host functions are bound to `memory`, so using
  // a different memory object would cause split-brain reads/writes.

  return {
    init: exports.init,
    on_task_event: exports.on_task_event,
    on_tick: exports.on_tick,
    memory,
  };
}

// --- Host Import Builder ---

/**
 * Build the host function imports object based on granted permissions.
 * Denied permissions return stub functions that do nothing / return 0.
 */
export function buildHostImports(
  memory: WebAssembly.Memory,
  permissions: AgentPermission[],
  context: HostContext,
): Record<string, Function> {
  const has = (p: AgentPermission) => permissions.includes(p);

  return {
    host_get_tasks: has("read_tasks")
      ? (buf_ptr: number, buf_len: number) =>
          writeJsonToMemory(memory, buf_ptr, buf_len, context.tasks)
      : () => 0,

    host_get_members: has("read_members")
      ? (buf_ptr: number, buf_len: number) => {
          const membersArray = Array.from(context.members.values()).map(
            (m) => ({
              identityKey: m.identityKey,
              displayName: m.displayName,
            }),
          );
          return writeJsonToMemory(memory, buf_ptr, buf_len, membersArray);
        }
      : () => 0,

    host_get_now: () => Date.now(),

    host_emit_event: has("emit_events")
      ? (ptr: number, len: number) => {
          const json = readStringFromMemory(memory, ptr, len);
          try {
            const event = JSON.parse(json) as TaskEvent;
            validateEmittedEvent(event, context.moduleId, context.tasks);
            context.onEmitEvent(event);
          } catch {
            // Silently drop invalid events (no console in production)
          }
        }
      : () => {},

    host_get_state: has("persist_state")
      ? (buf_ptr: number, buf_len: number) => {
          if (!context.stateCache) return 0;
          return writeBytesToMemory(
            memory,
            buf_ptr,
            buf_len,
            context.stateCache,
          );
        }
      : () => 0,

    host_set_state: has("persist_state")
      ? (ptr: number, len: number) => {
          // M-1: Enforce MAX_STATE_SIZE on write
          if (len > MAX_STATE_SIZE) {
            console.warn(
              `[agent:${context.moduleId}] State exceeds max size (${len} > ${MAX_STATE_SIZE})`,
            );
            return;
          }
          context.stateCache = readBytesFromMemory(memory, ptr, len);
          context.stateDirty = true;
        }
      : () => {},

    // C-1: Agent pulls pending event via host import instead of host writing to offset 0
    host_get_event: (buf_ptr: number, buf_len: number) => {
      if (!context.pendingEvent) return 0;
      return writeBytesToMemory(memory, buf_ptr, buf_len, context.pendingEvent);
    },

    // Binary helper for simple agents that can't parse JSON (e.g. hand-written WAT).
    // Returns compact binary: [u32 unassignedCount][u32 memberCount][task records][member records]
    host_get_assignment_data:
      has("read_tasks") && has("read_members")
        ? (buf_ptr: number, buf_len: number) => {
            const data = buildAssignmentData(context.tasks, context.members);
            return writeBytesToMemory(memory, buf_ptr, buf_len, data);
          }
        : () => 0,

    // High-level assignment helper: agent passes taskId + assignee pointers, host builds JSON event.
    // Avoids JSON string construction in WAT. Agent still decides *who* gets *which* task.
    host_emit_assignment:
      has("emit_events") && has("read_tasks")
        ? (
            task_id_ptr: number,
            task_id_len: number,
            assignee_ptr: number,
            assignee_len: number,
          ) => {
            const taskId = readStringFromMemory(
              memory,
              task_id_ptr,
              task_id_len,
            );
            const assignee = readStringFromMemory(
              memory,
              assignee_ptr,
              assignee_len,
            );
            if (!taskId || !assignee) return;
            const event: TaskEvent = {
              type: "task_assigned",
              taskId,
              task: { assignee },
              timestamp: Date.now(),
              actorId: `agent:${context.moduleId}`,
            };
            context.onEmitEvent(event);
          }
        : () => {},

    // Binary dependency graph data for bottleneck detection (e.g. hand-written WAT).
    // Returns compact binary: [u32 taskCount][task records with dependentCount]
    host_get_dependency_data: has("read_tasks")
      ? (buf_ptr: number, buf_len: number) => {
          const data = buildDependencyData(context.tasks);
          return writeBytesToMemory(memory, buf_ptr, buf_len, data);
        }
      : () => 0,

    // High-level urgency helper: agent passes taskId pointer, host builds task_urgency_changed event.
    host_emit_urgency:
      has("emit_events") && has("read_tasks")
        ? (task_id_ptr: number, task_id_len: number) => {
            const taskId = readStringFromMemory(memory, task_id_ptr, task_id_len);
            if (!taskId) return;
            const task = context.tasks.find((t) => t.id === taskId);
            if (!task || task.urgent) return;
            const event: TaskEvent = {
              type: "task_urgency_changed",
              taskId,
              task: { urgent: true },
              timestamp: Date.now(),
              actorId: `agent:${context.moduleId}`,
            };
            context.onEmitEvent(event);
          }
        : () => {},

    host_log: (_ptr: number, _len: number) => {
      // No-op in production (no console logging allowed)
    },
  };
}

// --- Event Validation ---

const ALLOWED_EVENT_TYPES = new Set([
  "task_created",
  "subtask_created",
  "task_assigned",
  "task_status_changed",
  "task_dependencies_changed",
  "task_urgency_changed",
]);

/** Event types that create new tasks (taskId won't exist yet). */
const CREATES_NEW_TASK = new Set(["task_created", "subtask_created"]);

/**
 * Validate an event emitted by an agent before sending.
 * Ensures agents can only emit known event types, have proper actorId,
 * and reference existing tasks (except for task creation events).
 */
export function validateEmittedEvent(
  event: TaskEvent,
  moduleId: string,
  currentTasks: Task[] = [],
): void {
  if (!event.type || !ALLOWED_EVENT_TYPES.has(event.type)) {
    throw new Error(`Disallowed event type: ${event.type}`);
  }
  if (!event.taskId) {
    throw new Error("Event missing taskId");
  }

  // Validate taskId exists for non-creation events
  if (!CREATES_NEW_TASK.has(event.type) && currentTasks.length > 0) {
    const taskExists = currentTasks.some((t) => t.id === event.taskId);
    if (!taskExists) {
      throw new Error(
        `Agent emitted event for unknown taskId: ${event.taskId}`,
      );
    }
  }

  // Force agent actorId prefix
  event.actorId = `agent:${moduleId}`;
  event.timestamp = Date.now();
}

// --- Assignment Data Builder ---

/** Size of a task record in the binary format: 36-byte taskId + 1 isBlocked flag. */
export const TASK_ID_SIZE = 36;
export const TASK_RECORD_SIZE = TASK_ID_SIZE + 1; // 37 bytes
/** Size of a member record: 36-byte identityKey + u32 load + u32 lastActive. */
export const MEMBER_KEY_SIZE = 36;
export const MEMBER_RECORD_SIZE = MEMBER_KEY_SIZE + 4 + 4; // 44 bytes

/**
 * Build compact binary format for simple agents (e.g. hand-written WAT).
 *
 * Format:
 *   [u32: unassignedPendingTaskCount] (little-endian)
 *   [u32: memberCount]               (little-endian)
 *   For each unassigned pending task:
 *     [TASK_ID_SIZE bytes: taskId UTF-8, zero-padded]
 *     [u8: isBlocked (0=assignable, 1=blocked)]
 *   For each member:
 *     [MEMBER_KEY_SIZE bytes: identityKey UTF-8, zero-padded]
 *     [u32: pendingTaskCount]   (little-endian)
 *     [u32: lastActiveTimestamp] (little-endian, seconds since epoch, 0 if unknown)
 */
export function buildAssignmentData(
  tasks: Task[],
  members: Map<string, RoomMember>,
): Uint8Array {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Filter unassigned pending tasks
  const unassignedPending = tasks.filter(
    (t) => t.status === "pending" && !t.assignee,
  );

  // Pre-compute blocked status for each
  const isBlocked = (task: Task): boolean =>
    task.blockedBy?.some((depId) => {
      const dep = taskMap.get(depId);
      return dep && dep.status !== "completed";
    }) ?? false;

  const allMemberKeys = Array.from(members.keys());

  // Count non-completed tasks per member
  const loads = new Map<string, number>();
  for (const key of allMemberKeys) {
    loads.set(
      key,
      tasks.filter((t) => t.assignee === key && t.status !== "completed")
        .length,
    );
  }

  // Calculate buffer size
  const headerSize = 8; // 2 * u32
  const totalSize =
    headerSize +
    unassignedPending.length * TASK_RECORD_SIZE +
    allMemberKeys.length * MEMBER_RECORD_SIZE;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let offset = 0;

  // Header
  view.setUint32(offset, unassignedPending.length, true);
  offset += 4;
  view.setUint32(offset, allMemberKeys.length, true);
  offset += 4;

  // Task records
  for (const task of unassignedPending) {
    const idBytes = encoder.encode(task.id.slice(0, TASK_ID_SIZE));
    buffer.set(idBytes, offset);
    offset += TASK_ID_SIZE;
    buffer[offset] = isBlocked(task) ? 1 : 0;
    offset += 1;
  }

  // Member records
  for (const key of allMemberKeys) {
    const keyBytes = encoder.encode(key.slice(0, MEMBER_KEY_SIZE));
    buffer.set(keyBytes, offset);
    offset += MEMBER_KEY_SIZE;
    view.setUint32(offset, loads.get(key) ?? 0, true);
    offset += 4;
    // lastActive: 0 for now (executor can update context with real timestamps later)
    view.setUint32(offset, 0, true);
    offset += 4;
  }

  return buffer;
}

// --- Dependency Data Builder ---

const STATUS_MAP: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

/**
 * Build compact binary format for bottleneck detection agents (e.g. hand-written WAT).
 *
 * Format:
 *   [u32: taskCount]                   (little-endian)
 *   For each task (39 bytes):
 *     [DEP_TASK_ID_SIZE bytes: taskId UTF-8, zero-padded]
 *     [u8: status (0=pending, 1=in_progress, 2=completed)]
 *     [u8: isUrgent (0 or 1)]
 *     [u8: dependentCount — number of non-completed tasks whose blockedBy includes this taskId, capped at 255]
 */
export function buildDependencyData(tasks: Task[]): Uint8Array {
  // Count how many non-completed tasks depend on each task
  const dependentCounts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "completed") continue;
    if (!task.blockedBy) continue;
    for (const depId of task.blockedBy) {
      dependentCounts.set(depId, (dependentCounts.get(depId) ?? 0) + 1);
    }
  }

  const headerSize = 4;
  const totalSize = headerSize + tasks.length * DEP_TASK_RECORD_SIZE;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // Header
  view.setUint32(0, tasks.length, true);

  let offset = 4;
  for (const task of tasks) {
    // TaskId (zero-padded to DEP_TASK_ID_SIZE)
    const idBytes = encoder.encode(task.id.slice(0, DEP_TASK_ID_SIZE));
    buffer.set(idBytes, offset);
    offset += DEP_TASK_ID_SIZE;

    // Status
    buffer[offset] = STATUS_MAP[task.status] ?? 0;
    offset += 1;

    // isUrgent
    buffer[offset] = task.urgent ? 1 : 0;
    offset += 1;

    // dependentCount (capped at 255)
    buffer[offset] = Math.min(dependentCounts.get(task.id) ?? 0, 255);
    offset += 1;
  }

  return buffer;
}

// --- Timeout Wrapper ---

/**
 * Call an agent function with a timeout.
 * Note: synchronous WASM blocks the JS event loop, so this timeout only fires
 * after the call returns. True preemption requires a Web Worker (C-2, deferred).
 *
 * @deprecated Wave 2+ uses Web Workers for true preemption via worker.terminate().
 * This function remains for backward compatibility but is not used by executor.ts.
 */
export function callWithTimeout<T>(
  fn: () => T,
  timeoutMs: number = CALL_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Agent call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const result = fn();
      clearTimeout(timer);
      resolve(result);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

// --- State Persistence ---

/**
 * Load agent state from IndexedDB, decrypt, and cache in context.
 * H-1: Uses pre-derived stateKey instead of raw prfSeed.
 */
export async function loadAgentState(context: HostContext): Promise<void> {
  if (!context.stateKey) return;

  try {
    const db = await openStateDB();
    const encrypted = await loadState(db, context.roomId, context.moduleId);
    db.close();

    if (encrypted) {
      context.stateCache = await decryptState(context.stateKey, encrypted);
    }
  } catch (e) {
    console.warn(`[agent:${context.moduleId}] Failed to load state:`, e);
    context.stateCache = null;
  }
}

/**
 * Flush dirty agent state to IndexedDB (encrypt + save).
 * H-1: Uses pre-derived stateKey instead of raw prfSeed.
 */
export async function flushAgentState(context: HostContext): Promise<void> {
  if (!context.stateDirty || !context.stateCache || !context.stateKey) return;

  try {
    const encrypted = await encryptState(context.stateKey, context.stateCache);
    const db = await openStateDB();
    await saveState(db, context.roomId, context.moduleId, encrypted);
    db.close();
    context.stateDirty = false;
  } catch (e) {
    console.warn(`[agent:${context.moduleId}] Failed to flush state:`, e);
  }
}

// --- Memory Helpers ---

/**
 * Validate that a pointer+length pair is within WASM memory bounds.
 */
function boundsCheck(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): boolean {
  return ptr >= 0 && len >= 0 && ptr + len <= memory.buffer.byteLength;
}

/**
 * Write a JSON-serializable value into WASM linear memory.
 * Returns the number of bytes written, or 0 if buffer too small.
 */
function writeJsonToMemory(
  memory: WebAssembly.Memory,
  ptr: number,
  maxLen: number,
  value: unknown,
): number {
  const json = JSON.stringify(value);
  const bytes = encoder.encode(json);
  return writeBytesToMemory(memory, ptr, maxLen, bytes);
}

/**
 * Write raw bytes into WASM linear memory.
 * Returns the number of bytes written, or 0 if buffer too small or out of bounds.
 */
function writeBytesToMemory(
  memory: WebAssembly.Memory,
  ptr: number,
  maxLen: number,
  bytes: Uint8Array,
): number {
  if (bytes.length > maxLen) return 0;
  if (!boundsCheck(memory, ptr, bytes.length)) return 0;
  const view = new Uint8Array(memory.buffer, ptr, bytes.length);
  view.set(bytes);
  return bytes.length;
}

/**
 * Read a UTF-8 string from WASM linear memory.
 * Returns empty string if out of bounds.
 */
function readStringFromMemory(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): string {
  if (!boundsCheck(memory, ptr, len)) return "";
  const view = new Uint8Array(memory.buffer, ptr, len);
  return decoder.decode(view);
}

/**
 * Read raw bytes from WASM linear memory (copies to new Uint8Array).
 * Returns empty array if out of bounds.
 */
function readBytesFromMemory(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
): Uint8Array {
  if (!boundsCheck(memory, ptr, len)) return new Uint8Array(0);
  const view = new Uint8Array(memory.buffer, ptr, len);
  return new Uint8Array(view); // Copy — don't hold reference to WASM memory
}
