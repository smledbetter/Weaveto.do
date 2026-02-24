/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { initReminderDB, scheduleReminder, cancelReminder, getDueReminders } from '$lib/tasks/sw-reminders';

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files];

// ---------------------------------------------------------------------------
// Message type definitions
// ---------------------------------------------------------------------------

interface ScheduleReminderMessage {
  type: 'SCHEDULE_REMINDER';
  taskId: string;
  dueAt: number;
}

interface CancelReminderMessage {
  type: 'CANCEL_REMINDER';
  taskId: string;
}

interface NotifyMessage {
  type: 'NOTIFY';
  title: string;
  body: string;
  tag: string;
  roomId: string;
}

interface UpdatePrefsMessage {
  type: 'UPDATE_NOTIFICATION_PREFS';
  prefs: NotificationPrefsRecord;
}

type SWMessage =
  | ScheduleReminderMessage
  | CancelReminderMessage
  | NotifyMessage
  | UpdatePrefsMessage;

// ---------------------------------------------------------------------------
// Notification prefs — inlined IDB helpers (SW cannot use $lib aliases)
// ---------------------------------------------------------------------------

interface NotificationPrefsRecord {
  roomId: string;
  enabled: boolean;
  quietStart: string; // "HH:MM"
  quietEnd: string;   // "HH:MM"
}

const NOTIF_PREFS_DB_NAME = 'weave-notification-prefs';
const NOTIF_PREFS_DB_VERSION = 1;
const NOTIF_PREFS_STORE = 'prefs';

/**
 * Open (or create) the notification-prefs IndexedDB.
 * Mirrors initNotificationPrefsDB() from src/lib/notifications/store.ts
 * but inlined because the SW bundle cannot resolve $lib imports.
 */
function openNotificationPrefsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTIF_PREFS_DB_NAME, NOTIF_PREFS_DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(NOTIF_PREFS_STORE)) {
        db.createObjectStore(NOTIF_PREFS_STORE, { keyPath: 'roomId' });
      }
    };
  });
}

/**
 * Persist a prefs record into the SW-side copy of the prefs DB.
 */
function swSaveNotificationPrefs(
  db: IDBDatabase,
  prefs: NotificationPrefsRecord,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([NOTIF_PREFS_STORE], 'readwrite');
    const store = tx.objectStore(NOTIF_PREFS_STORE);
    store.put(prefs);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve all prefs records from the SW-side IDB.
 */
function swGetAllNotificationPrefs(
  db: IDBDatabase,
): Promise<NotificationPrefsRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([NOTIF_PREFS_STORE], 'readonly');
    const store = tx.objectStore(NOTIF_PREFS_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as NotificationPrefsRecord[]) ?? []);
  });
}

/**
 * Retrieve prefs for a specific room.
 */
function swGetNotificationPrefs(
  db: IDBDatabase,
  roomId: string,
): Promise<NotificationPrefsRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([NOTIF_PREFS_STORE], 'readonly');
    const store = tx.objectStore(NOTIF_PREFS_STORE);
    const request = store.get(roomId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as NotificationPrefsRecord) ?? null);
  });
}

/**
 * Pure quiet-hours check — no IDB, no side effects.
 * Returns true if the current local time falls within [quietStart, quietEnd).
 * Handles overnight ranges (e.g. 22:00 to 08:00).
 */
function isQuietHoursNow(quietStart: string, quietEnd: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) {
    return true; // full 24-hour quiet window
  }

  if (startMinutes < endMinutes) {
    // Same-day window e.g. 09:00–17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight window e.g. 22:00–08:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Returns true if notifications should be suppressed right now.
 *
 * For timer-based reminders (no specific roomId): suppress if ALL enabled
 * rooms are in quiet hours, or if no rooms have notifications enabled.
 * We use the most conservative rule: suppress if any enabled room is in
 * quiet hours, because we cannot match reminders to rooms.
 *
 * Returns false (allow) when no prefs are recorded — opt-in quiet hours.
 */
async function shouldSuppressGlobally(): Promise<boolean> {
  if (!notificationPrefsDb) return false;

  try {
    const allPrefs = await swGetAllNotificationPrefs(notificationPrefsDb);
    const enabled = allPrefs.filter((p) => p.enabled);

    if (enabled.length === 0) return false;

    // Suppress if any enabled room is currently in its quiet window
    return enabled.some((p) => isQuietHoursNow(p.quietStart, p.quietEnd));
  } catch {
    return false; // fail open — don't suppress on IDB error
  }
}

/**
 * Returns true if notifications should be suppressed for a specific room.
 */
async function shouldSuppressForRoom(roomId: string): Promise<boolean> {
  if (!notificationPrefsDb) return false;

  try {
    const prefs = await swGetNotificationPrefs(notificationPrefsDb, roomId);
    if (!prefs) return false;
    if (!prefs.enabled) return true; // explicitly disabled
    return isQuietHoursNow(prefs.quietStart, prefs.quietEnd);
  } catch {
    return false; // fail open
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let reminderDb: IDBDatabase | null = null;
let notificationPrefsDb: IDBDatabase | null = null;
let reminderCheckInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * Initialize the reminders database on service worker startup.
 */
async function initReminders() {
  try {
    reminderDb = await initReminderDB();
  } catch {
    // Silent failure — reminder DB unavailable
  }
}

/**
 * Initialize the notification-prefs database on service worker startup.
 */
async function initNotificationPrefs() {
  try {
    notificationPrefsDb = await openNotificationPrefsDB();
  } catch {
    // Silent failure — prefs DB unavailable
  }
}

/**
 * Check for due reminders and fire notifications, respecting quiet hours.
 */
async function checkAndFireReminders() {
  if (!reminderDb) return;

  // Suppress all timer-based reminders if quiet hours are active
  if (await shouldSuppressGlobally()) return;

  try {
    const now = Date.now();
    const dueReminders = await getDueReminders(reminderDb, now);

    for (const reminder of dueReminders) {
      // Fire notification with generic body (no plaintext task content)
      await self.registration.showNotification('Task Reminder', {
        body: 'A task is due soon — open Weave to view details',
        badge: '/favicon.png',
        tag: `reminder-${reminder.taskId}`,
      });

      // Mark as fired
      reminder.fired = true;
      const tx = reminderDb.transaction(['reminders'], 'readwrite');
      const store = tx.objectStore('reminders');
      store.put(reminder);

      // Broadcast to all tabs
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({
          type: 'REMINDER_FIRED',
          taskId: reminder.taskId,
        });
      }
    }
  } catch {
    // Silent failure — reminder check error
  }
}

// ---------------------------------------------------------------------------
// Service worker lifecycle
// ---------------------------------------------------------------------------

/**
 * Install: cache static assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll(ASSETS);
    }),
  );
  self.skipWaiting();
});

/**
 * Activate: clean up old caches
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE) {
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

/**
 * Fetch: serve from cache, fallback to network
 */
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }),
  );
});

/**
 * Message: handle reminder and notification preference messages from tabs
 */
self.addEventListener('message', async (event) => {
  const message = event.data as SWMessage;

  try {
    if (message.type === 'SCHEDULE_REMINDER') {
      if (!reminderDb) return;
      await scheduleReminder(reminderDb, message.taskId, message.dueAt);
    } else if (message.type === 'CANCEL_REMINDER') {
      if (!reminderDb) return;
      await cancelReminder(reminderDb, message.taskId);
    } else if (message.type === 'NOTIFY') {
      // Direct notification request from a tab — check prefs before showing
      const suppress = await shouldSuppressForRoom(message.roomId);
      if (!suppress) {
        await self.registration.showNotification(message.title, {
          // Use provided title but always use a generic body (no task content)
          body: 'You have a new notification — open Weave to view details',
          badge: '/favicon.png',
          tag: message.tag,
        });
      }
    } else if (message.type === 'UPDATE_NOTIFICATION_PREFS') {
      // Keep SW-side prefs in sync so quiet-hours checks work without round-trips
      if (!notificationPrefsDb) return;
      await swSaveNotificationPrefs(notificationPrefsDb, message.prefs);
    }
  } catch {
    // Silent failure — message handling error
  }
});

/**
 * Start up: initialize DBs and begin polling for due reminders
 */
self.addEventListener('activate', () => {
  Promise.all([initReminders(), initNotificationPrefs()]).then(() => {
    // Start polling for due reminders every 30 seconds
    if (!reminderCheckInterval) {
      reminderCheckInterval = setInterval(() => {
        checkAndFireReminders();
      }, 30_000);
    }
  });
});
