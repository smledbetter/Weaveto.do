import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  storePinKey,
  loadPinKey,
  clearPinKey,
  deriveWrappingKey,
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
} from "$lib/pin/store";
import {
  derivePinKey,
  generatePinSalt,
  hashPinKey,
  derivePinKeyRaw,
} from "$lib/pin/derive";

describe("PIN Storage", () => {
  beforeEach(() => {
    // Reset IndexedDB between tests
    globalThis.indexedDB = new IDBFactory();
  });

  describe("storePinKey + loadPinKey", () => {
    it("round-trips a PIN key successfully", async () => {
      const roomId = "room-abc";
      const pin = "123456";
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      await storePinKey(roomId, pinKey, salt, keyHash, prfSeed);
      const loaded = await loadPinKey(roomId, prfSeed);

      expect(loaded).not.toBeNull();
      expect(new Uint8Array(loaded!.salt)).toEqual(salt);
      expect(new Uint8Array(loaded!.keyHash)).toEqual(keyHash);

      // Verify the loaded key can decrypt data encrypted with the original key
      const testData = new TextEncoder().encode("test data");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        pinKey,
        testData,
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        loaded!.pinKey,
        encrypted,
      );

      expect(Array.from(new Uint8Array(decrypted))).toEqual(
        Array.from(testData),
      );
    });

    it("returns null for non-existent room", async () => {
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));
      const loaded = await loadPinKey("room-nonexistent", prfSeed);

      expect(loaded).toBeNull();
    });

    it("stores encrypted key (raw bytes differ from original)", async () => {
      const roomId = "room-xyz";
      const pin = "999999";
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      await storePinKey(roomId, pinKey, salt, keyHash, prfSeed);

      // Manually read the stored record to verify encryption
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
      // fake-indexeddb returns objects that look like Uint8Array but aren't strict instances
      const encryptedKey = new Uint8Array(record.encryptedKey);
      const iv = new Uint8Array(record.iv);
      expect(encryptedKey).toBeInstanceOf(Uint8Array);
      expect(encryptedKey).not.toEqual(rawKey);
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.length).toBe(12); // AES-GCM 96-bit IV
    });

    it("fails to load with wrong PRF seed", async () => {
      const roomId = "room-wrong-seed";
      const pin = "111111";
      const prfSeed1 = crypto.getRandomValues(new Uint8Array(32));
      const prfSeed2 = crypto.getRandomValues(new Uint8Array(32));
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      await storePinKey(roomId, pinKey, salt, keyHash, prfSeed1);

      // Try to load with a different PRF seed (should fail decryption)
      await expect(loadPinKey(roomId, prfSeed2)).rejects.toThrow();
    });
  });

  describe("clearPinKey", () => {
    it("removes the stored key", async () => {
      const roomId = "room-to-clear";
      const pin = "777777";
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      await storePinKey(roomId, pinKey, salt, keyHash, prfSeed);
      expect(await loadPinKey(roomId, prfSeed)).not.toBeNull();

      await clearPinKey(roomId);
      expect(await loadPinKey(roomId, prfSeed)).toBeNull();
    });

    it("succeeds even if key does not exist", async () => {
      await expect(clearPinKey("room-never-existed")).resolves.not.toThrow();
    });
  });

  describe("deriveWrappingKey", () => {
    it("derives a 256-bit AES-GCM key from PRF seed", async () => {
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));
      const wrappingKey = await deriveWrappingKey(prfSeed);

      expect(wrappingKey).toBeInstanceOf(CryptoKey);
      expect(wrappingKey.type).toBe("secret");
      expect(wrappingKey.algorithm).toEqual({ name: "AES-GCM", length: 256 });
      expect(wrappingKey.usages).toEqual(
        expect.arrayContaining(["encrypt", "decrypt"]),
      );
    });

    it("derives deterministic keys (same seed = same key)", async () => {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const prfSeed = seed;
      const pin = "123456";
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      // Store with the same seed twice and verify we can decrypt both times
      await storePinKey("room-1", pinKey, salt, keyHash, prfSeed);
      const loaded1 = await loadPinKey("room-1", prfSeed);

      await clearPinKey("room-1");
      await storePinKey("room-1", pinKey, salt, keyHash, prfSeed);
      const loaded2 = await loadPinKey("room-1", prfSeed);

      // If the wrapping key is deterministic, both loads should succeed with same PRF seed
      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
    });

    it("derives different keys for different seeds", async () => {
      const seed1 = crypto.getRandomValues(new Uint8Array(32));
      const seed2 = crypto.getRandomValues(new Uint8Array(32));
      const pin = "123456";
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      // Store with seed1
      await storePinKey("room-diff", pinKey, salt, keyHash, seed1);

      // Try to load with seed2 (should fail because different wrapping key)
      await expect(loadPinKey("room-diff", seed2)).rejects.toThrow();
    });
  });

  describe("database setup", () => {
    it("creates the database with correct structure", async () => {
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));
      const pin = "123456";
      const salt = generatePinSalt();
      const pinKey = await derivePinKey(pin, salt);
      const rawKey = await derivePinKeyRaw(pin, salt);
      const keyHash = await hashPinKey(rawKey);

      // Trigger database creation
      await storePinKey("room-init", pinKey, salt, keyHash, prfSeed);

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
  });

  describe("multiple rooms", () => {
    it("stores and retrieves keys for multiple rooms independently", async () => {
      const prfSeed = crypto.getRandomValues(new Uint8Array(32));

      // Room 1
      const pin1 = "111111";
      const salt1 = generatePinSalt();
      const pinKey1 = await derivePinKey(pin1, salt1);
      const rawKey1 = await derivePinKeyRaw(pin1, salt1);
      const keyHash1 = await hashPinKey(rawKey1);
      await storePinKey("room-1", pinKey1, salt1, keyHash1, prfSeed);

      // Room 2
      const pin2 = "222222";
      const salt2 = generatePinSalt();
      const pinKey2 = await derivePinKey(pin2, salt2);
      const rawKey2 = await derivePinKeyRaw(pin2, salt2);
      const keyHash2 = await hashPinKey(rawKey2);
      await storePinKey("room-2", pinKey2, salt2, keyHash2, prfSeed);

      // Load both
      const loaded1 = await loadPinKey("room-1", prfSeed);
      const loaded2 = await loadPinKey("room-2", prfSeed);

      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(new Uint8Array(loaded1!.salt)).toEqual(salt1);
      expect(new Uint8Array(loaded2!.salt)).toEqual(salt2);
      expect(new Uint8Array(loaded1!.keyHash)).toEqual(keyHash1);
      expect(new Uint8Array(loaded2!.keyHash)).toEqual(keyHash2);
    });
  });
});
