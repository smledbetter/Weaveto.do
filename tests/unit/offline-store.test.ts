// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  openTaskSnapshotDB,
  openEventQueueDB,
  saveTaskSnapshot,
  loadTaskSnapshot,
  clearTaskSnapshot,
  saveEventQueue,
  loadEventQueue,
  clearEventQueue,
  clearOfflineData,
} from '$lib/tasks/offline';
import { createTaskStore } from '$lib/tasks/store.svelte';
import type { Task, TaskEvent } from '$lib/tasks/types';

// The wrapping key used to come from $lib/identity/store and was mocked here
// to avoid localStorage. Identity seeds are now wrapped by a PIN-derived key
// instead, so this cache owns its own key, and it falls back to a
// session-lifetime key where localStorage is unavailable. That is exactly this
// environment, so no mock is needed and none should be added: a mock here
// would hide whether that fallback works.

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'pending',
    createdBy: 'actor-abc',
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

function makeTaskEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    type: 'task_created',
    taskId: 'task-1',
    timestamp: 1_000_000,
    actorId: 'actor-abc',
    task: { title: 'Test task', status: 'pending', createdBy: 'actor-abc', createdAt: 1_000_000 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. IDB Database Operations
// ---------------------------------------------------------------------------

describe('IDB Database Operations', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  describe('openTaskSnapshotDB', () => {
    it('creates a database named "weave-offline-tasks"', async () => {
      const db = await openTaskSnapshotDB();
      expect(db.name).toBe('weave-offline-tasks');
      db.close();
    });

    it('creates version 1 database', async () => {
      const db = await openTaskSnapshotDB();
      expect(db.version).toBe(1);
      db.close();
    });

    it('creates the "snapshots" object store keyed by roomId', async () => {
      const db = await openTaskSnapshotDB();
      expect(db.objectStoreNames.contains('snapshots')).toBe(true);

      const tx = db.transaction('snapshots', 'readonly');
      const store = tx.objectStore('snapshots');
      expect(store.keyPath).toBe('roomId');

      db.close();
    });

    it('is callable multiple times without throwing', async () => {
      const db1 = await openTaskSnapshotDB();
      db1.close();
      const db2 = await openTaskSnapshotDB();
      expect(db2.name).toBe('weave-offline-tasks');
      db2.close();
    });
  });

  describe('openEventQueueDB', () => {
    it('creates a database named "weave-offline-queue"', async () => {
      const db = await openEventQueueDB();
      expect(db.name).toBe('weave-offline-queue');
      db.close();
    });

    it('creates version 1 database', async () => {
      const db = await openEventQueueDB();
      expect(db.version).toBe(1);
      db.close();
    });

    it('creates the "events" object store keyed by roomId', async () => {
      const db = await openEventQueueDB();
      expect(db.objectStoreNames.contains('events')).toBe(true);

      const tx = db.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      expect(store.keyPath).toBe('roomId');

      db.close();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Task Snapshot CRUD
// ---------------------------------------------------------------------------

describe('Task Snapshot CRUD', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('saveTaskSnapshot + loadTaskSnapshot round-trips task data', async () => {
    const tasks: Task[] = [
      makeTask({ id: 'task-1', title: 'First task' }),
      makeTask({ id: 'task-2', title: 'Second task', status: 'in_progress' }),
    ];

    await saveTaskSnapshot('room-abc', tasks);
    const loaded = await loadTaskSnapshot('room-abc');

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(2);
    expect(loaded![0].id).toBe('task-1');
    expect(loaded![0].title).toBe('First task');
    expect(loaded![1].id).toBe('task-2');
    expect(loaded![1].status).toBe('in_progress');
  });

  it('loadTaskSnapshot returns null for a non-existent roomId', async () => {
    const result = await loadTaskSnapshot('room-does-not-exist');
    expect(result).toBeNull();
  });

  it('clearTaskSnapshot removes the snapshot so subsequent load returns null', async () => {
    const tasks: Task[] = [makeTask()];

    await saveTaskSnapshot('room-del', tasks);
    expect(await loadTaskSnapshot('room-del')).not.toBeNull();

    await clearTaskSnapshot('room-del');
    expect(await loadTaskSnapshot('room-del')).toBeNull();
  });

  it('saveTaskSnapshot overwrites a previous snapshot for the same roomId', async () => {
    const first: Task[] = [makeTask({ id: 'task-1', title: 'Original' })];
    const second: Task[] = [makeTask({ id: 'task-2', title: 'Updated' })];

    await saveTaskSnapshot('room-overwrite', first);
    await saveTaskSnapshot('room-overwrite', second);

    const loaded = await loadTaskSnapshot('room-overwrite');
    expect(loaded).toHaveLength(1);
    expect(loaded![0].title).toBe('Updated');
  });

  it('snapshot data is stored encrypted (raw IDB record has encryptedData, not plaintext)', async () => {
    const tasks: Task[] = [makeTask({ title: 'Secret task' })];
    await saveTaskSnapshot('room-enc', tasks);

    // Read the raw IDB record directly to verify it does not contain plaintext
    const db = await openTaskSnapshotDB();
    const rawRecord = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly');
      const req = tx.objectStore('snapshots').get('room-enc');
      req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
      req.onerror = () => reject(new Error('IDB read failed'));
    });
    db.close();

    expect(rawRecord).not.toBeUndefined();
    // Must have encryptedData and iv fields
    expect(rawRecord!['encryptedData']).toBeInstanceOf(Uint8Array);
    expect(rawRecord!['iv']).toBeInstanceOf(Uint8Array);
    // Must NOT have a plaintext 'tasks' or 'title' field
    expect(rawRecord!['tasks']).toBeUndefined();
    expect(rawRecord!['title']).toBeUndefined();

    // The encrypted bytes should not contain the task title as a UTF-8 substring
    const encBytes = rawRecord!['encryptedData'] as Uint8Array;
    const encStr = new TextDecoder().decode(encBytes);
    expect(encStr).not.toContain('Secret task');
  });

  it('preserves all Task fields through the encrypt/decrypt round-trip', async () => {
    const task: Task = {
      id: 'task-full',
      title: 'Full task',
      status: 'in_progress',
      assignee: 'identity-xyz',
      parentId: 'task-parent',
      createdBy: 'actor-abc',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_001,
      dueAt: 1_700_086_400,
      description: 'Detailed description',
      urgent: true,
    };

    await saveTaskSnapshot('room-full', [task]);
    const loaded = await loadTaskSnapshot('room-full');

    expect(loaded![0]).toMatchObject(task);
  });
});

// ---------------------------------------------------------------------------
// 3. Event Queue CRUD
// ---------------------------------------------------------------------------

describe('Event Queue CRUD', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('saveEventQueue + loadEventQueue round-trips event data', async () => {
    const events: TaskEvent[] = [
      makeTaskEvent({ taskId: 'task-1', type: 'task_created' }),
      makeTaskEvent({ taskId: 'task-2', type: 'task_assigned', actorId: 'actor-xyz' }),
    ];

    await saveEventQueue('room-q', events);
    const loaded = await loadEventQueue('room-q');

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(2);
    expect(loaded![0].taskId).toBe('task-1');
    expect(loaded![0].type).toBe('task_created');
    expect(loaded![1].type).toBe('task_assigned');
    expect(loaded![1].actorId).toBe('actor-xyz');
  });

  it('loadEventQueue returns null for a non-existent roomId', async () => {
    const result = await loadEventQueue('room-never-stored');
    expect(result).toBeNull();
  });

  it('clearEventQueue removes the queue so subsequent load returns null', async () => {
    const events: TaskEvent[] = [makeTaskEvent()];

    await saveEventQueue('room-clr', events);
    expect(await loadEventQueue('room-clr')).not.toBeNull();

    await clearEventQueue('room-clr');
    expect(await loadEventQueue('room-clr')).toBeNull();
  });

  it('clearEventQueue does not throw when queue does not exist', async () => {
    await expect(clearEventQueue('room-phantom')).resolves.not.toThrow();
  });

  it('event queue preserves FIFO order after round-trip', async () => {
    const events: TaskEvent[] = [
      makeTaskEvent({ taskId: 'task-1', timestamp: 1_000 }),
      makeTaskEvent({ taskId: 'task-2', timestamp: 2_000 }),
      makeTaskEvent({ taskId: 'task-3', timestamp: 3_000 }),
    ];

    await saveEventQueue('room-fifo', events);
    const loaded = await loadEventQueue('room-fifo');

    expect(loaded).not.toBeNull();
    expect(loaded!.map((e) => e.taskId)).toEqual(['task-1', 'task-2', 'task-3']);
    expect(loaded!.map((e) => e.timestamp)).toEqual([1_000, 2_000, 3_000]);
  });

  it('saveEventQueue overwrites a previous queue for the same roomId', async () => {
    const first: TaskEvent[] = [makeTaskEvent({ taskId: 'old' })];
    const second: TaskEvent[] = [makeTaskEvent({ taskId: 'new' })];

    await saveEventQueue('room-ow', first);
    await saveEventQueue('room-ow', second);

    const loaded = await loadEventQueue('room-ow');
    expect(loaded).toHaveLength(1);
    expect(loaded![0].taskId).toBe('new');
  });

  it('event queue data is encrypted (raw IDB record has encryptedData field)', async () => {
    const events: TaskEvent[] = [makeTaskEvent({ taskId: 'secret-task' })];
    await saveEventQueue('room-enc-q', events);

    const db = await openEventQueueDB();
    const rawRecord = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const tx = db.transaction('events', 'readonly');
      const req = tx.objectStore('events').get('room-enc-q');
      req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
      req.onerror = () => reject(new Error('IDB read failed'));
    });
    db.close();

    expect(rawRecord).not.toBeUndefined();
    expect(rawRecord!['encryptedData']).toBeInstanceOf(Uint8Array);
    expect(rawRecord!['iv']).toBeInstanceOf(Uint8Array);
    // No plaintext fields
    expect(rawRecord!['events']).toBeUndefined();
    expect(rawRecord!['taskId']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. clearOfflineData
// ---------------------------------------------------------------------------

describe('clearOfflineData', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('clears both snapshot and queue for a roomId', async () => {
    const tasks: Task[] = [makeTask()];
    const events: TaskEvent[] = [makeTaskEvent()];

    await saveTaskSnapshot('room-both', tasks);
    await saveEventQueue('room-both', events);

    expect(await loadTaskSnapshot('room-both')).not.toBeNull();
    expect(await loadEventQueue('room-both')).not.toBeNull();

    await clearOfflineData('room-both');

    expect(await loadTaskSnapshot('room-both')).toBeNull();
    expect(await loadEventQueue('room-both')).toBeNull();
  });

  it('does not affect data for a different roomId', async () => {
    const tasks: Task[] = [makeTask()];
    const events: TaskEvent[] = [makeTaskEvent()];

    await saveTaskSnapshot('room-keep', tasks);
    await saveEventQueue('room-keep', events);
    await saveTaskSnapshot('room-clear', tasks);
    await saveEventQueue('room-clear', events);

    await clearOfflineData('room-clear');

    expect(await loadTaskSnapshot('room-keep')).not.toBeNull();
    expect(await loadEventQueue('room-keep')).not.toBeNull();
  });

  it('does not throw when neither snapshot nor queue exist', async () => {
    await expect(clearOfflineData('room-empty')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. TaskStore Snapshot Methods
// ---------------------------------------------------------------------------

describe('TaskStore snapshot methods', () => {
  describe('getSnapshot()', () => {
    it('returns an empty array when store has no tasks', () => {
      const store = createTaskStore();
      expect(store.getSnapshot()).toEqual([]);
    });

    it('returns plain objects (not Proxy references)', () => {
      const store = createTaskStore();
      store.applyEvent({
        type: 'task_created',
        taskId: 'task-snap',
        timestamp: Date.now(),
        actorId: 'actor-a',
        task: { title: 'Snapshot task', status: 'pending', createdBy: 'actor-a', createdAt: Date.now() },
      });

      const snapshot = store.getSnapshot();
      expect(snapshot).toHaveLength(1);

      // Spread should work on a plain object (would throw on certain non-plain types)
      const copy = { ...snapshot[0] };
      expect(copy.id).toBe('task-snap');
    });

    it('returns a copy — mutating snapshot does not affect store', () => {
      const store = createTaskStore();
      const now = Date.now();
      store.applyEvent({
        type: 'task_created',
        taskId: 'task-mut',
        timestamp: now,
        actorId: 'actor-a',
        task: { title: 'Original', status: 'pending', createdBy: 'actor-a', createdAt: now },
      });

      const snapshot = store.getSnapshot();
      snapshot[0].title = 'Mutated';

      // Store should still have the original title
      expect(store.getTask('task-mut')!.title).toBe('Original');
    });
  });

  describe('loadSnapshot()', () => {
    it('loads tasks from snapshot into an empty store', () => {
      const store = createTaskStore();
      const now = Date.now();
      const tasks: Task[] = [
        makeTask({ id: 'snap-1', title: 'Loaded task A', createdAt: now, updatedAt: now }),
        makeTask({ id: 'snap-2', title: 'Loaded task B', status: 'in_progress', createdAt: now, updatedAt: now }),
      ];

      store.loadSnapshot(tasks);

      expect(store.getTaskCount()).toBe(2);
      expect(store.getTask('snap-1')!.title).toBe('Loaded task A');
      expect(store.getTask('snap-2')!.status).toBe('in_progress');
    });

    it('does NOT overwrite existing tasks (online data wins)', () => {
      const store = createTaskStore();
      const now = Date.now();

      // Apply an online event first
      store.applyEvent({
        type: 'task_created',
        taskId: 'task-online',
        timestamp: now,
        actorId: 'actor-a',
        task: { title: 'Online version', status: 'pending', createdBy: 'actor-a', createdAt: now },
      });

      // Now load a snapshot with the same taskId but different title
      const snapshotTask: Task = makeTask({
        id: 'task-online',
        title: 'Stale offline version',
        createdAt: now,
        updatedAt: now,
      });
      store.loadSnapshot([snapshotTask]);

      // Online version must be preserved
      expect(store.getTask('task-online')!.title).toBe('Online version');
    });

    it('adds snapshot tasks that do not yet exist in store', () => {
      const store = createTaskStore();
      const now = Date.now();

      // One online task
      store.applyEvent({
        type: 'task_created',
        taskId: 'task-live',
        timestamp: now,
        actorId: 'actor-a',
        task: { title: 'Live task', status: 'pending', createdBy: 'actor-a', createdAt: now },
      });

      // Snapshot adds a task not yet received online
      const snapshotTask: Task = makeTask({ id: 'task-offline-only', title: 'Offline task', createdAt: now, updatedAt: now });
      store.loadSnapshot([snapshotTask]);

      // Both tasks present
      expect(store.getTaskCount()).toBe(2);
      expect(store.getTask('task-offline-only')!.title).toBe('Offline task');
    });

    it('loadSnapshot with an empty array does not affect existing tasks', () => {
      const store = createTaskStore();
      const now = Date.now();

      store.applyEvent({
        type: 'task_created',
        taskId: 'task-safe',
        timestamp: now,
        actorId: 'actor-a',
        task: { title: 'Safe', status: 'pending', createdBy: 'actor-a', createdAt: now },
      });

      store.loadSnapshot([]);
      expect(store.getTaskCount()).toBe(1);
    });
  });
});
