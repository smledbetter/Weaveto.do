/**
 * Encrypted PIN key storage in IndexedDB.
 * PIN keys are wrapped by a key derived from the PRF seed using HKDF-SHA256.
 */

import type { StoredPinKey } from "./types";

const DB_NAME = "weave-pin-keys";
const DB_VERSION = 1;
const STORE_NAME = "keys";

/**
 * Derive an encryption key from the PRF seed for wrapping PIN keys.
 * Uses HKDF-SHA256 with a unique context string.
 */
export async function deriveWrappingKey(
  prfSeed: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    prfSeed as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("weaveto.do-pin-encryption-v1"),
      info: encoder.encode("pin-key-wrapping"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Open the PIN keys IndexedDB database.
 */
function openPinDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "roomId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Failed to open PIN database"));
  });
}

/**
 * Store a PIN key encrypted under the PRF-derived wrapping key.
 */
export async function storePinKey(
  roomId: string,
  pinKey: CryptoKey,
  salt: Uint8Array,
  keyHash: Uint8Array,
  prfSeed: Uint8Array,
): Promise<void> {
  const wrappingKey = await deriveWrappingKey(prfSeed);

  // Export the PIN key as raw bytes
  const rawPinKey = await crypto.subtle.exportKey("raw", pinKey);

  // Encrypt under wrapping key
  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM 96-bit IV
  const encryptedKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    rawPinKey as BufferSource,
  );

  const record: StoredPinKey = {
    roomId,
    salt,
    encryptedKey: new Uint8Array(encryptedKey),
    iv,
    keyHash,
  };

  const db = await openPinDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(structuredCloneRecord(record));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error("Failed to store PIN key"));
    };
  });
}

/**
 * Load and decrypt a PIN key from IndexedDB.
 * Returns the stored record with the decrypted CryptoKey, or null if not found.
 */
export async function loadPinKey(
  roomId: string,
  prfSeed: Uint8Array,
): Promise<{
  pinKey: CryptoKey;
  salt: Uint8Array;
  keyHash: Uint8Array;
} | null> {
  const db = await openPinDB();
  const record = await new Promise<StoredPinKey | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(roomId);
      request.onsuccess = () => {
        db.close();
        resolve(request.result as StoredPinKey | undefined);
      };
      request.onerror = () => {
        db.close();
        reject(new Error("Failed to load PIN key"));
      };
    },
  );

  if (!record) return null;

  const wrappingKey = await deriveWrappingKey(prfSeed);

  // Decrypt the PIN key
  const rawPinKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(record.iv) },
    wrappingKey,
    new Uint8Array(record.encryptedKey) as BufferSource,
  );

  // Import as CryptoKey
  const pinKey = await crypto.subtle.importKey(
    "raw",
    rawPinKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );

  return { pinKey, salt: record.salt, keyHash: record.keyHash };
}

/**
 * Clear PIN key for a room from IndexedDB.
 */
export async function clearPinKey(roomId: string): Promise<void> {
  try {
    const db = await openPinDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(roomId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error("Failed to clear PIN key"));
      };
    });
  } catch {
    // IndexedDB not available or error opening — ignore silently
  }
}

/**
 * Convert a StoredPinKey record for IndexedDB storage.
 * IndexedDB can store Uint8Array directly, but we ensure clean serialization.
 */
function structuredCloneRecord(record: StoredPinKey): StoredPinKey {
  return {
    roomId: record.roomId,
    salt: new Uint8Array(record.salt),
    encryptedKey: new Uint8Array(record.encryptedKey),
    iv: new Uint8Array(record.iv),
    keyHash: new Uint8Array(record.keyHash),
  };
}

// Export DB constants for testing
export { DB_NAME, DB_VERSION, STORE_NAME };
