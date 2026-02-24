/**
 * Notification Preferences Store - IndexedDB storage layer
 *
 * Stores per-room notification preferences (enabled flag, quiet hours).
 * Uses a SEPARATE database from weave-reminders to avoid coupling.
 *
 * Security: No task content, room names, or user data stored.
 * Only roomId, enabled flag, and time strings (HH:MM).
 */

import type { NotificationPrefs } from './types';

const DB_NAME = 'weave-notification-prefs';
const DB_VERSION = 1;
const STORE_NAME = 'prefs';

/**
 * Open or create the notification preferences database.
 * Object store keyed by roomId.
 */
export async function initNotificationPrefsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'roomId' });
      }
    };
  });
}

/**
 * Persist notification preferences for a room.
 */
export async function saveNotificationPrefs(
  db: IDBDatabase,
  prefs: NotificationPrefs,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(prefs);

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

/**
 * Load notification preferences for a room.
 * Returns null if no record exists.
 */
export async function loadNotificationPrefs(
  db: IDBDatabase,
  roomId: string,
): Promise<NotificationPrefs | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(roomId);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve((request.result as NotificationPrefs) ?? null);
    };
  });
}

/**
 * Remove notification preferences for a room.
 * Called on room leave / cleanup.
 */
export async function clearNotificationPrefs(
  db: IDBDatabase,
  roomId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(roomId);

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

/**
 * Pure function — returns true if the current local time falls within
 * the quiet hours window defined by quietStart..quietEnd (HH:MM strings).
 *
 * Handles overnight ranges where quietStart > quietEnd
 * (e.g. 22:00 to 08:00 spans midnight).
 *
 * Examples:
 *   isQuietHours('22:00', '08:00') at 23:30 → true
 *   isQuietHours('22:00', '08:00') at 07:59 → true
 *   isQuietHours('22:00', '08:00') at 12:00 → false
 *   isQuietHours('09:00', '17:00') at 10:00 → true  (same-day window)
 */
export function isQuietHours(quietStart: string, quietEnd: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) {
    // Degenerate case: quiet hours span a full 24 hours
    return true;
  }

  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 09:00 to 17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight window, e.g. 22:00 to 08:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}
