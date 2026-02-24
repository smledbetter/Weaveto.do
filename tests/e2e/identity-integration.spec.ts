import { test as base, expect } from "@playwright/test";

/**
 * M13: Identity Persistence — Production integration tests.
 *
 * These tests run against a PRODUCTION BUILD (preview server on port 4173)
 * where import.meta.env.DEV is false, so the joinRoom() function exercises
 * the real PRF → IndexedDB fallback path.
 *
 * WebAuthn is monkey-patched to throw (simulating a non-PRF device like
 * iOS Safari), forcing the IndexedDB identity persistence path.
 *
 * Run: npx playwright test identity-integration --config playwright-preview.config.ts
 */

// Custom test fixture that:
// 1. Dismisses walkthrough
// 2. Patches navigator.credentials to throw (simulates non-PRF device)
const test = base.extend({
	page: async ({ page }, use) => {
		await page.addInitScript(() => {
			// Dismiss walkthrough
			localStorage.setItem("weave-walkthrough-seen", "true");

			// Monkey-patch navigator.credentials to throw — simulates a device
			// without WebAuthn PRF support (iOS Safari, older Android, etc.)
			const origCredentials = navigator.credentials;
			Object.defineProperty(navigator, "credentials", {
				get() {
					return {
						...origCredentials,
						create: () =>
							Promise.reject(
								new Error("WebAuthn not supported (test mock)"),
							),
						get: () =>
							Promise.reject(
								new Error("WebAuthn not supported (test mock)"),
							),
					};
				},
				configurable: true,
			});
		});
		await use(page);
	},
});

test.describe("M13: joinRoom() IndexedDB fallback integration", () => {
	test("first visit without PRF stores identity in IndexedDB", async ({
		page,
	}) => {
		// Navigate to homepage and create a room
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });

		// Extract room ID from URL before joining
		const roomId = new URL(page.url()).pathname.split("/").pop()!;

		// Fill name and join — this triggers joinRoom() which will:
		// 1. Try PRF → throws (our mock)
		// 2. Try loadIdentitySeed → null (first visit)
		// 3. generateRandomSeed → store in IndexedDB
		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("MobileUser");
		await page.locator("button", { hasText: "Join Securely" }).click();

		// Wait for room to load (connecting phase completes)
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Verify identity seed was stored in IndexedDB
		const hasStoredSeed = await page.evaluate(async (rid) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("weave-identity", 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(new Error("open failed"));
			});
			const record = await new Promise<any>((resolve) => {
				const tx = db.transaction("seeds", "readonly");
				const req = tx.objectStore("seeds").get(rid);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			db.close();
			return record !== null && record !== undefined;
		}, roomId);

		expect(hasStoredSeed).toBe(true);

		// Verify the "temporary identity" banner is NOT shown
		// (identity was persisted, so usingTempIdentity should be false)
		await expect(
			page.locator(".temp-identity"),
		).not.toBeVisible({ timeout: 2_000 });
	});

	test("return visit without PRF loads same identity from IndexedDB", async ({
		page,
	}) => {
		// First visit — create room and join
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });

		const roomUrl = page.url();
		const roomId = new URL(roomUrl).pathname.split("/").pop()!;

		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("ReturnUser");
		await page.locator("button", { hasText: "Join Securely" }).click();
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Read the stored seed after first join
		const firstSeed = await page.evaluate(async (rid) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("weave-identity", 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(new Error("open failed"));
			});
			const record = await new Promise<any>((resolve) => {
				const tx = db.transaction("seeds", "readonly");
				const req = tx.objectStore("seeds").get(rid);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			db.close();
			if (!record) return null;

			// Return the encrypted seed bytes for comparison (we can't decrypt here
			// but we can verify the same record is used on return visit)
			return {
				encryptedSeed: Array.from(new Uint8Array(record.encryptedSeed)),
				iv: Array.from(new Uint8Array(record.iv)),
			};
		}, roomId);

		expect(firstSeed).not.toBeNull();

		// Simulate return visit — reload the room URL
		// The page reload clears all in-memory state (Olm sessions, etc.)
		// but IndexedDB and localStorage persist
		await page.goto(roomUrl, { waitUntil: "networkidle" });
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });

		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("ReturnUser");
		await page.locator("button", { hasText: "Join Securely" }).click();
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Read the stored seed after second join — should be same record
		const secondSeed = await page.evaluate(async (rid) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("weave-identity", 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(new Error("open failed"));
			});
			const record = await new Promise<any>((resolve) => {
				const tx = db.transaction("seeds", "readonly");
				const req = tx.objectStore("seeds").get(rid);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			db.close();
			if (!record) return null;
			return {
				encryptedSeed: Array.from(new Uint8Array(record.encryptedSeed)),
				iv: Array.from(new Uint8Array(record.iv)),
			};
		}, roomId);

		// Same encrypted seed record (identity was loaded, not regenerated)
		expect(secondSeed).toEqual(firstSeed);
	});

	test("cleanup removes persisted identity after room destruction", async ({
		page,
	}) => {
		// Create and join room
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });

		const roomId = new URL(page.url()).pathname.split("/").pop()!;

		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("BurnUser");
		await page.locator("button", { hasText: "Join Securely" }).click();
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Verify seed was stored
		const beforeBurn = await page.evaluate(async (rid) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("weave-identity", 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(new Error("open failed"));
			});
			const record = await new Promise<any>((resolve) => {
				const tx = db.transaction("seeds", "readonly");
				const req = tx.objectStore("seeds").get(rid);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			db.close();
			return record !== null && record !== undefined;
		}, roomId);
		expect(beforeBurn).toBe(true);

		// Trigger burn via /burn command
		const chatInput = page.locator(".composer input");
		await chatInput.fill("/burn");
		await chatInput.press("Enter");

		// Confirm burn in modal — type DELETE and click Delete Room
		const confirmInput = page.locator(
			'input[placeholder="Type DELETE to confirm"]',
		);
		await expect(confirmInput).toBeVisible({ timeout: 5_000 });
		await confirmInput.fill("DELETE");
		await page.locator("button", { hasText: "Delete Room" }).click();

		// Wait for navigation away from room (burn redirects to homepage)
		await page.waitForURL("**/", { timeout: 10_000 }).catch(() => {
			// May already be on homepage
		});

		// Verify identity seed was cleared from IndexedDB
		const afterBurn = await page.evaluate(async (rid) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open("weave-identity", 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(new Error("open failed"));
			});
			const record = await new Promise<any>((resolve) => {
				const tx = db.transaction("seeds", "readonly");
				const req = tx.objectStore("seeds").get(rid);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			db.close();
			return record !== null && record !== undefined;
		}, roomId);
		expect(afterBurn).toBe(false);
	});
});
