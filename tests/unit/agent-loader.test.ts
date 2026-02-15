/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  validateManifest,
  computeWasmHash,
  validateWasmBinary,
  openModuleDB,
  storeModule,
  listModules,
  getModule,
  deleteModule,
  setModuleActive,
} from "../../src/lib/agents/loader";
import type {
  AgentManifest,
  AgentPermission,
  StoredAgentModule,
} from "../../src/lib/agents/types";
import { MAX_WASM_SIZE } from "../../src/lib/agents/types";

// Minimal valid WASM binary (magic number + version)
const MINIMAL_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

// Create a more complete WASM module with required exports
// Generated from: (module (memory 1) (func $init) (func $on_task_event (param i32 i32)) (func $on_tick) (export "init" (func $init)) (export "on_task_event" (func $on_task_event)) (export "on_tick" (func $on_tick)) (export "memory" (memory 0)))
const WASM_WITH_EXPORTS = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0c, 0x03, 0x60, 0x00,
  0x00, 0x60, 0x02, 0x7f, 0x7f, 0x00, 0x60, 0x00, 0x00, 0x03, 0x04, 0x03, 0x00,
  0x01, 0x02, 0x05, 0x03, 0x01, 0x00, 0x02, 0x07, 0x50, 0x04, 0x04, 0x69, 0x6e,
  0x69, 0x74, 0x00, 0x00, 0x0d, 0x6f, 0x6e, 0x5f, 0x74, 0x61, 0x73, 0x6b, 0x5f,
  0x65, 0x76, 0x65, 0x6e, 0x74, 0x00, 0x01, 0x07, 0x6f, 0x6e, 0x5f, 0x74, 0x69,
  0x63, 0x6b, 0x00, 0x02, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x03, 0x00,
  0x0a, 0x07, 0x03, 0x02, 0x00, 0x0b, 0x04, 0x00, 0x01, 0x0b, 0x02, 0x00, 0x0b,
]);

describe("validateManifest", () => {
  it("returns null for valid manifest", () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123def456",
      permissions: ["read_tasks", "emit_events"],
    };

    expect(validateManifest(manifest)).toBeNull();
  });

  it("returns error for non-object manifest", () => {
    expect(validateManifest(null)).not.toBeNull();
    expect(validateManifest("string")).not.toBeNull();
    expect(validateManifest(123)).not.toBeNull();
  });

  it("returns error when name is missing", () => {
    const manifest = {
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: [],
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("name");
  });

  it("returns error when version is missing", () => {
    const manifest = {
      name: "test-agent",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: [],
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("version");
  });

  it("returns error when description is missing", () => {
    const manifest = {
      name: "test-agent",
      version: "1.0.0",
      author: "test",
      wasmHash: "abc123",
      permissions: [],
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("description");
  });

  it("returns error when author is missing", () => {
    const manifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      wasmHash: "abc123",
      permissions: [],
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("author");
  });

  it("returns error when wasmHash is missing", () => {
    const manifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      permissions: [],
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("wasmHash");
  });

  it("returns error when permissions is not an array", () => {
    const manifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: "read_tasks",
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("permissions");
  });

  it("returns error for invalid permission", () => {
    const manifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: ["read_tasks", "invalid_permission"],
    };

    const error = validateManifest(manifest);
    expect(error).not.toBeNull();
    expect(error).toContain("Invalid permission");
  });

  it("accepts empty permissions array", () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: [],
    };

    expect(validateManifest(manifest)).toBeNull();
  });

  it("accepts all valid permissions", () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "A test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: [
        "read_tasks",
        "read_members",
        "emit_events",
        "persist_state",
      ],
    };

    expect(validateManifest(manifest)).toBeNull();
  });
});

describe("computeWasmHash", () => {
  it("returns a valid hex string", async () => {
    const hash = await computeWasmHash(MINIMAL_WASM.buffer);
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it("returns lowercase hex", async () => {
    const hash = await computeWasmHash(MINIMAL_WASM.buffer);
    expect(hash).toBe(hash.toLowerCase());
  });

  it("produces consistent hash for same input", async () => {
    const hash1 = await computeWasmHash(MINIMAL_WASM.buffer);
    const hash2 = await computeWasmHash(MINIMAL_WASM.buffer);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different inputs", async () => {
    const input1 = new Uint8Array([1, 2, 3, 4, 5]);
    const input2 = new Uint8Array([1, 2, 3, 4, 6]);
    const hash1 = await computeWasmHash(input1.buffer);
    const hash2 = await computeWasmHash(input2.buffer);
    expect(hash1).not.toBe(hash2);
  });
});

describe("validateWasmBinary", () => {
  it("rejects oversized binary", async () => {
    const oversized = new ArrayBuffer(MAX_WASM_SIZE + 1);
    const hash = await computeWasmHash(oversized);
    const error = await validateWasmBinary(oversized, hash);
    expect(error).not.toBeNull();
    expect(error).toContain("exceeds max size");
  });

  it("rejects invalid WASM binary", async () => {
    const invalid = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    const error = await validateWasmBinary(invalid.buffer, "somehash");
    expect(error).not.toBeNull();
  });

  it("rejects hash mismatch", async () => {
    const hash = await computeWasmHash(MINIMAL_WASM.buffer);
    const wrongHash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const error = await validateWasmBinary(MINIMAL_WASM.buffer, wrongHash);
    expect(error).not.toBeNull();
    expect(error).toContain("Hash mismatch");
  });

  it("validates WASM size and hash correctly", async () => {
    const hash = await computeWasmHash(MINIMAL_WASM.buffer);
    // This will fail on exports check, but passes size and hash validation
    const error = await validateWasmBinary(MINIMAL_WASM.buffer, hash);
    expect(error).not.toBeNull();
    // Should fail on exports, not on hash or size
    expect(error).toContain("export");
  });

  it("rejects WASM missing required exports", async () => {
    const hash = await computeWasmHash(MINIMAL_WASM.buffer);
    const error = await validateWasmBinary(MINIMAL_WASM.buffer, hash);
    expect(error).not.toBeNull();
    expect(error?.toLowerCase()).toContain("export");
  });

  it("validates hash before checking exports", async () => {
    // Provide wrong hash, should fail on hash check before exports check
    const wrongHash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const error = await validateWasmBinary(MINIMAL_WASM.buffer, wrongHash);
    expect(error).not.toBeNull();
    expect(error).toContain("Hash mismatch");
  });
});

describe("IndexedDB Operations", () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    // Create a unique database name for each test to avoid interference
    db = await openModuleDB();

    // Clear all modules from the database
    const transaction = db.transaction(["modules"], "readwrite");
    const store = transaction.objectStore("modules");
    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  it("storeModule + getModule round-trip", async () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "Test agent",
      author: "test",
      wasmHash: "abc123",
      permissions: ["read_tasks"],
    };

    const stored = await storeModule(
      db,
      "room-1",
      manifest,
      MINIMAL_WASM.buffer,
    );

    expect(stored.id).toBe("room-1:test-agent");
    expect(stored.roomId).toBe("room-1");
    expect(stored.manifest).toEqual(manifest);
    expect(stored.active).toBe(false);
    expect(stored.uploadedAt).toBeTruthy();

    const retrieved = await getModule(db, stored.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("room-1:test-agent");
    expect(retrieved!.manifest.name).toBe("test-agent");
  });

  it("listModules returns only modules for specified room", async () => {
    const manifest1: AgentManifest = {
      name: "agent-a",
      version: "1.0.0",
      description: "Agent A",
      author: "test",
      wasmHash: "hash1",
      permissions: [],
    };

    const manifest2: AgentManifest = {
      name: "agent-b",
      version: "1.0.0",
      description: "Agent B",
      author: "test",
      wasmHash: "hash2",
      permissions: [],
    };

    // Store in room-1
    await storeModule(db, "room-1", manifest1, MINIMAL_WASM.buffer);
    await storeModule(db, "room-1", manifest2, MINIMAL_WASM.buffer);

    // Store in room-2
    await storeModule(db, "room-2", manifest1, MINIMAL_WASM.buffer);

    // List room-1
    const room1Modules = await listModules(db, "room-1");
    expect(room1Modules).toHaveLength(2);
    expect(room1Modules.map((m) => m.manifest.name).sort()).toEqual([
      "agent-a",
      "agent-b",
    ]);

    // List room-2
    const room2Modules = await listModules(db, "room-2");
    expect(room2Modules).toHaveLength(1);
    expect(room2Modules[0].manifest.name).toBe("agent-a");
  });

  it("deleteModule removes module from database", async () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "Test",
      author: "test",
      wasmHash: "hash",
      permissions: [],
    };

    const stored = await storeModule(
      db,
      "room-1",
      manifest,
      MINIMAL_WASM.buffer,
    );
    expect(await getModule(db, stored.id)).not.toBeNull();

    await deleteModule(db, stored.id);
    expect(await getModule(db, stored.id)).toBeNull();
  });

  it("setModuleActive updates active flag", async () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "Test",
      author: "test",
      wasmHash: "hash",
      permissions: [],
    };

    const stored = await storeModule(
      db,
      "room-1",
      manifest,
      MINIMAL_WASM.buffer,
    );
    expect(stored.active).toBe(false);

    await setModuleActive(db, stored.id, true);
    const updated = await getModule(db, stored.id);
    expect(updated!.active).toBe(true);

    await setModuleActive(db, stored.id, false);
    const deactivated = await getModule(db, stored.id);
    expect(deactivated!.active).toBe(false);
  });

  it("getModule returns null for nonexistent module", async () => {
    const result = await getModule(db, "nonexistent:module");
    expect(result).toBeNull();
  });

  it("setModuleActive throws for nonexistent module", async () => {
    await expect(
      setModuleActive(db, "nonexistent:module", true),
    ).rejects.toThrow("Module not found");
  });

  it("listModules returns empty array for room with no modules", async () => {
    const modules = await listModules(db, "room-with-no-modules");
    expect(modules).toEqual([]);
  });

  it("multiple modules can be stored and retrieved correctly", async () => {
    const manifests = Array.from({ length: 5 }, (_, i) => ({
      name: `agent-${i}`,
      version: "1.0.0",
      description: `Agent ${i}`,
      author: "test",
      wasmHash: `hash-${i}`,
      permissions: [] as AgentPermission[],
    }));

    // Store all
    for (const manifest of manifests) {
      await storeModule(db, "room-1", manifest, MINIMAL_WASM.buffer);
    }

    // List and verify
    const stored = await listModules(db, "room-1");
    expect(stored).toHaveLength(5);
    const names = stored.map((m) => m.manifest.name).sort();
    const expected = Array.from({ length: 5 }, (_, i) => `agent-${i}`).sort();
    expect(names).toEqual(expected);
  });

  it("active flag persists across operations", async () => {
    const manifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "Test",
      author: "test",
      wasmHash: "hash",
      permissions: [],
    };

    const stored = await storeModule(
      db,
      "room-1",
      manifest,
      MINIMAL_WASM.buffer,
    );
    const id = stored.id;

    // Activate
    await setModuleActive(db, id, true);

    // List and verify
    const listed = await listModules(db, "room-1");
    expect(listed[0].active).toBe(true);

    // Get and verify
    const retrieved = await getModule(db, id);
    expect(retrieved!.active).toBe(true);
  });
});
