/**
 * Agent encrypted state manager.
 * Uses HKDF-SHA256 for key derivation and AES-256-GCM for encryption.
 * Each agent+room combination gets a unique encryption key derived from the room session key.
 * State is stored in IndexedDB — only ciphertext + IV, never plaintext.
 */

import { MAX_STATE_SIZE, type EncryptedAgentState } from "./types";

const DB_NAME = "weave-agent-state";
const STORE_NAME = "states";
const DB_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- Key Derivation ---

/**
 * Derive an AES-256-GCM key for a specific agent in a specific room.
 * Uses HKDF-SHA256 with the PRF seed as input key material.
 * Different moduleId values produce different keys (agent isolation).
 */
export async function deriveAgentStateKey(
  prfSeed: Uint8Array,
  moduleId: string,
): Promise<CryptoKey> {
  // Create a fresh ArrayBuffer (avoids jsdom issues with shared/detached buffers)
  const rawKey = new ArrayBuffer(prfSeed.byteLength);
  new Uint8Array(rawKey).set(prfSeed);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    rawKey,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("weave-agent-state-v1"),
      info: encoder.encode(`agent-state:${moduleId}`),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// --- Encryption ---

/**
 * Encrypt agent state with AES-256-GCM.
 * Returns base64-encoded IV and ciphertext.
 */
export async function encryptState(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedAgentState> {
  if (plaintext.byteLength > MAX_STATE_SIZE) {
    throw new Error(`Agent state exceeds max size (${MAX_STATE_SIZE} bytes)`);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    key,
    plaintext as Uint8Array<ArrayBuffer>,
  );

  return {
    iv: uint8ToBase64(iv),
    ciphertext: uint8ToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt agent state with AES-256-GCM.
 * Throws if ciphertext is tampered (GCM authentication tag fails).
 */
export async function decryptState(
  key: CryptoKey,
  encrypted: EncryptedAgentState,
): Promise<Uint8Array> {
  const iv = base64ToUint8(encrypted.iv);
  const ciphertext = base64ToUint8(encrypted.ciphertext);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    key,
    ciphertext as Uint8Array<ArrayBuffer>,
  );

  return new Uint8Array(plaintext);
}

// --- IndexedDB ---

/**
 * Open (or create) the agent state database.
 */
export function openStateDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save encrypted state to IndexedDB.
 * Key format: "roomId:moduleId"
 */
export async function saveState(
  db: IDBDatabase,
  roomId: string,
  moduleId: string,
  encrypted: EncryptedAgentState,
): Promise<void> {
  const key = `${roomId}:${moduleId}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(encrypted, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Load encrypted state from IndexedDB.
 * Returns null if no state exists for this agent+room.
 */
export async function loadState(
  db: IDBDatabase,
  roomId: string,
  moduleId: string,
): Promise<EncryptedAgentState | null> {
  const key = `${roomId}:${moduleId}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete state for a specific agent+room.
 */
export async function deleteState(
  db: IDBDatabase,
  roomId: string,
  moduleId: string,
): Promise<void> {
  const key = `${roomId}:${moduleId}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete all state for a room (used during burn).
 */
export async function deleteRoomStates(
  db: IDBDatabase,
  roomId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if (
          typeof cursor.key === "string" &&
          cursor.key.startsWith(`${roomId}:`)
        ) {
          cursor.delete();
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Base64 Helpers ---

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
