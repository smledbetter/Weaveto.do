/**
 * Agent infrastructure types.
 * Defines the contract between WASM agent modules and the host runtime.
 */

// --- Module Manifest ---

/** JSON manifest that accompanies every agent WASM binary. */
export interface AgentManifest {
	name: string;
	version: string;
	description: string;
	author: string;
	/** SHA-256 hex digest of the WASM binary. */
	wasmHash: string;
	/** Requested capabilities. Host may refuse if not granted. */
	permissions: AgentPermission[];
}

export type AgentPermission = 'read_tasks' | 'read_members' | 'emit_events' | 'persist_state';

// --- Stored Module ---

/** A validated agent module stored in IndexedDB. */
export interface StoredAgentModule {
	/** Unique key: roomId + manifest name. */
	id: string;
	roomId: string;
	manifest: AgentManifest;
	/** Raw WASM binary. */
	wasmBytes: ArrayBuffer;
	/** When the module was uploaded. */
	uploadedAt: number;
	/** Whether the agent is currently active. */
	active: boolean;
}

// --- WASM Exports (what the agent provides) ---

/** Functions the WASM module must export. */
export interface AgentExports {
	/** Called once on activation. */
	init: () => void;
	/** Called when a task event occurs. Receives a pointer + length to JSON in shared memory. */
	on_task_event: (ptr: number, len: number) => void;
	/** Called periodically (every 30s) for background work. */
	on_tick: () => void;
	/** Agent's linear memory. */
	memory: WebAssembly.Memory;
}

// --- Host Imports (what the host provides) ---

/** Functions the host exposes to the WASM agent via imports. */
export interface AgentHostImports {
	/** Write current tasks JSON into agent memory at buf_ptr. Returns bytes written. */
	host_get_tasks: (buf_ptr: number, buf_len: number) => number;
	/** Write current members JSON into agent memory at buf_ptr. Returns bytes written. */
	host_get_members: (buf_ptr: number, buf_len: number) => number;
	/** Returns current timestamp (ms since epoch). */
	host_get_now: () => number;
	/** Agent emits a TaskEvent (JSON at ptr, len bytes). Host validates and sends. */
	host_emit_event: (ptr: number, len: number) => void;
	/** Read persistent state into agent memory at buf_ptr. Returns bytes written (0 if no state). */
	host_get_state: (buf_ptr: number, buf_len: number) => number;
	/** Write persistent state from agent memory (ptr, len bytes). Host encrypts and stores. */
	host_set_state: (ptr: number, len: number) => void;
	/** Log a message (UTF-8 at ptr, len bytes). Written to console with agent prefix. */
	host_log: (ptr: number, len: number) => void;
}

// --- Runtime State ---

/** A live agent instance (WASM module instantiated with host bindings). */
export interface AgentInstance {
	moduleId: string;
	manifest: AgentManifest;
	exports: AgentExports;
	/** Tick interval handle for cleanup on deactivation. */
	tickInterval: ReturnType<typeof setInterval> | null;
}

// --- Encrypted State ---

/** Encrypted agent state as stored in IndexedDB. */
export interface EncryptedAgentState {
	/** Base64-encoded 12-byte IV. */
	iv: string;
	/** Base64-encoded AES-256-GCM ciphertext. */
	ciphertext: string;
}

// --- Validation ---

export const MAX_WASM_SIZE = 500 * 1024; // 500 KB
export const MAX_STATE_SIZE = 1024 * 1024; // 1 MB
export const MAX_MEMORY_PAGES = 160; // 10 MB (64KB per page)
export const TICK_INTERVAL_MS = 30_000; // 30 seconds
export const CALL_TIMEOUT_MS = 5_000; // 5 second timeout per agent call

export const REQUIRED_EXPORTS = ['init', 'on_task_event', 'on_tick', 'memory'] as const;

export const ALL_PERMISSIONS: AgentPermission[] = [
	'read_tasks',
	'read_members',
	'emit_events',
	'persist_state',
];
