/**
 * Encrypted identity seed storage in IndexedDB.
 * Seeds are wrapped by a key derived from a device key using HKDF-SHA256.
 *
 * Security note: The device key is stored in localStorage as base64. This means
 * it is accessible to any JavaScript running on the same origin and is NOT protected
 * by the OS credential store. It protects against IndexedDB exfiltration in isolation
 * (e.g., a DB file copied off disk), but NOT against XSS or malicious same-origin
 * scripts. Treat this as defence-in-depth, not a strong security boundary.
 */

export const DB_NAME = "weave-identity";
export const DB_VERSION = 1;
export const STORE_NAME = "seeds";

const DEVICE_KEY_STORAGE_KEY = "weave-device-key";
const DEVICE_KEY_LENGTH = 32; // bytes

interface StoredIdentitySeed {
  roomId: string;
  encryptedSeed: Uint8Array;
  iv: Uint8Array;
}

/**
 * Open the identity seeds IndexedDB database.
 */
export function openIdentityDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "roomId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to open identity database"));
  });
}

/**
 * Get the 32-byte device key from localStorage, creating and persisting one on
 * first call. The key is stored as base64 under DEVICE_KEY_STORAGE_KEY.
 */
export function getOrCreateDeviceKey(): Uint8Array {
  const stored = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
  if (stored) {
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    if (bytes.length === DEVICE_KEY_LENGTH) {
      return bytes;
    }
  }

  // Generate a fresh device key and persist it
  const key = crypto.getRandomValues(new Uint8Array(DEVICE_KEY_LENGTH));
  localStorage.setItem(
    DEVICE_KEY_STORAGE_KEY,
    btoa(String.fromCharCode(...key)),
  );
  return key;
}

/**
 * Derive an AES-GCM-256 wrapping key from the raw device key bytes via
 * HKDF-SHA256 with a fixed salt and info string that namespaces this key
 * to identity seed wrapping only.
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
      salt: encoder.encode("weaveto.do-identity-v1"),
      info: encoder.encode("identity-seed-wrapping"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt the given seed and store it in IndexedDB under the room's ID.
 * Any existing record for the same roomId is overwritten.
 */
export async function storeIdentitySeed(
  roomId: string,
  seed: Uint8Array,
): Promise<void> {
  const deviceKey = getOrCreateDeviceKey();
  const wrappingKey = await deriveWrappingKey(deviceKey);

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
 * Load and decrypt the identity seed for the given room.
 * Returns null if the record is missing, the device key is absent, or
 * decryption fails (e.g., record was written on a different device).
 */
export async function loadIdentitySeed(
  roomId: string,
): Promise<Uint8Array | null> {
  try {
    const storedKey = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (!storedKey) return null;

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

    if (!record) return null;

    const deviceKey = getOrCreateDeviceKey();
    const wrappingKey = await deriveWrappingKey(deviceKey);

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      wrappingKey,
      new Uint8Array(record.encryptedSeed) as BufferSource,
    );

    return new Uint8Array(plaintext);
  } catch {
    // Missing record, corrupted data, wrong device key, or IDB unavailable
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
  };
}
