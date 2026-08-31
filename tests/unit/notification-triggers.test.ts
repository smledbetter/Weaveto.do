import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldNotifyForEvent,
  getNotificationPayload,
  postNotifyToSW,
  postPrefsToSW,
} from '$lib/notifications/triggers';
import type { TaskEvent, Task } from '$lib/tasks/types';

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const MY_KEY = 'my-identity-key-abc123';
const OTHER_KEY = 'other-identity-key-xyz789';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'pending',
    createdBy: OTHER_KEY,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    type: 'task_assigned',
    taskId: 'task-1',
    timestamp: 1000,
    actorId: OTHER_KEY,
    ...overrides,
  };
}

// ─── shouldNotifyForEvent ──────────────────────────────────────────────────────

describe('shouldNotifyForEvent', () => {
  beforeEach(() => {
    // Default: tab is hidden (not focused)
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore to visible after each test
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  it('returns false when actorId === myIdentityKey (own action)', () => {
    const event = makeEvent({ actorId: MY_KEY });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(false);
  });

  it('returns false when notificationsEnabled is false', () => {
    const event = makeEvent({ actorId: OTHER_KEY });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], false, false)).toBe(false);
  });

  it('returns false when isEphemeral is true', () => {
    const event = makeEvent({ actorId: OTHER_KEY });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, true)).toBe(false);
  });

  it('returns false when document.visibilityState is visible (tab focused)', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_assigned' });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(false);
  });

  it('returns true for task_assigned when task.assignee === myIdentityKey (tab hidden)', () => {
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_assigned' });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(true);
  });

  it('returns false for task_assigned when task.assignee !== myIdentityKey', () => {
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_assigned' });
    const task = makeTask({ assignee: OTHER_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(false);
  });

  it('returns true for task_status_changed when task.assignee === myIdentityKey (tab hidden)', () => {
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_status_changed' });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(true);
  });

  it('returns false for task_status_changed when task.assignee !== myIdentityKey', () => {
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_status_changed' });
    const task = makeTask({ assignee: OTHER_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(false);
  });

  it('returns false for task_created (not a notification trigger)', () => {
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_created' });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(false);
  });

  it('returns false for task_updated (not a notification trigger)', () => {
    const event = makeEvent({ actorId: OTHER_KEY, type: 'task_updated' });
    const task = makeTask({ assignee: MY_KEY });
    expect(shouldNotifyForEvent(event, MY_KEY, [task], true, false)).toBe(false);
  });
});

// ─── getNotificationPayload ────────────────────────────────────────────────────

describe('getNotificationPayload', () => {
  it('returns the generic title "Weave"', () => {
    const event = makeEvent({ type: 'task_assigned', taskId: 'task-99' });
    const payload = getNotificationPayload(event);
    expect(payload.title).toBe('Weave');
  });

  it('body never contains event-specific data (generic message only)', () => {
    const event = makeEvent({
      type: 'task_assigned',
      taskId: 'task-secret',
      task: { title: 'Super secret task name' },
    });
    const payload = getNotificationPayload(event);
    expect(payload.body).not.toContain('task_assigned');
    expect(payload.body).not.toContain('task-secret');
    expect(payload.body).not.toContain('Super secret task name');
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('tag includes the event type and taskId', () => {
    const event = makeEvent({ type: 'task_assigned', taskId: 'task-42' });
    const payload = getNotificationPayload(event);
    expect(payload.tag).toContain('task_assigned');
    expect(payload.tag).toContain('task-42');
  });

  it('tag includes type and taskId for task_status_changed', () => {
    const event = makeEvent({ type: 'task_status_changed', taskId: 'task-77' });
    const payload = getNotificationPayload(event);
    expect(payload.tag).toContain('task_status_changed');
    expect(payload.tag).toContain('task-77');
  });
});

// ─── postNotifyToSW ────────────────────────────────────────────────────────────

describe('postNotifyToSW', () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: { postMessage: mockPostMessage } },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts a NOTIFY message to navigator.serviceWorker.controller', () => {
    const payload = { title: 'Weave', body: 'You have a notification', tag: 'weave-task_assigned-task-1' };
    postNotifyToSW(payload, 'room-abc');

    expect(mockPostMessage).toHaveBeenCalledOnce();
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'NOTIFY',
      title: 'Weave',
      body: 'You have a notification',
      tag: 'weave-task_assigned-task-1',
      roomId: 'room-abc',
    });
  });

  it('does not throw when navigator.serviceWorker is not present', () => {
    // Remove the property entirely so 'serviceWorker' in navigator is false
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    // @ts-expect-error — intentionally removing serviceWorker for test
    delete (navigator as Record<string, unknown>).serviceWorker;

    const payload = { title: 'Weave', body: 'Test', tag: 'weave-test-1' };
    expect(() => postNotifyToSW(payload, 'room-abc')).not.toThrow();

    // Restore
    if (descriptor) {
      Object.defineProperty(navigator, 'serviceWorker', descriptor);
    } else {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: { postMessage: mockPostMessage } },
        configurable: true,
        writable: true,
      });
    }
  });

  it('does not throw when serviceWorker.controller is null', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: null },
      configurable: true,
      writable: true,
    });

    const payload = { title: 'Weave', body: 'Test', tag: 'weave-test-2' };
    expect(() => postNotifyToSW(payload, 'room-abc')).not.toThrow();
  });

  it('does not post when controller is null', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: null },
      configurable: true,
      writable: true,
    });

    const payload = { title: 'Weave', body: 'Test', tag: 'weave-test-3' };
    postNotifyToSW(payload, 'room-abc');

    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});

// ─── postPrefsToSW ─────────────────────────────────────────────────────────────

describe('postPrefsToSW', () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: { postMessage: mockPostMessage } },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts an UPDATE_NOTIFICATION_PREFS message to the SW controller', () => {
    const prefs = {
      roomId: 'room-abc',
      enabled: true,
      quietStart: '22:00',
      quietEnd: '08:00',
    };

    postPrefsToSW(prefs);

    expect(mockPostMessage).toHaveBeenCalledOnce();
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'UPDATE_NOTIFICATION_PREFS',
      prefs,
    });
  });

  it('posts the full prefs object including all fields', () => {
    const prefs = {
      roomId: 'room-xyz',
      enabled: false,
      quietStart: '09:00',
      quietEnd: '17:00',
    };

    postPrefsToSW(prefs);

    const call = mockPostMessage.mock.calls[0][0];
    expect(call.prefs.roomId).toBe('room-xyz');
    expect(call.prefs.enabled).toBe(false);
    expect(call.prefs.quietStart).toBe('09:00');
    expect(call.prefs.quietEnd).toBe('17:00');
  });

  it('does not throw when navigator.serviceWorker is not present', () => {
    // Remove the property entirely so 'serviceWorker' in navigator is false
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    // @ts-expect-error — intentionally removing serviceWorker for test
    delete (navigator as Record<string, unknown>).serviceWorker;

    const prefs = { roomId: 'room-abc', enabled: true, quietStart: '22:00', quietEnd: '08:00' };
    expect(() => postPrefsToSW(prefs)).not.toThrow();

    // Restore
    if (descriptor) {
      Object.defineProperty(navigator, 'serviceWorker', descriptor);
    } else {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: { postMessage: mockPostMessage } },
        configurable: true,
        writable: true,
      });
    }
  });
});
