import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  openIdentityDB,
  getOrCreateDeviceKey,
  storeIdentitySeed,
  loadIdentitySeed,
  clearIdentitySeed,
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
} from "$lib/identity/store";

const DEVICE_KEY_STORAGE_KEY = "weave-device-key";

describe("Identity Seed Storage", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
  });

  describe("storeIdentitySeed + loadIdentitySeed", () => {
    it("round-trips a 32-byte seed successfully", async () => {
      const roomId = "room-roundtrip";
      const seed = crypto.getRandomValues(new Uint8Array(32));

      await storeIdentitySeed(roomId, seed);
      const loaded = await loadIdentitySeed(roomId);

      expect(loaded).not.toBeNull();
      expect(Array.from(new Uint8Array(loaded!))).toEqual(Array.from(seed));
    });

    it("returns null for non-existent room", async () => {
      // Ensure a device key exists so we don't hit the early-return for missing key
      getOrCreateDeviceKey();

      const loaded = await loadIdentitySeed("room-nonexistent");

      expect(loaded).toBeNull();
    });

    it("returns null when no device key exists in localStorage", async () => {
      // Store a seed first so IDB has a record (using a temporary device key)
      const roomId = "room-no-device-key";
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed(roomId, seed);

      // Now clear localStorage to remove the device key, then try to load
      localStorage.clear();

      const loaded = await loadIdentitySeed(roomId);

      expect(loaded).toBeNull();
    });

    it("stores encrypted data (raw bytes differ from original seed)", async () => {
      const roomId = "room-encrypted";
      const seed = crypto.getRandomValues(new Uint8Array(32));

      await storeIdentitySeed(roomId, seed);

      // Manually open IDB and read the raw record
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Failed to open DB"));
      });

      const record = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(roomId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Failed to read record"));
      });

      db.close();

      expect(record).toBeDefined();

      const encryptedSeed = new Uint8Array(record.encryptedSeed);
      const iv = new Uint8Array(record.iv);

      expect(encryptedSeed).toBeInstanceOf(Uint8Array);
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.length).toBe(12); // AES-GCM 96-bit IV

      // Encrypted bytes must not equal the original plaintext seed
      // (encryptedSeed is seed + 16-byte GCM tag, so it's longer and unequal)
      expect(Array.from(encryptedSeed)).not.toEqual(Array.from(seed));
    });

    it("returns null (does not throw) when decryption fails due to different device key", async () => {
      const roomId = "room-wrong-key";
      const seed = crypto.getRandomValues(new Uint8Array(32));

      // Store with original device key
      await storeIdentitySeed(roomId, seed);

      // Replace device key in localStorage with a different random key
      const differentKey = crypto.getRandomValues(new Uint8Array(32));
      localStorage.setItem(
        DEVICE_KEY_STORAGE_KEY,
        btoa(String.fromCharCode(...differentKey)),
      );

      // loadIdentitySeed must return null, not throw
      const loaded = await loadIdentitySeed(roomId);

      expect(loaded).toBeNull();
    });

    it("overwrites existing seed for same roomId (load returns the second seed)", async () => {
      const roomId = "room-overwrite";
      const seed1 = crypto.getRandomValues(new Uint8Array(32));
      const seed2 = crypto.getRandomValues(new Uint8Array(32));

      await storeIdentitySeed(roomId, seed1);
      await storeIdentitySeed(roomId, seed2);

      const loaded = await loadIdentitySeed(roomId);

      expect(loaded).not.toBeNull();
      expect(Array.from(new Uint8Array(loaded!))).toEqual(Array.from(seed2));
    });
  });

  describe("clearIdentitySeed", () => {
    it("removes the stored seed (load returns null after clear)", async () => {
      const roomId = "room-to-clear";
      const seed = crypto.getRandomValues(new Uint8Array(32));

      await storeIdentitySeed(roomId, seed);
      expect(await loadIdentitySeed(roomId)).not.toBeNull();

      await clearIdentitySeed(roomId);

      expect(await loadIdentitySeed(roomId)).toBeNull();
    });

    it("succeeds even if the record does not exist", async () => {
      await expect(clearIdentitySeed("room-never-existed")).resolves.not.toThrow();
    });

    it("only clears the specified room (other rooms remain intact)", async () => {
      const seed1 = crypto.getRandomValues(new Uint8Array(32));
      const seed2 = crypto.getRandomValues(new Uint8Array(32));

      await storeIdentitySeed("room-a", seed1);
      await storeIdentitySeed("room-b", seed2);

      await clearIdentitySeed("room-a");

      expect(await loadIdentitySeed("room-a")).toBeNull();

      const loaded2 = await loadIdentitySeed("room-b");
      expect(loaded2).not.toBeNull();
      expect(Array.from(new Uint8Array(loaded2!))).toEqual(Array.from(seed2));
    });
  });

  describe("getOrCreateDeviceKey", () => {
    it("creates a 32-byte key on first call", () => {
      const key = getOrCreateDeviceKey();

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it("returns the same key on subsequent calls (deterministic)", () => {
      const key1 = getOrCreateDeviceKey();
      const key2 = getOrCreateDeviceKey();

      expect(Array.from(key1)).toEqual(Array.from(key2));
    });

    it("stores the key in localStorage under 'weave-device-key'", () => {
      const key = getOrCreateDeviceKey();

      const stored = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
      expect(stored).not.toBeNull();

      // Decode and verify it matches what was returned
      const decoded = Uint8Array.from(atob(stored!), (c) => c.charCodeAt(0));
      expect(Array.from(decoded)).toEqual(Array.from(key));
    });

    it("creates a new key if stored key is corrupted (wrong length)", () => {
      // Store a base64 value that decodes to an incorrect length
      const shortKey = new Uint8Array(16); // 16 bytes, not 32
      localStorage.setItem(
        DEVICE_KEY_STORAGE_KEY,
        btoa(String.fromCharCode(...shortKey)),
      );

      const key = getOrCreateDeviceKey();

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);

      // The corrupted stored value should have been replaced
      const stored = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
      const decoded = Uint8Array.from(atob(stored!), (c) => c.charCodeAt(0));
      expect(decoded.length).toBe(32);
    });
  });

  describe("database setup", () => {
    it("creates the database with correct name, version, and store structure", async () => {
      // Trigger database creation via a real operation
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room-init", seed);

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Failed to open DB"));
      });

      expect(db.name).toBe(DB_NAME);
      expect(db.version).toBe(DB_VERSION);
      expect(db.objectStoreNames.contains(STORE_NAME)).toBe(true);

      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      expect(store.keyPath).toBe("roomId");

      db.close();
    });

    it("openIdentityDB resolves with an IDBDatabase instance", async () => {
      const db = await openIdentityDB();

      expect(db).toBeDefined();
      expect(typeof db.transaction).toBe("function");
      expect(db.name).toBe(DB_NAME);
      expect(db.version).toBe(DB_VERSION);

      db.close();
    });
  });

  describe("multiple rooms", () => {
    it("stores and loads seeds for multiple rooms independently", async () => {
      const seed1 = crypto.getRandomValues(new Uint8Array(32));
      const seed2 = crypto.getRandomValues(new Uint8Array(32));
      const seed3 = crypto.getRandomValues(new Uint8Array(32));

      await storeIdentitySeed("room-m1", seed1);
      await storeIdentitySeed("room-m2", seed2);
      await storeIdentitySeed("room-m3", seed3);

      const loaded1 = await loadIdentitySeed("room-m1");
      const loaded2 = await loadIdentitySeed("room-m2");
      const loaded3 = await loadIdentitySeed("room-m3");

      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(loaded3).not.toBeNull();

      expect(Array.from(new Uint8Array(loaded1!))).toEqual(Array.from(seed1));
      expect(Array.from(new Uint8Array(loaded2!))).toEqual(Array.from(seed2));
      expect(Array.from(new Uint8Array(loaded3!))).toEqual(Array.from(seed3));
    });
  });
});
