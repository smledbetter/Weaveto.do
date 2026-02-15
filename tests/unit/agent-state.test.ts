/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  deriveAgentStateKey,
  encryptState,
  decryptState,
  openStateDB,
  saveState,
  loadState,
  deleteState,
  deleteRoomStates,
} from "../../src/lib/agents/state";
import { MAX_STATE_SIZE } from "../../src/lib/agents/types";

// Generate a deterministic PRF seed for tests
function makeSeed(byte: number = 0x42): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe("Agent State: Key Derivation", () => {
  it("derives a CryptoKey from PRF seed + moduleId", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  });

  it("same seed + same moduleId produces same key", async () => {
    const key1 = await deriveAgentStateKey(makeSeed(), "agent-a");
    const key2 = await deriveAgentStateKey(makeSeed(), "agent-a");

    // Can't compare CryptoKeys directly — encrypt with both and compare
    const plaintext = new Uint8Array([1, 2, 3]);
    const iv = new Uint8Array(12); // Zero IV for deterministic test

    const ct1 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key1,
      plaintext,
    );
    const ct2 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key2,
      plaintext,
    );

    expect(new Uint8Array(ct1)).toEqual(new Uint8Array(ct2));
  });

  it("different moduleId produces different key (agent isolation)", async () => {
    const key1 = await deriveAgentStateKey(makeSeed(), "agent-a");
    const key2 = await deriveAgentStateKey(makeSeed(), "agent-b");

    const plaintext = new Uint8Array([1, 2, 3]);
    const iv = new Uint8Array(12);

    const ct1 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key1,
      plaintext,
    );
    const ct2 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key2,
      plaintext,
    );

    expect(new Uint8Array(ct1)).not.toEqual(new Uint8Array(ct2));
  });

  it("different PRF seed produces different key", async () => {
    const key1 = await deriveAgentStateKey(makeSeed(0x01), "agent-a");
    const key2 = await deriveAgentStateKey(makeSeed(0x02), "agent-a");

    const plaintext = new Uint8Array([1, 2, 3]);
    const iv = new Uint8Array(12);

    const ct1 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key1,
      plaintext,
    );
    const ct2 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key2,
      plaintext,
    );

    expect(new Uint8Array(ct1)).not.toEqual(new Uint8Array(ct2));
  });
});

describe("Agent State: Encryption", () => {
  it("encrypts and decrypts round-trip", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const plaintext = new TextEncoder().encode('{"counter": 42}');

    const encrypted = await encryptState(key, plaintext);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();

    const decrypted = await decryptState(key, encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it("each encryption produces different ciphertext (random IV)", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const plaintext = new TextEncoder().encode("same data");

    const enc1 = await encryptState(key, plaintext);
    const enc2 = await encryptState(key, plaintext);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it("wrong key fails to decrypt", async () => {
    const key1 = await deriveAgentStateKey(makeSeed(), "agent-a");
    const key2 = await deriveAgentStateKey(makeSeed(), "agent-b");

    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await encryptState(key1, plaintext);

    await expect(decryptState(key2, encrypted)).rejects.toThrow();
  });

  it("tampered ciphertext fails to decrypt", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const plaintext = new TextEncoder().encode("hello");
    const encrypted = await encryptState(key, plaintext);

    // Tamper with ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA",
    };
    await expect(decryptState(key, tampered)).rejects.toThrow();
  });

  it("rejects state exceeding MAX_STATE_SIZE", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const oversized = new Uint8Array(MAX_STATE_SIZE + 1);

    await expect(encryptState(key, oversized)).rejects.toThrow(/max size/i);
  });

  it("handles empty state", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const plaintext = new Uint8Array(0);

    const encrypted = await encryptState(key, plaintext);
    const decrypted = await decryptState(key, encrypted);

    expect(decrypted).toEqual(plaintext);
  });
});

describe("Agent State: IndexedDB", () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    db = await openStateDB();
  });

  it("saves and loads encrypted state", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const plaintext = new TextEncoder().encode("persisted data");
    const encrypted = await encryptState(key, plaintext);

    await saveState(db, "room-1", "test-agent", encrypted);
    const loaded = await loadState(db, "room-1", "test-agent");

    expect(loaded).toEqual(encrypted);
  });

  it("returns null for nonexistent state", async () => {
    const result = await loadState(db, "room-1", "nonexistent");
    expect(result).toBeNull();
  });

  it("overwrites existing state", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const v1 = await encryptState(key, new TextEncoder().encode("v1"));
    const v2 = await encryptState(key, new TextEncoder().encode("v2"));

    await saveState(db, "room-1", "test-agent", v1);
    await saveState(db, "room-1", "test-agent", v2);

    const loaded = await loadState(db, "room-1", "test-agent");
    const decrypted = await decryptState(key, loaded!);
    expect(new TextDecoder().decode(decrypted)).toBe("v2");
  });

  it("deletes specific agent state", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const encrypted = await encryptState(key, new TextEncoder().encode("data"));

    await saveState(db, "room-1", "test-agent", encrypted);
    await deleteState(db, "room-1", "test-agent");

    const result = await loadState(db, "room-1", "test-agent");
    expect(result).toBeNull();
  });

  it("deleteRoomStates removes all state for a room", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "agent-a");
    const enc1 = await encryptState(key, new TextEncoder().encode("a"));
    const enc2 = await encryptState(key, new TextEncoder().encode("b"));
    const enc3 = await encryptState(key, new TextEncoder().encode("c"));

    await saveState(db, "room-1", "agent-a", enc1);
    await saveState(db, "room-1", "agent-b", enc2);
    await saveState(db, "room-2", "agent-a", enc3); // Different room

    await deleteRoomStates(db, "room-1");

    expect(await loadState(db, "room-1", "agent-a")).toBeNull();
    expect(await loadState(db, "room-1", "agent-b")).toBeNull();
    expect(await loadState(db, "room-2", "agent-a")).not.toBeNull(); // Unaffected
  });

  it("isolates state between rooms", async () => {
    const key = await deriveAgentStateKey(makeSeed(), "test-agent");
    const enc1 = await encryptState(key, new TextEncoder().encode("room1"));
    const enc2 = await encryptState(key, new TextEncoder().encode("room2"));

    await saveState(db, "room-1", "test-agent", enc1);
    await saveState(db, "room-2", "test-agent", enc2);

    const loaded1 = await loadState(db, "room-1", "test-agent");
    const loaded2 = await loadState(db, "room-2", "test-agent");

    expect(loaded1).toEqual(enc1);
    expect(loaded2).toEqual(enc2);
    expect(loaded1).not.toEqual(loaded2);
  });
});
