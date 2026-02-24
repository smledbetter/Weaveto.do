// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  initPushDB,
  storePushSubscription,
  loadPushSubscription,
  clearPushSubscription,
} from '$lib/notifications/push';

// Helper: build a minimal PushSubscription mock whose toJSON() returns the
// provided endpoint and keys.  We only need what storePushSubscription reads.
function makeMockSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
): PushSubscription {
  return {
    toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
  } as unknown as PushSubscription;
}

describe('Push Subscription Store', () => {
  // Reset the fake IndexedDB instance before every test so each test gets a
  // clean database, exactly as notification-store.test.ts does.
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  // -------------------------------------------------------------------------
  // initPushDB
  // -------------------------------------------------------------------------

  describe('initPushDB', () => {
    it('resolves with an IDBDatabase instance', async () => {
      const db = await initPushDB();
      expect(db).toBeInstanceOf(IDBDatabase);
      db.close();
    });

    it('creates a database named "weave-push-subscriptions"', async () => {
      const db = await initPushDB();
      expect(db.name).toBe('weave-push-subscriptions');
      db.close();
    });

    it('creates version 1 database', async () => {
      const db = await initPushDB();
      expect(db.version).toBe(1);
      db.close();
    });

    it('creates the "subscriptions" object store keyed by roomId', async () => {
      const db = await initPushDB();
      expect(db.objectStoreNames.contains('subscriptions')).toBe(true);

      const tx = db.transaction('subscriptions', 'readonly');
      const store = tx.objectStore('subscriptions');
      expect(store.keyPath).toBe('roomId');

      db.close();
    });

    it('is callable multiple times without throwing', async () => {
      const db1 = await initPushDB();
      db1.close();
      const db2 = await initPushDB();
      expect(db2.name).toBe('weave-push-subscriptions');
      db2.close();
    });
  });

  // -------------------------------------------------------------------------
  // storePushSubscription + loadPushSubscription (round-trip)
  // -------------------------------------------------------------------------

  describe('storePushSubscription + loadPushSubscription', () => {
    it('stores and loads a subscription round-trip', async () => {
      const db = await initPushDB();
      const sub = makeMockSubscription('https://fcm.googleapis.com/test', 'p256dh-key', 'auth-key');

      await storePushSubscription(db, 'room1', sub);
      const loaded = await loadPushSubscription(db, 'room1');

      expect(loaded).not.toBeNull();
      expect(loaded!.roomId).toBe('room1');
      expect(loaded!.endpoint).toBe('https://fcm.googleapis.com/test');
      expect(loaded!.p256dh).toBe('p256dh-key');
      expect(loaded!.auth).toBe('auth-key');

      db.close();
    });

    it('stores all four fields as defined by StoredPushSubscription', async () => {
      const db = await initPushDB();
      const sub = makeMockSubscription('https://push.example.com/endpoint', 'pk', 'ak');

      await storePushSubscription(db, 'roomABC', sub);
      const loaded = await loadPushSubscription(db, 'roomABC');

      // Must have exactly the four expected keys (no extras from source mock)
      expect(Object.keys(loaded!).sort()).toEqual(['auth', 'endpoint', 'p256dh', 'roomId'].sort());

      db.close();
    });

    it('returns null for a room with no stored subscription', async () => {
      const db = await initPushDB();

      const loaded = await loadPushSubscription(db, 'nonexistent-room');

      expect(loaded).toBeNull();
      db.close();
    });

    it('stores subscriptions for multiple rooms independently', async () => {
      const db = await initPushDB();

      await storePushSubscription(db, 'room-a', makeMockSubscription('https://ep-a', 'ka', 'aa'));
      await storePushSubscription(db, 'room-b', makeMockSubscription('https://ep-b', 'kb', 'ab'));

      const a = await loadPushSubscription(db, 'room-a');
      const b = await loadPushSubscription(db, 'room-b');

      expect(a!.endpoint).toBe('https://ep-a');
      expect(b!.endpoint).toBe('https://ep-b');

      db.close();
    });

    it('overwrites an existing subscription for the same room', async () => {
      const db = await initPushDB();

      await storePushSubscription(
        db,
        'room1',
        makeMockSubscription('https://endpoint1', 'k1', 'a1'),
      );
      await storePushSubscription(
        db,
        'room1',
        makeMockSubscription('https://endpoint2', 'k2', 'a2'),
      );

      const loaded = await loadPushSubscription(db, 'room1');

      expect(loaded!.endpoint).toBe('https://endpoint2');
      expect(loaded!.p256dh).toBe('k2');
      expect(loaded!.auth).toBe('a2');

      db.close();
    });
  });

  // -------------------------------------------------------------------------
  // clearPushSubscription
  // -------------------------------------------------------------------------

  describe('clearPushSubscription', () => {
    it('removes the record so subsequent load returns null', async () => {
      const db = await initPushDB();
      const sub = makeMockSubscription('https://endpoint', 'k', 'a');

      await storePushSubscription(db, 'room1', sub);
      expect(await loadPushSubscription(db, 'room1')).not.toBeNull();

      await clearPushSubscription(db, 'room1');

      expect(await loadPushSubscription(db, 'room1')).toBeNull();

      db.close();
    });

    it('does not throw when clearing a room that has no subscription', async () => {
      const db = await initPushDB();

      await expect(clearPushSubscription(db, 'room-never-stored')).resolves.not.toThrow();

      db.close();
    });

    it('only clears the target room, leaving others intact', async () => {
      const db = await initPushDB();

      await storePushSubscription(db, 'keep', makeMockSubscription('https://keep', 'k1', 'a1'));
      await storePushSubscription(db, 'remove', makeMockSubscription('https://remove', 'k2', 'a2'));

      await clearPushSubscription(db, 'remove');

      expect(await loadPushSubscription(db, 'keep')).not.toBeNull();
      expect(await loadPushSubscription(db, 'remove')).toBeNull();

      db.close();
    });

    it('can store a new subscription for a cleared room', async () => {
      const db = await initPushDB();

      await storePushSubscription(db, 'room1', makeMockSubscription('https://old', 'k1', 'a1'));
      await clearPushSubscription(db, 'room1');
      await storePushSubscription(db, 'room1', makeMockSubscription('https://new', 'k2', 'a2'));

      const loaded = await loadPushSubscription(db, 'room1');

      expect(loaded).not.toBeNull();
      expect(loaded!.endpoint).toBe('https://new');

      db.close();
    });
  });
});
