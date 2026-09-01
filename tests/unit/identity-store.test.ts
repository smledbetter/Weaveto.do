import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  openIdentityDB,
  storeIdentitySeed,
  loadIdentitySeed,
  clearIdentitySeed,
  hasStoredIdentitySeed,
  purgeLegacyDeviceKey,
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
} from "$lib/identity/store";

/**
 * An identity seed is wrapped by a key derived from a PIN and never stored.
 *
 * The previous scheme wrapped it with a random key kept in localStorage,
 * beside the data it wrapped. Anything that could read one could read the
 * other, so the encryption raised the bar against a copied database file and
 * against nothing else, while reading as though the seed were protected.
 *
 * Storing anything here is the exception. On a device with WebAuthn PRF the
 * seed comes from the authenticator every session and nothing is written down.
 * This path is the fallback, and it is opt-in.
 */

const LEGACY_DEVICE_KEY = "weave-device-key";
const PIN = "314159";
const OTHER_PIN = "271828";

/** PBKDF2 at 600k iterations is slow on purpose, so these need headroom. */
const SLOW = 20_000;

describe("Identity Seed Storage", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
  });

  describe("storeIdentitySeed + loadIdentitySeed", () => {
    it("round-trips a 32-byte seed", async () => {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room1", seed, PIN);
      expect(await loadIdentitySeed("room1", PIN)).toEqual(seed);
    }, SLOW);

    it("returns null for a room with nothing stored", async () => {
      expect(await loadIdentitySeed("never-used", PIN)).toBeNull();
    }, SLOW);

    it("returns null for the wrong PIN, rather than throwing", async () => {
      // The join flow falls through to a session identity on null. A throw
      // here would surface as a failed join instead of a new identity.
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room1", seed, PIN);
      expect(await loadIdentitySeed("room1", OTHER_PIN)).toBeNull();
    }, SLOW);

    it("stores ciphertext, not the seed", async () => {
      const seed = new Uint8Array(32).fill(7);
      await storeIdentitySeed("room1", seed, PIN);

      const db = await openIdentityDB();
      const record = await new Promise<Record<string, Uint8Array>>((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get("room1");
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
      });

      const stored = new Uint8Array(record.encryptedSeed);
      expect(stored).not.toEqual(seed);
      expect(stored.every((b) => b === 7)).toBe(false);
    }, SLOW);

    it("keeps no key beside the data", async () => {
      // The whole point. After storing, there must be nothing on this device
      // that opens the record without the PIN.
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room1", seed, PIN);
      expect(localStorage.length).toBe(0);
    }, SLOW);

    it("salts each record, so the same PIN and seed store differently", async () => {
      const seed = new Uint8Array(32).fill(3);
      await storeIdentitySeed("roomA", seed, PIN);
      await storeIdentitySeed("roomB", seed, PIN);

      const db = await openIdentityDB();
      const read = (id: string) =>
        new Promise<Record<string, Uint8Array>>((resolve) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const req = tx.objectStore(STORE_NAME).get(id);
          req.onsuccess = () => resolve(req.result);
        });
      const a = await read("roomA");
      const b = await read("roomB");
      db.close();

      expect(new Uint8Array(a.salt)).not.toEqual(new Uint8Array(b.salt));
      expect(new Uint8Array(a.encryptedSeed)).not.toEqual(
        new Uint8Array(b.encryptedSeed),
      );
    }, SLOW);

    it("overwrites the record for the same room, so a PIN can be changed", async () => {
      const first = new Uint8Array(32).fill(1);
      const second = new Uint8Array(32).fill(2);
      await storeIdentitySeed("room1", first, PIN);
      await storeIdentitySeed("room1", second, OTHER_PIN);

      expect(await loadIdentitySeed("room1", OTHER_PIN)).toEqual(second);
      expect(await loadIdentitySeed("room1", PIN)).toBeNull();
    }, SLOW);
  });

  describe("hasStoredIdentitySeed", () => {
    it("reports a saved identity without needing the PIN", async () => {
      // The join form has to know whether to ask for a PIN before it has one.
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room1", seed, PIN);
      expect(await hasStoredIdentitySeed("room1")).toBe(true);
    }, SLOW);

    it("is false when nothing was saved", async () => {
      expect(await hasStoredIdentitySeed("room1")).toBe(false);
    });

    it("is false for a different room", async () => {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room1", seed, PIN);
      expect(await hasStoredIdentitySeed("room2")).toBe(false);
    }, SLOW);
  });

  describe("purgeLegacyDeviceKey", () => {
    it("removes the wrapping key the old scheme left behind", () => {
      localStorage.setItem(LEGACY_DEVICE_KEY, "AAAA");
      purgeLegacyDeviceKey();
      expect(localStorage.getItem(LEGACY_DEVICE_KEY)).toBeNull();
    });

    it("does nothing when there is none", () => {
      expect(() => purgeLegacyDeviceKey()).not.toThrow();
    });

    it("leaves unrelated keys alone", () => {
      localStorage.setItem("weave-theme", "dark");
      purgeLegacyDeviceKey();
      expect(localStorage.getItem("weave-theme")).toBe("dark");
    });
  });

  describe("clearIdentitySeed", () => {
    it("removes the stored seed", async () => {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("room1", seed, PIN);
      await clearIdentitySeed("room1");
      expect(await loadIdentitySeed("room1", PIN)).toBeNull();
    }, SLOW);

    it("succeeds when the record does not exist", async () => {
      await expect(clearIdentitySeed("nope")).resolves.toBeUndefined();
    });

    it("only clears the room it is given", async () => {
      const a = new Uint8Array(32).fill(1);
      const b = new Uint8Array(32).fill(2);
      await storeIdentitySeed("roomA", a, PIN);
      await storeIdentitySeed("roomB", b, PIN);
      await clearIdentitySeed("roomA");

      expect(await loadIdentitySeed("roomA", PIN)).toBeNull();
      expect(await loadIdentitySeed("roomB", PIN)).toEqual(b);
    }, SLOW);
  });

  describe("database setup", () => {
    it("creates the store at the current version", async () => {
      const db = await openIdentityDB();
      expect(db.name).toBe(DB_NAME);
      expect(db.version).toBe(DB_VERSION);
      expect(db.objectStoreNames.contains(STORE_NAME)).toBe(true);
      db.close();
    });

    it("drops records written under the old wrapping", async () => {
      // They are sealed by a key this version deletes, so they could never be
      // opened again. Keeping them would be keeping dead key material.
      const legacy = indexedDB.open(DB_NAME, 1);
      await new Promise<void>((resolve) => {
        legacy.onupgradeneeded = () => {
          legacy.result.createObjectStore(STORE_NAME, { keyPath: "roomId" });
        };
        legacy.onsuccess = () => {
          const db = legacy.result;
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put({
            roomId: "old",
            encryptedSeed: new Uint8Array([1, 2, 3]),
            iv: new Uint8Array(12),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });

      expect(await hasStoredIdentitySeed("old")).toBe(false);
    });
  });

  describe("multiple rooms", () => {
    it("keeps seeds independent", async () => {
      const a = crypto.getRandomValues(new Uint8Array(32));
      const b = crypto.getRandomValues(new Uint8Array(32));
      await storeIdentitySeed("roomA", a, PIN);
      await storeIdentitySeed("roomB", b, PIN);

      expect(await loadIdentitySeed("roomA", PIN)).toEqual(a);
      expect(await loadIdentitySeed("roomB", PIN)).toEqual(b);
    }, SLOW);
  });
});
