/**
 * Service Worker Reminders - IndexedDB storage layer
 *
 * Stores reminder metadata for persistent cross-tab reminders.
 * Security: Only stores taskId, dueAt, fireAt, and fired flag.
 * NO plaintext task content is stored (this is an E2EE app).
 */

const DB_NAME = 'weave-reminders';
const DB_VERSION = 1;
const STORE_NAME = 'reminders';

export interface ReminderRecord {
  taskId: string;
  dueAt: number;
  fireAt: number; // dueAt - 5 minutes
  fired: boolean;
}

/**
 * Initialize or open the reminders database.
 * Creates the object store if it doesn't exist.
 */
export async function initReminderDB(): Promise<IDBDatabase> {
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
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'taskId' });
        store.createIndex('fireAt', 'fireAt', { unique: false });
      }
    };
  });
}

/**
 * Schedule a reminder for a task.
 * Stores the reminder record with fireAt = dueAt - 5 minutes.
 */
export async function scheduleReminder(
  db: IDBDatabase,
  taskId: string,
  dueAt: number,
): Promise<void> {
  const fireAt = dueAt - 5 * 60_000; // 5 minutes before

  // Don't schedule if already past due
  if (fireAt < Date.now()) {
    return;
  }

  const record: ReminderRecord = {
    taskId,
    dueAt,
    fireAt,
    fired: false,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

/**
 * Cancel a scheduled reminder.
 * Deletes the reminder record.
 */
export async function cancelReminder(
  db: IDBDatabase,
  taskId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(taskId);

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

/**
 * Get all reminders that are due to fire.
 * Returns records where fireAt <= now and not yet fired.
 */
export async function getDueReminders(
  db: IDBDatabase,
  now: number,
): Promise<ReminderRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('fireAt');
    const range = IDBKeyRange.upperBound(now);
    const request = index.getAll(range);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      const records = request.result as ReminderRecord[];
      // Filter for unfired reminders
      resolve(records.filter((r) => !r.fired));
    };
  });
}
