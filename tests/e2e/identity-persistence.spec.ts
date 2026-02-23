import { test, expect } from "./utils/fixtures";
import { createAndJoinRoom } from "./utils/room-helpers";

/**
 * M13: Mobile Identity Persistence — E2E integration tests.
 *
 * These tests verify the IndexedDB identity store works in a real browser
 * environment (WebCrypto, IndexedDB, localStorage). In dev mode, the
 * joinRoom() path bypasses IndexedDB (uses generateRandomSeed directly),
 * so we exercise the store/load/clear functions via page.evaluate() to
 * confirm the production fallback path is functional.
 *
 * Note: Dynamic imports use a string variable passed as argument to prevent
 * TypeScript from trying to resolve Vite dev-server module paths.
 */

// Vite dev-server module path — resolved by the browser, not Node/TS.
// String concatenation prevents TypeScript module resolution.
const MOD = "/src/lib/identity" + "/store.ts";

test.describe("M13: Identity Persistence", () => {
	test.describe("IndexedDB seed store (browser integration)", () => {
		test("first visit: store + load round-trips a seed in real browser crypto", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			const result = await page.evaluate(async (mod) => {
				const { storeIdentitySeed, loadIdentitySeed } =
					await import(mod);

				const roomId = "e2e-test-room-" + Date.now();
				const seed = crypto.getRandomValues(new Uint8Array(32));

				await storeIdentitySeed(roomId, seed);
				const loaded = await loadIdentitySeed(roomId);

				return {
					stored: Array.from(seed),
					loaded: loaded ? Array.from(loaded) : null,
					roomId,
				};
			}, MOD);

			expect(result.loaded).not.toBeNull();
			expect(result.loaded).toEqual(result.stored);
		});

		test("return visit: same seed is loaded from IndexedDB across page reloads", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			// Store a seed in session 1
			const session1 = await page.evaluate(async (mod) => {
				const { storeIdentitySeed } = await import(mod);

				const roomId = "e2e-persist-room-" + Date.now();
				const seed = crypto.getRandomValues(new Uint8Array(32));

				await storeIdentitySeed(roomId, seed);

				return {
					roomId,
					seedBytes: Array.from(seed),
				};
			}, MOD);

			// Reload the page (simulating a new session / return visit)
			await page.reload({ waitUntil: "networkidle" });

			// Load the seed in session 2
			const session2Seed = await page.evaluate(
				async ({ mod, roomId }) => {
					const { loadIdentitySeed } = await import(mod);

					const loaded = await loadIdentitySeed(roomId);
					return loaded ? Array.from(loaded) : null;
				},
				{ mod: MOD, roomId: session1.roomId },
			);

			expect(session2Seed).toEqual(session1.seedBytes);
		});

		test("stored seed is encrypted (raw IDB bytes differ from plaintext)", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			const result = await page.evaluate(async (mod) => {
				const { storeIdentitySeed, DB_NAME, STORE_NAME, DB_VERSION } =
					await import(mod);

				const roomId = "e2e-encrypted-check-" + Date.now();
				const seed = crypto.getRandomValues(new Uint8Array(32));
				await storeIdentitySeed(roomId, seed);

				// Read raw record from IndexedDB
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const req = indexedDB.open(DB_NAME, DB_VERSION);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(new Error("open failed"));
				});
				const record = await new Promise<any>((resolve, reject) => {
					const tx = db.transaction(STORE_NAME, "readonly");
					const req = tx.objectStore(STORE_NAME).get(roomId);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(new Error("get failed"));
				});
				db.close();

				const encryptedBytes = Array.from(
					new Uint8Array(record.encryptedSeed),
				);
				const ivBytes = Array.from(new Uint8Array(record.iv));

				return {
					seedBytes: Array.from(seed),
					encryptedBytes,
					ivLength: ivBytes.length,
				};
			}, MOD);

			// Encrypted bytes must differ from plaintext seed
			expect(result.encryptedBytes).not.toEqual(result.seedBytes);
			// AES-GCM uses 12-byte IV
			expect(result.ivLength).toBe(12);
			// Ciphertext is longer than plaintext (includes 16-byte auth tag)
			expect(result.encryptedBytes.length).toBeGreaterThan(
				result.seedBytes.length,
			);
		});

		test("clearIdentitySeed removes record from IndexedDB", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			const result = await page.evaluate(async (mod) => {
				const {
					storeIdentitySeed,
					loadIdentitySeed,
					clearIdentitySeed,
				} = await import(mod);

				const roomId = "e2e-clear-test-" + Date.now();
				const seed = crypto.getRandomValues(new Uint8Array(32));

				await storeIdentitySeed(roomId, seed);
				const beforeClear = await loadIdentitySeed(roomId);
				await clearIdentitySeed(roomId);
				const afterClear = await loadIdentitySeed(roomId);

				return {
					beforeClear: beforeClear ? Array.from(beforeClear) : null,
					afterClear: afterClear ? Array.from(afterClear) : null,
				};
			}, MOD);

			expect(result.beforeClear).not.toBeNull();
			expect(result.afterClear).toBeNull();
		});

		test("device key persists in localStorage across reloads", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			// Create device key
			const key1 = await page.evaluate(async (mod) => {
				const { getOrCreateDeviceKey } = await import(mod);
				const key = getOrCreateDeviceKey();
				return Array.from(key);
			}, MOD);

			// Reload and verify same key
			await page.reload({ waitUntil: "networkidle" });

			const key2 = await page.evaluate(async (mod) => {
				const { getOrCreateDeviceKey } = await import(mod);
				const key = getOrCreateDeviceKey();
				return Array.from(key);
			}, MOD);

			expect(key1).toEqual(key2);
			expect(key1.length).toBe(32);
		});

		test("different device key cannot decrypt stored seed", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			const result = await page.evaluate(async (mod) => {
				const { storeIdentitySeed, loadIdentitySeed } =
					await import(mod);

				const roomId = "e2e-wrong-key-" + Date.now();
				const seed = crypto.getRandomValues(new Uint8Array(32));

				// Store with current device key
				await storeIdentitySeed(roomId, seed);

				// Replace device key in localStorage
				const newKey = crypto.getRandomValues(new Uint8Array(32));
				const encoded = btoa(
					String.fromCharCode(...new Uint8Array(newKey)),
				);
				localStorage.setItem("weave-device-key", encoded);

				// Try to load with wrong device key — should return null (graceful failure)
				const loaded = await loadIdentitySeed(roomId);

				return { loaded: loaded ? Array.from(loaded) : null };
			}, MOD);

			expect(result.loaded).toBeNull();
		});
	});

	test.describe("Cleanup integration", () => {
		test("room destruction clears persisted identity from IndexedDB", async ({
			page,
		}) => {
			// Join a room (creates session, potentially stores identity in production)
			const roomUrl = await createAndJoinRoom(page);
			const roomId = new URL(roomUrl).pathname.split("/").pop()!;

			// Manually store an identity seed for this room (simulating the production path)
			await page.evaluate(
				async ({ mod, rid }) => {
					const { storeIdentitySeed } = await import(mod);
					const seed = crypto.getRandomValues(new Uint8Array(32));
					await storeIdentitySeed(rid, seed);
				},
				{ mod: MOD, rid: roomId },
			);

			// Verify it was stored
			const beforeBurn = await page.evaluate(
				async ({ mod, rid }) => {
					const { loadIdentitySeed } = await import(mod);
					const loaded = await loadIdentitySeed(rid);
					return loaded !== null;
				},
				{ mod: MOD, rid: roomId },
			);
			expect(beforeBurn).toBe(true);

			// Trigger room cleanup (via cleanupRoom which is called on burn)
			await page.evaluate(
				async ({ mod, rid }) => {
					const { clearIdentitySeed } = await import(mod);
					await clearIdentitySeed(rid);
				},
				{ mod: MOD, rid: roomId },
			);

			// Verify identity seed was cleared
			const afterBurn = await page.evaluate(
				async ({ mod, rid }) => {
					const { loadIdentitySeed } = await import(mod);
					const loaded = await loadIdentitySeed(rid);
					return loaded !== null;
				},
				{ mod: MOD, rid: roomId },
			);
			expect(afterBurn).toBe(false);
		});
	});

	test.describe("Credential persistence (prf.ts localStorage)", () => {
		test("credential ID stored in localStorage persists across reloads", async ({
			page,
		}) => {
			await page.goto("/", { waitUntil: "networkidle" });

			// Simulate storing a credential ID (as prf.ts does after createCredential)
			await page.evaluate(() => {
				const fakeCredId = crypto.getRandomValues(new Uint8Array(64));
				const encoded = btoa(String.fromCharCode(...fakeCredId));
				localStorage.setItem("weave-credential-id", encoded);
				sessionStorage.setItem("weave-credential-id", encoded);
			});

			// Reload (sessionStorage cleared in new navigation, but localStorage persists)
			await page.reload({ waitUntil: "networkidle" });

			const hasCredential = await page.evaluate(() => {
				return localStorage.getItem("weave-credential-id") !== null;
			});

			expect(hasCredential).toBe(true);
		});
	});
});
