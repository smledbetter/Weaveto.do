/**
 * Identity seed storage in IndexedDB, wrapped by a key derived from a PIN.
 *
 * Storing a seed at all is the exception, not the rule. On a device with
 * WebAuthn PRF the seed is re-derived from the authenticator every session and
 * nothing is written down. This path exists only for devices without PRF,
 * where the alternative is a fresh identity on every visit.
 *
 * It is also opt-in. Nothing is stored unless the person asks to stay on this
 * device, and asking means choosing a PIN.
 *
 * The previous version wrapped the seed with a random key kept in
 * localStorage, beside the data it wrapped. Anything that could read one could
 * read the other, so the encryption raised the bar against a copied IndexedDB
 * file and against nothing else, while reading as though the seed were
 * protected. A PIN-derived key is never stored, so there is no key at rest to
 * find. The cost is real and worth stating: forget the PIN and the seed is
 * gone, because nothing else can open it.
 */

import { derivePinKey, generatePinSalt } from "../pin/derive";

export const DB_NAME = "weave-identity";
/**
 * Bumped when the wrapping changed. The upgrade drops every existing record,
 * because they are sealed with a key this version deliberately deletes and
 * leaving them would be keeping key material that can never be opened.
 */
export const DB_VERSION = 2;
export const STORE_NAME = "seeds";

/** Where the old random wrapping key lived. Removed on first run. */
const LEGACY_DEVICE_KEY = "weave-device-key";

interface StoredIdentitySeed {
  roomId: string;
  encryptedSeed: Uint8Array;
  iv: Uint8Array;
  /** PBKDF2 salt. Not secret, and useless without the PIN. */
  salt: Uint8Array;
}

/**
 * Open the identity seeds database.
 *
 * The version 2 upgrade recreates the store empty. See DB_VERSION.
 */
export function openIdentityDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: "roomId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to open identity database"));
  });
}

/**
 * Remove the wrapping key the old scheme left in localStorage.
 *
 * Safe to call repeatedly. It is called on startup rather than lazily so the
 * key does not linger on a device whose owner never opens a room again.
 */
export function purgeLegacyDeviceKey(): void {
  try {
    localStorage.removeItem(LEGACY_DEVICE_KEY);
  } catch {
    // Storage unavailable. Nothing to remove and nothing to report.
  }
}

/** Whether this room has a stored seed, without needing the PIN to find out. */
export async function hasStoredIdentitySeed(roomId: string): Promise<boolean> {
  try {
    const db = await openIdentityDB();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).count(roomId);
      request.onsuccess = () => {
        db.close();
        resolve(request.result > 0);
      };
      request.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

/**
 * Encrypt a seed under a PIN and store it for this room.
 *
 * Overwrites any existing record, so changing the PIN is a re-store.
 */
export async function storeIdentitySeed(
  roomId: string,
  seed: Uint8Array,
  pin: string,
): Promise<void> {
  const salt = generatePinSalt();
  const wrappingKey = await derivePinKey(pin, salt);

  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM 96-bit IV
  const encryptedSeed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    seed as BufferSource,
  );

  const record: StoredIdentitySeed = {
    roomId,
    encryptedSeed: new Uint8Array(encryptedSeed),
    iv,
    salt,
  };

  const db = await openIdentityDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(structuredCloneRecord(record));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error("Failed to store identity seed"));
    };
  });
}

/**
 * Load and decrypt this room's identity seed with a PIN.
 *
 * Returns null when there is no record, when the PIN is wrong, or when storage
 * is unavailable. A wrong PIN is indistinguishable from a missing record on
 * purpose: AES-GCM authentication fails either way, and the caller has nothing
 * useful to do with the difference.
 */
export async function loadIdentitySeed(
  roomId: string,
  pin: string,
): Promise<Uint8Array | null> {
  try {
    const db = await openIdentityDB();
    const record = await new Promise<StoredIdentitySeed | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(roomId);
        request.onsuccess = () => {
          db.close();
          resolve(request.result as StoredIdentitySeed | undefined);
        };
        request.onerror = () => {
          db.close();
          reject(new Error("Failed to load identity seed"));
        };
      },
    );

    if (!record || !record.salt) return null;

    const wrappingKey = await derivePinKey(pin, new Uint8Array(record.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      wrappingKey,
      new Uint8Array(record.encryptedSeed) as BufferSource,
    );

    return new Uint8Array(plaintext);
  } catch {
    // Missing record, wrong PIN, corrupted data, or IDB unavailable.
    return null;
  }
}

/**
 * Delete the identity seed record for the given room from IndexedDB.
 * Errors are swallowed silently — callers should not depend on this succeeding.
 */
export async function clearIdentitySeed(roomId: string): Promise<void> {
  try {
    const db = await openIdentityDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(roomId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error("Failed to clear identity seed"));
      };
    });
  } catch {
    // IndexedDB not available or error opening — ignore silently
  }
}

/**
 * Produce a plain-object copy of a StoredIdentitySeed record for safe IDB
 * writes. This avoids issues with Svelte 5 Proxy objects and ensures clean
 * structured-clone-compatible serialization.
 */
function structuredCloneRecord(record: StoredIdentitySeed): StoredIdentitySeed {
  return {
    roomId: record.roomId,
    encryptedSeed: new Uint8Array(record.encryptedSeed),
    iv: new Uint8Array(record.iv),
    salt: new Uint8Array(record.salt),
  };
}
