import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentExecutor } from '../../src/lib/agents/executor';
import type { StoredAgentModule } from '../../src/lib/agents/types';
import type { TaskEvent } from '../../src/lib/tasks/types';

// Mock the runtime module
vi.mock('../../src/lib/agents/runtime', () => {
	const mockExports = {
		init: vi.fn(),
		on_task_event: vi.fn(),
		on_tick: vi.fn(),
		memory: new WebAssembly.Memory({ initial: 1 }),
	};

	return {
		instantiateAgent: vi.fn().mockResolvedValue(mockExports),
		callWithTimeout: vi.fn((fn: () => unknown) => Promise.resolve(fn())),
		loadAgentState: vi.fn().mockResolvedValue(undefined),
		flushAgentState: vi.fn().mockResolvedValue(undefined),
		__mockExports: mockExports,
	};
});

// Access mocks
import {
	instantiateAgent,
	callWithTimeout,
	loadAgentState,
	flushAgentState,
	// @ts-expect-error — test-only export
	__mockExports,
} from '../../src/lib/agents/runtime';

function makeModule(name: string = 'test-agent'): StoredAgentModule {
	return {
		id: `room-1:${name}`,
		roomId: 'room-1',
		manifest: {
			name,
			version: '1.0.0',
			description: 'Test agent',
			author: 'tester',
			wasmHash: 'abc123',
			permissions: ['read_tasks', 'emit_events'],
		},
		wasmBytes: new ArrayBuffer(8),
		uploadedAt: Date.now(),
		active: false,
	};
}

describe('AgentExecutor', () => {
	let executor: AgentExecutor;
	let emittedEvents: TaskEvent[];

	beforeEach(() => {
		vi.clearAllMocks();
		emittedEvents = [];
		executor = new AgentExecutor('room-1', new Uint8Array(32), (event) => {
			emittedEvents.push(event);
		});
	});

	afterEach(async () => {
		await executor.shutdown();
	});

	it('starts with no active agents', () => {
		expect(executor.getActiveAgents()).toEqual([]);
		expect(executor.isActive('room-1:test-agent')).toBe(false);
	});

	it('activates an agent module', async () => {
		const module = makeModule();
		await executor.activate(module);

		expect(executor.isActive('room-1:test-agent')).toBe(true);
		expect(executor.getActiveAgents()).toEqual(['room-1:test-agent']);
		expect(instantiateAgent).toHaveBeenCalledOnce();
		expect(loadAgentState).toHaveBeenCalledOnce();
		expect(__mockExports.init).toHaveBeenCalledOnce();
	});

	it('does not activate the same module twice', async () => {
		const module = makeModule();
		await executor.activate(module);
		await executor.activate(module);

		expect(instantiateAgent).toHaveBeenCalledOnce();
		expect(executor.getActiveAgents()).toHaveLength(1);
	});

	it('deactivates an agent module', async () => {
		const module = makeModule();
		await executor.activate(module);
		await executor.deactivate('room-1:test-agent');

		expect(executor.isActive('room-1:test-agent')).toBe(false);
		expect(executor.getActiveAgents()).toEqual([]);
		expect(flushAgentState).toHaveBeenCalled();
	});

	it('deactivate is a no-op for non-active agent', async () => {
		await executor.deactivate('nonexistent');
		// Should not throw
	});

	it('dispatches task events to active agents', async () => {
		const module = makeModule();
		await executor.activate(module);

		const event: TaskEvent = {
			type: 'task_created',
			taskId: 't1',
			task: { title: 'Test', status: 'pending', createdBy: 'u1', createdAt: 1, updatedAt: 1 },
			timestamp: Date.now(),
			actorId: 'user1',
		};

		await executor.dispatchTaskEvent(event);
		expect(__mockExports.on_task_event).toHaveBeenCalledOnce();
	});

	it('dispatches events to multiple active agents', async () => {
		await executor.activate(makeModule('agent-a'));
		await executor.activate(makeModule('agent-b'));

		const event: TaskEvent = {
			type: 'task_assigned',
			taskId: 't1',
			task: { assignee: 'u1' },
			timestamp: Date.now(),
			actorId: 'user1',
		};

		await executor.dispatchTaskEvent(event);
		// on_task_event is shared mock, called once per agent
		expect(__mockExports.on_task_event).toHaveBeenCalledTimes(2);
	});

	it('does not dispatch to deactivated agents', async () => {
		const module = makeModule();
		await executor.activate(module);
		await executor.deactivate('room-1:test-agent');

		vi.clearAllMocks();

		const event: TaskEvent = {
			type: 'task_created',
			taskId: 't1',
			task: { title: 'X', status: 'pending', createdBy: 'u', createdAt: 0, updatedAt: 0 },
			timestamp: Date.now(),
			actorId: 'u',
		};

		await executor.dispatchTaskEvent(event);
		expect(__mockExports.on_task_event).not.toHaveBeenCalled();
	});

	it('updates context for all active agents', async () => {
		await executor.activate(makeModule('agent-a'));
		await executor.activate(makeModule('agent-b'));

		const tasks = [{ id: 't1', title: 'Task', status: 'pending' as const, createdBy: 'u', createdAt: 0, updatedAt: 0 }];
		const members = new Map([['k1', { identityKey: 'k1', displayName: 'Alice' }]]);

		executor.updateContext(tasks, members);
		// No direct assertion on context internals, but ensures no throw
	});

	it('shutdown deactivates all agents', async () => {
		await executor.activate(makeModule('agent-a'));
		await executor.activate(makeModule('agent-b'));

		expect(executor.getActiveAgents()).toHaveLength(2);

		await executor.shutdown();

		expect(executor.getActiveAgents()).toHaveLength(0);
		expect(executor.isActive('room-1:agent-a')).toBe(false);
		expect(executor.isActive('room-1:agent-b')).toBe(false);
	});
});
