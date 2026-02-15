/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { initReminderDB, scheduleReminder, cancelReminder, getDueReminders } from '$lib/tasks/sw-reminders';

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files];

interface ScheduleReminderMessage {
  type: 'SCHEDULE_REMINDER';
  taskId: string;
  dueAt: number;
}

interface CancelReminderMessage {
  type: 'CANCEL_REMINDER';
  taskId: string;
}

type ReminderMessage = ScheduleReminderMessage | CancelReminderMessage;

let reminderDb: IDBDatabase | null = null;
let reminderCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the reminders database on service worker startup.
 */
async function initReminders() {
  try {
    reminderDb = await initReminderDB();
  } catch (err) {
    console.error('Failed to initialize reminder DB:', err);
  }
}

/**
 * Check for due reminders and fire notifications.
 */
async function checkAndFireReminders() {
  if (!reminderDb) return;

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
  } catch (err) {
    console.error('Error checking reminders:', err);
  }
}

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
 * Message: handle SCHEDULE_REMINDER and CANCEL_REMINDER from tabs
 */
self.addEventListener('message', async (event) => {
  const message = event.data as ReminderMessage;

  if (!reminderDb) {
    console.warn('Reminder DB not initialized');
    return;
  }

  try {
    if (message.type === 'SCHEDULE_REMINDER') {
      await scheduleReminder(reminderDb, message.taskId, message.dueAt);
    } else if (message.type === 'CANCEL_REMINDER') {
      await cancelReminder(reminderDb, message.taskId);
    }
  } catch (err) {
    console.error('Error handling reminder message:', err);
  }
});

/**
 * Start up: initialize DB and begin polling for reminders
 */
self.addEventListener('activate', () => {
  initReminders().then(() => {
    // Start polling for due reminders every 30 seconds
    if (!reminderCheckInterval) {
      reminderCheckInterval = setInterval(() => {
        checkAndFireReminders();
      }, 30_000);
    }
  });
});
