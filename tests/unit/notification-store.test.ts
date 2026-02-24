// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  initNotificationPrefsDB,
  saveNotificationPrefs,
  loadNotificationPrefs,
  clearNotificationPrefs,
  isQuietHours,
} from '$lib/notifications/store';
import type { NotificationPrefs } from '$lib/notifications/types';

describe('Notification Preferences Store', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  describe('initNotificationPrefsDB', () => {
    it('opens the database successfully and creates the prefs object store', async () => {
      const db = await initNotificationPrefsDB();

      expect(db).toBeDefined();
      expect(typeof db.transaction).toBe('function');
      expect(db.name).toBe('weave-notification-prefs');
      expect(db.version).toBe(1);
      expect(db.objectStoreNames.contains('prefs')).toBe(true);

      const tx = db.transaction('prefs', 'readonly');
      const store = tx.objectStore('prefs');
      expect(store.keyPath).toBe('roomId');

      db.close();
    });

    it('resolves with an IDBDatabase instance', async () => {
      const db = await initNotificationPrefsDB();

      expect(db).toBeInstanceOf(IDBDatabase);
      db.close();
    });
  });

  describe('saveNotificationPrefs + loadNotificationPrefs', () => {
    it('round-trips preferences save and load successfully', async () => {
      const db = await initNotificationPrefsDB();
      const prefs: NotificationPrefs = {
        roomId: 'room-roundtrip',
        enabled: true,
        quietStart: '22:00',
        quietEnd: '08:00',
      };

      await saveNotificationPrefs(db, prefs);
      const loaded = await loadNotificationPrefs(db, 'room-roundtrip');

      expect(loaded).not.toBeNull();
      expect(loaded!.roomId).toBe('room-roundtrip');
      expect(loaded!.enabled).toBe(true);
      expect(loaded!.quietStart).toBe('22:00');
      expect(loaded!.quietEnd).toBe('08:00');

      db.close();
    });

    it('returns null for a nonexistent room', async () => {
      const db = await initNotificationPrefsDB();

      const loaded = await loadNotificationPrefs(db, 'room-nonexistent');

      expect(loaded).toBeNull();
      db.close();
    });

    it('upserts — saving again overwrites the existing record', async () => {
      const db = await initNotificationPrefsDB();
      const roomId = 'room-upsert';

      const original: NotificationPrefs = {
        roomId,
        enabled: true,
        quietStart: '22:00',
        quietEnd: '08:00',
      };
      await saveNotificationPrefs(db, original);

      const updated: NotificationPrefs = {
        roomId,
        enabled: false,
        quietStart: '23:00',
        quietEnd: '07:00',
      };
      await saveNotificationPrefs(db, updated);

      const loaded = await loadNotificationPrefs(db, roomId);

      expect(loaded).not.toBeNull();
      expect(loaded!.enabled).toBe(false);
      expect(loaded!.quietStart).toBe('23:00');
      expect(loaded!.quietEnd).toBe('07:00');

      db.close();
    });
  });

  describe('clearNotificationPrefs', () => {
    it('removes a record so subsequent load returns null', async () => {
      const db = await initNotificationPrefsDB();
      const prefs: NotificationPrefs = {
        roomId: 'room-to-clear',
        enabled: true,
        quietStart: '22:00',
        quietEnd: '08:00',
      };

      await saveNotificationPrefs(db, prefs);
      expect(await loadNotificationPrefs(db, 'room-to-clear')).not.toBeNull();

      await clearNotificationPrefs(db, 'room-to-clear');

      expect(await loadNotificationPrefs(db, 'room-to-clear')).toBeNull();
      db.close();
    });

    it('does not throw when the room record does not exist', async () => {
      const db = await initNotificationPrefsDB();

      await expect(
        clearNotificationPrefs(db, 'room-never-existed'),
      ).resolves.not.toThrow();

      db.close();
    });
  });
});

describe('isQuietHours', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('overnight range (22:00 to 08:00)', () => {
    it('returns true at 23:30 (inside overnight window)', () => {
      vi.setSystemTime(new Date('2026-02-24T23:30:00'));
      expect(isQuietHours('22:00', '08:00')).toBe(true);
    });

    it('returns true at 07:59 (just before end of overnight window)', () => {
      vi.setSystemTime(new Date('2026-02-24T07:59:00'));
      expect(isQuietHours('22:00', '08:00')).toBe(true);
    });

    it('returns false at 08:00 (exactly at end of quiet window)', () => {
      vi.setSystemTime(new Date('2026-02-24T08:00:00'));
      expect(isQuietHours('22:00', '08:00')).toBe(false);
    });

    it('returns false at 12:00 (middle of the day, outside window)', () => {
      vi.setSystemTime(new Date('2026-02-24T12:00:00'));
      expect(isQuietHours('22:00', '08:00')).toBe(false);
    });

    it('returns false at 21:59 (one minute before quiet start)', () => {
      vi.setSystemTime(new Date('2026-02-24T21:59:00'));
      expect(isQuietHours('22:00', '08:00')).toBe(false);
    });

    it('returns true at 22:00 (exactly at quiet start)', () => {
      vi.setSystemTime(new Date('2026-02-24T22:00:00'));
      expect(isQuietHours('22:00', '08:00')).toBe(true);
    });
  });

  describe('same-day range (09:00 to 17:00)', () => {
    it('returns true at 10:00 (inside same-day window)', () => {
      vi.setSystemTime(new Date('2026-02-24T10:00:00'));
      expect(isQuietHours('09:00', '17:00')).toBe(true);
    });

    it('returns false at 08:59 (one minute before same-day window starts)', () => {
      vi.setSystemTime(new Date('2026-02-24T08:59:00'));
      expect(isQuietHours('09:00', '17:00')).toBe(false);
    });

    it('returns false at 17:00 (exactly at end of same-day window)', () => {
      vi.setSystemTime(new Date('2026-02-24T17:00:00'));
      expect(isQuietHours('09:00', '17:00')).toBe(false);
    });
  });

  describe('degenerate case (same start and end time)', () => {
    it('returns true when start equals end (full 24-hour quiet period)', () => {
      vi.setSystemTime(new Date('2026-02-24T12:00:00'));
      expect(isQuietHours('12:00', '12:00')).toBe(true);
    });

    it('returns true at any time when start and end are the same', () => {
      vi.setSystemTime(new Date('2026-02-24T03:00:00'));
      expect(isQuietHours('09:00', '09:00')).toBe(true);
    });
  });
});
