/**
 * Agent WASM runtime.
 * Instantiates WASM modules with host function bindings.
 * Provides sandboxed execution with capability-constrained imports.
 */

import type { Task, TaskEvent } from '$lib/tasks/types';
import type { RoomMember } from '$lib/room/session';
import type {
	AgentExports,
	AgentInstance,
	AgentManifest,
	AgentPermission,
} from './types';
import {
	CALL_TIMEOUT_MS,
	MAX_MEMORY_PAGES,
	TICK_INTERVAL_MS,
} from './types';
import {
	deriveAgentStateKey,
	encryptState,
	decryptState,
	openStateDB,
	saveState,
	loadState,
} from './state';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- Host Function Context ---

/** Mutable context passed to host functions. Updated by the executor before each call. */
export interface HostContext {
	tasks: Task[];
	members: Map<string, RoomMember>;
	roomId: string;
	moduleId: string;
	prfSeed: Uint8Array | null;
	onEmitEvent: (event: TaskEvent) => void;
	/** Current agent state (plaintext bytes, cached in memory). */
	stateCache: Uint8Array | null;
	/** Flag set when state is modified (needs flush to IndexedDB). */
	stateDirty: boolean;
}

// --- WASM Instantiation ---

/**
 * Instantiate a WASM agent module with host function bindings.
 * Returns the raw exports — caller is responsible for lifecycle management.
 */
export async function instantiateAgent(
	wasmBytes: ArrayBuffer,
	manifest: AgentManifest,
	context: HostContext,
): Promise<AgentExports> {
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

	// Use the module's own memory if it exports one, otherwise use ours
	const agentMemory = (exports.memory as WebAssembly.Memory) ?? memory;

	return {
		init: exports.init,
		on_task_event: exports.on_task_event,
		on_tick: exports.on_tick,
		memory: agentMemory,
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
		host_get_tasks: has('read_tasks')
			? (buf_ptr: number, buf_len: number) =>
					writeJsonToMemory(memory, buf_ptr, buf_len, context.tasks)
			: () => 0,

		host_get_members: has('read_members')
			? (buf_ptr: number, buf_len: number) => {
					const membersArray = Array.from(context.members.values()).map((m) => ({
						identityKey: m.identityKey,
						displayName: m.displayName,
					}));
					return writeJsonToMemory(memory, buf_ptr, buf_len, membersArray);
				}
			: () => 0,

		host_get_now: () => Date.now(),

		host_emit_event: has('emit_events')
			? (ptr: number, len: number) => {
					const json = readStringFromMemory(memory, ptr, len);
					try {
						const event = JSON.parse(json) as TaskEvent;
						validateEmittedEvent(event, context.moduleId);
						context.onEmitEvent(event);
					} catch (e) {
						console.warn(`[agent:${context.moduleId}] Invalid emitted event:`, e);
					}
				}
			: () => {},

		host_get_state: has('persist_state')
			? (buf_ptr: number, buf_len: number) => {
					if (!context.stateCache) return 0;
					return writeBytesToMemory(memory, buf_ptr, buf_len, context.stateCache);
				}
			: () => 0,

		host_set_state: has('persist_state')
			? (ptr: number, len: number) => {
					context.stateCache = readBytesFromMemory(memory, ptr, len);
					context.stateDirty = true;
				}
			: () => {},

		host_log: (ptr: number, len: number) => {
			const msg = readStringFromMemory(memory, ptr, len);
			console.log(`[agent:${context.moduleId}]`, msg);
		},
	};
}

// --- Event Validation ---

const ALLOWED_EVENT_TYPES = new Set([
	'task_created',
	'subtask_created',
	'task_assigned',
	'task_status_changed',
	'task_dependencies_changed',
]);

/**
 * Validate an event emitted by an agent before sending.
 * Ensures agents can only emit known event types and have proper actorId.
 */
function validateEmittedEvent(event: TaskEvent, moduleId: string): void {
	if (!event.type || !ALLOWED_EVENT_TYPES.has(event.type)) {
		throw new Error(`Disallowed event type: ${event.type}`);
	}
	if (!event.taskId) {
		throw new Error('Event missing taskId');
	}
	// Force agent actorId prefix
	event.actorId = `agent:${moduleId}`;
	event.timestamp = Date.now();
}

// --- Timeout Wrapper ---

/**
 * Call an agent function with a timeout.
 * If the call takes longer than CALL_TIMEOUT_MS, the promise rejects.
 * Note: This doesn't actually kill the WASM execution (no preemption in browsers),
 * but it prevents the host from waiting indefinitely. The caller should
 * deactivate the agent on timeout.
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
 */
export async function loadAgentState(context: HostContext): Promise<void> {
	if (!context.prfSeed) return;

	try {
		const db = await openStateDB();
		const encrypted = await loadState(db, context.roomId, context.moduleId);
		db.close();

		if (encrypted) {
			const key = await deriveAgentStateKey(context.prfSeed, context.moduleId);
			context.stateCache = await decryptState(key, encrypted);
		}
	} catch (e) {
		console.warn(`[agent:${context.moduleId}] Failed to load state:`, e);
		context.stateCache = null;
	}
}

/**
 * Flush dirty agent state to IndexedDB (encrypt + save).
 */
export async function flushAgentState(context: HostContext): Promise<void> {
	if (!context.stateDirty || !context.stateCache || !context.prfSeed) return;

	try {
		const key = await deriveAgentStateKey(context.prfSeed, context.moduleId);
		const encrypted = await encryptState(key, context.stateCache);
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
 * Returns the number of bytes written, or 0 if buffer too small.
 */
function writeBytesToMemory(
	memory: WebAssembly.Memory,
	ptr: number,
	maxLen: number,
	bytes: Uint8Array,
): number {
	if (bytes.length > maxLen) return 0;
	const view = new Uint8Array(memory.buffer, ptr, maxLen);
	view.set(bytes);
	return bytes.length;
}

/**
 * Read a UTF-8 string from WASM linear memory.
 */
function readStringFromMemory(
	memory: WebAssembly.Memory,
	ptr: number,
	len: number,
): string {
	const view = new Uint8Array(memory.buffer, ptr, len);
	return decoder.decode(view);
}

/**
 * Read raw bytes from WASM linear memory (copies to new Uint8Array).
 */
function readBytesFromMemory(
	memory: WebAssembly.Memory,
	ptr: number,
	len: number,
): Uint8Array {
	const view = new Uint8Array(memory.buffer, ptr, len);
	return new Uint8Array(view); // Copy — don't hold reference to WASM memory
}
