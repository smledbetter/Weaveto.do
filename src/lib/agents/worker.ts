/**
 * Agent Web Worker entry point.
 * Runs in a separate thread to enable true preemption via worker.terminate().
 * Instantiates WASM agents and executes their functions in response to main thread commands.
 */

import type {
	WorkerRequest,
	WorkerResponse,
	InstantiateRequest,
	CallRequest,
	UpdateContextRequest
} from './worker-protocol';
import type { AgentExports } from './types';
import type { HostContext } from './runtime';
import { instantiateAgent, buildHostImports } from './runtime';
import type { Task } from '$lib/tasks/types';
import type { RoomMember } from '$lib/room/session';

// Worker state
let agentExports: AgentExports | null = null;
let hostContext: HostContext | null = null;
let currentModuleId: string = '';

// Event collection during calls
let emittedEvents: unknown[] = [];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Handle incoming messages from the main thread.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const request = event.data;

	try {
		switch (request.type) {
			case 'instantiate':
				await handleInstantiate(request);
				break;
			case 'call':
				await handleCall(request);
				break;
			case 'update_context':
				handleUpdateContext(request);
				break;
			case 'terminate':
				self.close();
				break;
		}
	} catch (error) {
		const response: WorkerResponse = {
			type: 'error',
			id: 'id' in request ? request.id : 0,
			message: error instanceof Error ? error.message : String(error)
		};
		self.postMessage(response);
	}
};

/**
 * Handle InstantiateRequest: load WASM agent, create host context, instantiate.
 */
async function handleInstantiate(request: InstantiateRequest): Promise<void> {
	currentModuleId = request.moduleId;

	// Build members map from serialized array
	const membersMap = new Map<string, RoomMember>();
	for (const m of request.members) {
		membersMap.set(m.identityKey, {
			identityKey: m.identityKey,
			displayName: m.displayName
		});
	}

	// Create host context for this worker
	// Note: stateKey is null in worker — encryption happens on main thread
	hostContext = {
		tasks: request.tasks,
		members: membersMap,
		roomId: request.roomId,
		moduleId: request.moduleId,
		stateKey: null, // Worker doesn't handle encryption
		onEmitEvent: (event) => {
			// Collect events instead of emitting directly
			emittedEvents.push(event);
		},
		stateCache: request.stateCache,
		stateDirty: false,
		pendingEvent: null
	};

	// Instantiate the WASM agent
	agentExports = await instantiateAgent(
		request.wasmBytes,
		request.manifest,
		hostContext
	);

	const response: WorkerResponse = {
		type: 'instantiate_ok',
		id: request.id
	};
	self.postMessage(response);
}

/**
 * Handle CallRequest: call the specified agent function with timeout.
 * The main thread handles timeout by terminating the worker if no response arrives.
 */
async function handleCall(request: CallRequest): Promise<void> {
	if (!agentExports || !hostContext) {
		throw new Error('Agent not instantiated');
	}

	// Update context with latest tasks and members
	hostContext.tasks = request.tasks;
	const membersMap = new Map<string, RoomMember>();
	for (const m of request.members) {
		membersMap.set(m.identityKey, {
			identityKey: m.identityKey,
			displayName: m.displayName
		});
	}
	hostContext.members = membersMap;

	// Set pending event if provided (for on_task_event)
	hostContext.pendingEvent = request.pendingEvent;

	// Reset event collection and dirty flag
	emittedEvents = [];
	const initialStateDirty = hostContext.stateDirty;
	hostContext.stateDirty = false;

	// Call the requested function
	try {
		switch (request.fn) {
			case 'init':
				agentExports.init();
				break;
			case 'on_tick':
				agentExports.on_tick();
				break;
			case 'on_task_event':
				agentExports.on_task_event();
				break;
		}
	} finally {
		// Clear pending event
		hostContext.pendingEvent = null;
	}

	// Send response with collected events and updated state
	const response: WorkerResponse = {
		type: 'call_ok',
		id: request.id,
		stateCache: hostContext.stateDirty ? hostContext.stateCache : null,
		stateDirty: hostContext.stateDirty || initialStateDirty,
		emittedEvents
	};
	self.postMessage(response);
}

/**
 * Handle UpdateContextRequest: update context without calling a function.
 */
function handleUpdateContext(request: UpdateContextRequest): void {
	if (!hostContext) return;

	hostContext.tasks = request.tasks;
	const membersMap = new Map<string, RoomMember>();
	for (const m of request.members) {
		membersMap.set(m.identityKey, {
			identityKey: m.identityKey,
			displayName: m.displayName
		});
	}
	hostContext.members = membersMap;
}

/**
 * Send a log message back to the main thread.
 */
export function workerLog(message: string): void {
	const response: WorkerResponse = {
		type: 'log',
		moduleId: currentModuleId,
		message
	};
	self.postMessage(response);
}
