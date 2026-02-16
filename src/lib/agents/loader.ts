/**
 * Agent module loader.
 * Handles validation, hash verification, and IndexedDB storage of WASM agent modules.
 * SKELETON — to be implemented by agent.
 */

import type { AgentManifest, StoredAgentModule } from "./types";
import { MAX_WASM_SIZE, REQUIRED_EXPORTS } from "./types";

const DB_NAME = "weave-agent-modules";
const STORE_NAME = "modules";
const DB_VERSION = 1;

// --- Validation ---

/**
 * Validate an agent manifest. Returns null if valid, error message if invalid.
 */
export function validateManifest(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object") {
    return "Manifest must be an object";
  }

  const m = manifest as Record<string, unknown>;

  // Check required string fields
  if (typeof m.name !== "string") {
    return "Manifest.name must be a string";
  }
  if (typeof m.version !== "string") {
    return "Manifest.version must be a string";
  }
  if (typeof m.description !== "string") {
    return "Manifest.description must be a string";
  }
  if (typeof m.author !== "string") {
    return "Manifest.author must be a string";
  }
  if (typeof m.wasmHash !== "string") {
    return "Manifest.wasmHash must be a string";
  }

  // Check permissions is an array
  if (!Array.isArray(m.permissions)) {
    return "Manifest.permissions must be an array";
  }

  // Validate each permission
  const validPermissions = new Set([
    "read_tasks",
    "read_members",
    "emit_events",
    "persist_state",
  ]);
  for (const perm of m.permissions) {
    if (typeof perm !== "string" || !validPermissions.has(perm)) {
      return `Invalid permission: ${perm}`;
    }
  }

  // Optional signature field must be a string if present
  if (m.signature !== undefined && typeof m.signature !== "string") {
    return "Manifest.signature must be a string if provided";
  }

  return null;
}

/**
 * Compute SHA-256 hex digest of a WASM binary.
 */
export async function computeWasmHash(wasmBytes: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", wasmBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a WASM binary:
 * 1. Size < MAX_WASM_SIZE
 * 2. WebAssembly.validate() passes
 * 3. Required exports exist (init, on_task_event, on_tick, memory)
 * 4. Hash matches manifest.wasmHash
 */
export async function validateWasmBinary(
  wasmBytes: ArrayBuffer,
  expectedHash: string,
): Promise<string | null> {
  // Check size
  if (wasmBytes.byteLength > MAX_WASM_SIZE) {
    return `WASM binary exceeds max size (${wasmBytes.byteLength} > ${MAX_WASM_SIZE})`;
  }

  // Check binary is valid WASM
  if (!WebAssembly.validate(wasmBytes)) {
    return "Invalid WASM binary";
  }

  // Check hash
  const computedHash = await computeWasmHash(wasmBytes);
  if (computedHash !== expectedHash) {
    return `Hash mismatch: expected ${expectedHash}, got ${computedHash}`;
  }

  // Check required exports exist
  try {
    const module = new WebAssembly.Module(wasmBytes);
    const exports = WebAssembly.Module.exports(module);
    const exportNames = new Set(exports.map((e) => e.name));

    for (const required of REQUIRED_EXPORTS) {
      if (!exportNames.has(required)) {
        return `Missing required export: ${required}`;
      }
    }
  } catch (err) {
    return `Failed to inspect WASM exports: ${err instanceof Error ? err.message : String(err)}`;
  }

  return null;
}

// --- IndexedDB Storage ---

/**
 * Open (or create) the agent modules database.
 */
export function openModuleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open database: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create modules object store with id as keyPath
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        // Create index on roomId
        store.createIndex("roomId", "roomId", { unique: false });
      }
    };
  });
}

/**
 * Store a validated agent module in IndexedDB.
 */
export async function storeModule(
  db: IDBDatabase,
  roomId: string,
  manifest: AgentManifest,
  wasmBytes: ArrayBuffer,
): Promise<StoredAgentModule> {
  const stored: StoredAgentModule = {
    id: `${roomId}:${manifest.name}`,
    roomId,
    manifest,
    wasmBytes,
    uploadedAt: Date.now(),
    active: false,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(stored);

    request.onerror = () => {
      reject(new Error(`Failed to store module: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(stored);
    };
  });
}

/**
 * List all agent modules for a room.
 */
export async function listModules(
  db: IDBDatabase,
  roomId: string,
): Promise<StoredAgentModule[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("roomId");
    const request = index.getAll(roomId);

    request.onerror = () => {
      reject(new Error(`Failed to list modules: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

/**
 * Get a single agent module by id.
 */
export async function getModule(
  db: IDBDatabase,
  moduleId: string,
): Promise<StoredAgentModule | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(moduleId);

    request.onerror = () => {
      reject(new Error(`Failed to get module: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

/**
 * Delete an agent module from IndexedDB.
 */
export async function deleteModule(
  db: IDBDatabase,
  moduleId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(moduleId);

    request.onerror = () => {
      reject(new Error(`Failed to delete module: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

/**
 * Update the active status of a module.
 */
export async function setModuleActive(
  db: IDBDatabase,
  moduleId: string,
  active: boolean,
): Promise<void> {
  const module = await getModule(db, moduleId);
  if (!module) {
    throw new Error(`Module not found: ${moduleId}`);
  }

  module.active = active;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(module);

    request.onerror = () => {
      reject(new Error(`Failed to update module: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}
