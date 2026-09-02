/**
 * Encrypted offline storage for task snapshots and pending event queues.
 * Tasks and events are AES-GCM-256 encrypted under a key derived via HKDF-SHA256
 * from the device key, then stored in IndexedDB.
 *
 * Security note: The device key is stored in localStorage as base64 (same as
 * identity/store.ts). This protects against IDB exfiltration in isolation but
 * NOT against XSS or malicious same-origin scripts. Treat as defence-in-depth.
 */

import type { Task, TaskEvent } from "./types";

// --- Database constants ---

const TASK_SNAPSHOT_DB_NAME = "weave-offline-tasks";
const TASK_SNAPSHOT_DB_VERSION = 1;
const TASK_SNAPSHOT_STORE = "snapshots";

const EVENT_QUEUE_DB_NAME = "weave-offline-queue";
const EVENT_QUEUE_DB_VERSION = 1;
const EVENT_QUEUE_STORE = "events";

const DEVICE_KEY_STORAGE_KEY = "weave-offline-key";
const DEVICE_KEY_LENGTH = 32; // bytes

/**
 * Get the 32-byte key this cache is wrapped with, creating one on first use.
 *
 * It moved here when identity seeds stopped using it. The seed is now wrapped
 * by a key derived from a PIN and never stored, so there is no key at rest to
 * find. This cache still works the old way, and the header above says plainly
 * what that is worth: the key sits in localStorage beside the data it wraps,
 * so it raises the bar against a copied database file and nothing else.
 *
 * That is a defensible trade for a cache whose whole purpose is to be readable
 * without a prompt when someone reopens the tab offline. It is not defensible
 * to describe it as encryption at rest, so this comment exists instead.
 */
let sessionKey: Uint8Array | null = null;

function getOrCreateDeviceKey(): Uint8Array {
  if (sessionKey) return sessionKey;

  try {
    const stored = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (stored) {
      const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
      if (bytes.length === DEVICE_KEY_LENGTH) {
        sessionKey = bytes;
        return sessionKey;
      }
    }
    const key = crypto.getRandomValues(new Uint8Array(DEVICE_KEY_LENGTH));
    localStorage.setItem(
      DEVICE_KEY_STORAGE_KEY,
      btoa(String.fromCharCode(...key)),
    );
    sessionKey = key;
    return sessionKey;
  } catch {
    // No localStorage: a private window, a blocked origin, or a non-browser
    // context. Keep a key for this session so the cache still works while the
    // tab is open. It will not survive a reload, which is the honest outcome
    // when there is nowhere to put it.
    sessionKey = crypto.getRandomValues(new Uint8Array(DEVICE_KEY_LENGTH));
    return sessionKey;
  }
}

const HKDF_SALT = "weaveto.do-tasks-offline-v1";
const HKDF_INFO = "task-store-wrapping";

// --- Internal record shapes ---

interface EncryptedRecord {
  roomId: string;
  encryptedData: Uint8Array;
  iv: Uint8Array;
}

// --- DB open helpers ---

/**
 * Open the task snapshot IndexedDB database.
 */
export function openTaskSnapshotDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TASK_SNAPSHOT_DB_NAME, TASK_SNAPSHOT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASK_SNAPSHOT_STORE)) {
        db.createObjectStore(TASK_SNAPSHOT_STORE, { keyPath: "roomId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to open task snapshot database"));
  });
}

/**
 * Open the pending event queue IndexedDB database.
 */
export function openEventQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EVENT_QUEUE_DB_NAME, EVENT_QUEUE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENT_QUEUE_STORE)) {
        db.createObjectStore(EVENT_QUEUE_STORE, { keyPath: "roomId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to open event queue database"));
  });
}

// --- Key derivation ---

/**
 * Derive an AES-GCM-256 wrapping key from the raw device key bytes via
 * HKDF-SHA256 with a fixed salt and info string that namespaces this key
 * to offline task storage only.
 */
async function deriveWrappingKey(deviceKey: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    deviceKey as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// --- Encryption / decryption helpers ---

async function encryptJSON<T>(data: T): Promise<{ encryptedData: Uint8Array; iv: Uint8Array }> {
  const deviceKey = getOrCreateDeviceKey();
  const wrappingKey = await deriveWrappingKey(deviceKey);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM 96-bit IV
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    plaintext as BufferSource,
  );
  return { encryptedData: new Uint8Array(ciphertext), iv };
}

async function decryptJSON<T>(encryptedData: Uint8Array, iv: Uint8Array): Promise<T> {
  const deviceKey = getOrCreateDeviceKey();
  const wrappingKey = await deriveWrappingKey(deviceKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    wrappingKey,
    new Uint8Array(encryptedData) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// --- structuredClone-safe record copy ---

function cloneRecord(record: EncryptedRecord): EncryptedRecord {
  return {
    roomId: record.roomId,
    encryptedData: new Uint8Array(record.encryptedData),
    iv: new Uint8Array(record.iv),
  };
}

// --- Generic IDB put / get / delete helpers ---

async function putRecord(
  db: IDBDatabase,
  storeName: string,
  record: EncryptedRecord,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(cloneRecord(record));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Failed to write record to ${storeName}`));
    };
  });
}

async function getRecord(
  db: IDBDatabase,
  storeName: string,
  roomId: string,
): Promise<EncryptedRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(roomId);
    request.onsuccess = () => {
      db.close();
      resolve(request.result as EncryptedRecord | undefined);
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to read record from ${storeName}`));
    };
  });
}

async function deleteRecord(
  db: IDBDatabase,
  storeName: string,
  roomId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(roomId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Failed to delete record from ${storeName}`));
    };
  });
}

// --- Task snapshot CRUD ---

/**
 * Encrypt and persist the current task array for a room.
 * Any existing snapshot for the same roomId is overwritten.
 */
export async function saveTaskSnapshot(roomId: string, tasks: Task[]): Promise<void> {
  try {
    const { encryptedData, iv } = await encryptJSON(tasks);
    const db = await openTaskSnapshotDB();
    await putRecord(db, TASK_SNAPSHOT_STORE, { roomId, encryptedData, iv });
  } catch {
    // Nothing should observe this. The snapshot is a cache of state the room
    // will resend on the next connection, so losing it costs a slower start
    // offline and nothing else. Quota is the realistic cause.
  }
}

/**
 * Load and decrypt the task snapshot for the given room.
 * Returns null if the record is missing, decryption fails, or IDB is unavailable.
 */
export async function loadTaskSnapshot(roomId: string): Promise<Task[] | null> {
  try {
    const db = await openTaskSnapshotDB();
    const record = await getRecord(db, TASK_SNAPSHOT_STORE, roomId);
    if (!record) return null;
    return await decryptJSON<Task[]>(record.encryptedData, record.iv);
  } catch {
    // Null covers both "nothing stored" and "stored but will not decrypt",
    // which is right for callers wanting usable data or none. It is wrong for
    // anyone asking whether data still exists: use hasTaskSnapshot for that.
    return null;
  }
}

/**
 * Delete the task snapshot for the given room.
 * Errors are swallowed silently.
 */
export async function clearTaskSnapshot(roomId: string): Promise<void> {
  try {
    const db = await openTaskSnapshotDB();
    await deleteRecord(db, TASK_SNAPSHOT_STORE, roomId);
  } catch {
    // Swallowed here, checked elsewhere. cleanupRoom reads the store back with
    // hasTaskSnapshot rather than trusting this, because a delete that failed
    // and a delete that worked look identical from the outside.
  }
}

// --- Event queue CRUD ---

/**
 * Encrypt and persist the pending event queue for a room.
 * Any existing queue for the same roomId is overwritten.
 */
export async function saveEventQueue(roomId: string, events: TaskEvent[]): Promise<void> {
  try {
    const { encryptedData, iv } = await encryptJSON(events);
    const db = await openEventQueueDB();
    await putRecord(db, EVENT_QUEUE_STORE, { roomId, encryptedData, iv });
  } catch {
    // Judged and left, but this one is not a cache and the distinction matters.
    // The queue is the durable copy of work that has not been sent. If this
    // fails, those events exist only in memory and a reload loses them.
    //
    // Left silent because the UI is already honest about the state: every
    // unsent event carries a pending dot, so nobody is told the work is safe.
    // What is missing is the narrower fact that it is not written down, and
    // the only truthful thing to say about it would be a warning nobody can
    // act on. If quota failures ever show up in practice, the fix is to stop
    // accepting offline edits rather than to add a notice.
  }
}

/**
 * Load and decrypt the pending event queue for the given room.
 * Returns null if the record is missing, decryption fails, or IDB is unavailable.
 */
export async function loadEventQueue(roomId: string): Promise<TaskEvent[] | null> {
  try {
    const db = await openEventQueueDB();
    const record = await getRecord(db, EVENT_QUEUE_STORE, roomId);
    if (!record) return null;
    return await decryptJSON<TaskEvent[]>(record.encryptedData, record.iv);
  } catch {
    // See loadTaskSnapshot. Presence is hasEventQueue, not this.
    return null;
  }
}

/**
 * Delete the pending event queue for the given room.
 * Errors are swallowed silently.
 */
export async function clearEventQueue(roomId: string): Promise<void> {
  try {
    const db = await openEventQueueDB();
    await deleteRecord(db, EVENT_QUEUE_STORE, roomId);
  } catch {
    // As above: verified by hasEventQueue in cleanupRoom, not by this catch.
  }
}

/**
 * Whether a room has a stored record, without trying to read it.
 *
 * `loadTaskSnapshot` and `loadEventQueue` return null for two different
 * situations: nothing is stored, and something is stored that will not
 * decrypt. That conflation is right for their callers, which want usable data
 * or nothing, and wrong for anyone asking whether data still exists.
 *
 * It mattered once already. `verifyRoomCleared` checks a burn by reading these
 * stores back, and read them through the loaders, so a record that survived a
 * burn but could no longer be decrypted came back as null and the burn
 * reported clean. An undecryptable record is still a record. It is still on
 * the disk, and the key that opens it may not be gone.
 *
 * Counting keys avoids decryption entirely, so the answer does not depend on
 * whether the device key still matches.
 */
async function hasRecord(
  open: () => Promise<IDBDatabase>,
  storeName: string,
  roomId: string,
): Promise<boolean> {
  const db = await open();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).count(roomId);
    request.onsuccess = () => {
      db.close();
      resolve(request.result > 0);
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to count records in ${storeName}`));
    };
  });
}

/** Whether a task snapshot exists for this room, decryptable or not. */
export function hasTaskSnapshot(roomId: string): Promise<boolean> {
  return hasRecord(openTaskSnapshotDB, TASK_SNAPSHOT_STORE, roomId);
}

/** Whether a pending event queue exists for this room, decryptable or not. */
export function hasEventQueue(roomId: string): Promise<boolean> {
  return hasRecord(openEventQueueDB, EVENT_QUEUE_STORE, roomId);
}

// --- Convenience: clear both stores for a room ---

/**
 * Clear both the task snapshot and pending event queue for a room.
 *
 * `allSettled` so one store failing does not leave the other untouched. Note
 * what that costs: this function cannot fail. It resolves whether both
 * deletions worked or neither did, and the individual clears swallow their own
 * errors as well, so there is no failure to observe anywhere in this path.
 *
 * That is why burn does not trust it. `verifyRoomCleared` reads the stores
 * back through hasTaskSnapshot and hasEventQueue rather than believing this
 * resolved. Do not add a return value here and expect callers to check it:
 * the guarantee has to come from looking, not from reporting.
 */
export async function clearOfflineData(roomId: string): Promise<void> {
  await Promise.allSettled([clearTaskSnapshot(roomId), clearEventQueue(roomId)]);
}
