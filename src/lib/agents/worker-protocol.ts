/**
 * Message protocol types for main thread ↔ agent Web Worker communication.
 * All messages are discriminated unions on the `type` field.
 */

import type { Task } from '$lib/tasks/types';
import type { RoomMember } from '$lib/room/session';
import type { AgentManifest } from './types';

// --- Main → Worker (Requests) ---

/** Instantiate a WASM agent in the worker. */
export interface InstantiateRequest {
	type: 'instantiate';
	id: number;
	wasmBytes: ArrayBuffer;
	manifest: AgentManifest;
	moduleId: string;
	roomId: string;
	/** Raw state bytes from IndexedDB (already decrypted). Null if no prior state. */
	stateCache: Uint8Array | null;
	/** Serialized members: Array<{ identityKey: string; displayName: string }> */
	members: Array<{ identityKey: string; displayName: string }>;
	tasks: Task[];
}

/** Call an agent exported function. */
export interface CallRequest {
	type: 'call';
	id: number;
	fn: 'init' | 'on_tick' | 'on_task_event';
	/** Current tasks for context update + event validation. */
	tasks: Task[];
	/** Current members for context update. */
	members: Array<{ identityKey: string; displayName: string }>;
	/** Pending task event JSON bytes (only for on_task_event). */
	pendingEvent: Uint8Array | null;
	timeoutMs: number;
}

/** Terminate the worker. */
export interface TerminateRequest {
	type: 'terminate';
}

/** Update context without calling a function. */
export interface UpdateContextRequest {
	type: 'update_context';
	tasks: Task[];
	members: Array<{ identityKey: string; displayName: string }>;
}

export type WorkerRequest =
	| InstantiateRequest
	| CallRequest
	| TerminateRequest
	| UpdateContextRequest;

// --- Worker → Main (Responses) ---

/** Successful instantiation. */
export interface InstantiateResponse {
	type: 'instantiate_ok';
	id: number;
}

/** Successful function call. */
export interface CallResponse {
	type: 'call_ok';
	id: number;
	/** Updated state bytes if state was modified during the call. Null if unchanged. */
	stateCache: Uint8Array | null;
	stateDirty: boolean;
	/** Events emitted by the agent during this call. */
	emittedEvents: unknown[];
}

/** Error from any operation. */
export interface ErrorResponse {
	type: 'error';
	id: number;
	message: string;
}

/** Log message from agent. */
export interface LogMessage {
	type: 'log';
	moduleId: string;
	message: string;
}

export type WorkerResponse =
	| InstantiateResponse
	| CallResponse
	| ErrorResponse
	| LogMessage;
