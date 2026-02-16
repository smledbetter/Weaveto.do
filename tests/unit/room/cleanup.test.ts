import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanupRoom } from '$lib/room/cleanup';
import { autoDeleteKey } from '$lib/room/types';

// Mock RoomSession
function mockSession() {
  return {
    disconnect: vi.fn(),
  } as any;
}

// Mock IndexedDB
function setupIndexedDBMock() {
  const deletedKeys: string[] = [];
  const clearedStores: string[] = [];

  const mockCursor = (key: string, roomId: string) => {
    let called = false;
    return {
      get result() {
        if (!called && key.startsWith(`${roomId}:`)) {
          called = true;
          return {
            key,
            delete: () => { deletedKeys.push(key); },
            continue: vi.fn(),
          };
        }
        return null;
      },
      set onsuccess(fn: () => void) { fn(); },
      set onerror(_fn: () => void) {},
    };
  };

  const mockStore = (name: string) => ({
    index: () => ({
      openCursor: () => {
        const req = {
          get result() { return null; },
          set onsuccess(fn: () => void) { fn(); },
          set onerror(_fn: () => void) {},
        };
        return req;
      },
    }),
    openCursor: () => mockCursor('test-room:state1', 'test-room'),
    clear: () => { clearedStores.push(name); },
  });

  const mockDB = {
    transaction: (_stores: string[], _mode: string) => ({
      objectStore: (name: string) => mockStore(name),
      set oncomplete(fn: () => void) { fn(); },
      set onerror(_fn: () => void) {},
    }),
    close: vi.fn(),
  };

  const openRequest = {
    set onsuccess(fn: () => void) { fn(); },
    set onerror(_fn: () => void) {},
    result: mockDB,
  };

  vi.stubGlobal('indexedDB', {
    open: () => openRequest,
  });

  return { deletedKeys, clearedStores, mockDB };
}

describe('cleanupRoom', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Set up sessionStorage with keys to clear
    sessionStorage.setItem('weave-olm-pickle', 'test-pickle');
    sessionStorage.setItem('weave-key-warning-shown', 'true');
    sessionStorage.setItem('weave-task-panel-open', 'true');
    sessionStorage.setItem(autoDeleteKey('test-room'), JSON.stringify({ expiresAt: 999, cancelled: false }));

    // Mock navigator.serviceWorker
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: {
        controller: {
          postMessage: vi.fn(),
        },
      },
    });
  });

  it('disconnects the session', async () => {
    setupIndexedDBMock();
    const session = mockSession();
    await cleanupRoom('test-room', session);
    expect(session.disconnect).toHaveBeenCalledOnce();
  });

  it('handles null session gracefully', async () => {
    setupIndexedDBMock();
    await expect(cleanupRoom('test-room', null)).resolves.toBeUndefined();
  });

  it('clears sessionStorage keys', async () => {
    setupIndexedDBMock();
    await cleanupRoom('test-room', mockSession());

    expect(sessionStorage.getItem('weave-olm-pickle')).toBeNull();
    expect(sessionStorage.getItem('weave-key-warning-shown')).toBeNull();
    expect(sessionStorage.getItem('weave-task-panel-open')).toBeNull();
    expect(sessionStorage.getItem(autoDeleteKey('test-room'))).toBeNull();
  });

  it('posts clear-room-reminders message to service worker', async () => {
    setupIndexedDBMock();
    await cleanupRoom('test-room', mockSession());

    expect(navigator.serviceWorker.controller!.postMessage).toHaveBeenCalledWith({
      type: 'clear-room-reminders',
      roomId: 'test-room',
    });
  });

  it('handles missing service worker gracefully', async () => {
    setupIndexedDBMock();
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: undefined,
    });

    await expect(cleanupRoom('test-room', mockSession())).resolves.toBeUndefined();
  });

  it('handles IndexedDB errors gracefully', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('IndexedDB not available');
      },
    });

    // Should not throw even if IndexedDB fails
    await expect(cleanupRoom('test-room', mockSession())).resolves.toBeUndefined();
  });
});

describe('autoDeleteKey', () => {
  it('generates correct key format', () => {
    expect(autoDeleteKey('abc123')).toBe('weave-auto-delete:abc123');
  });
});
