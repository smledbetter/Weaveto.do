import { test as base, expect } from "@playwright/test";

/**
 * Identity on a device that cannot use a security key.
 *
 * These run against a PRODUCTION BUILD (preview server on port 4173) where
 * import.meta.env.DEV is false, so joinRoom() takes the real WebAuthn path.
 * WebAuthn is patched to throw, which is what an iOS Safari or older Android
 * device looks like from here.
 *
 * The behaviour under test changed. It used to be that a device without PRF
 * silently generated a seed and wrote it to IndexedDB, wrapped by a random key
 * kept in localStorage beside it. Nobody was asked, and the wrapping protected
 * against a copied database file and nothing else.
 *
 * Now nothing is written unless the person asks for it and chooses a PIN, and
 * the PIN-derived key is never stored. So the interesting cases are: a first
 * visit stores nothing, opting in stores something only after a PIN, the right
 * PIN restores the identity, and the wrong PIN does not wedge the room.
 *
 * Run: npx playwright test identity-integration --config playwright-preview.config.ts
 */

const PIN = "246810";
const WRONG_PIN = "999999";

const test = base.extend({
	page: async ({ page }, use) => {
		await page.addInitScript(() => {
			localStorage.setItem("weave-walkthrough-seen", "true");

			// Simulate a device without WebAuthn PRF support.
			const origCredentials = navigator.credentials;
			Object.defineProperty(navigator, "credentials", {
				get() {
					return {
						...origCredentials,
						create: () =>
							Promise.reject(new Error("WebAuthn not supported (test mock)")),
						get: () =>
							Promise.reject(new Error("WebAuthn not supported (test mock)")),
					};
				},
				configurable: true,
			});
		});
		await use(page);
	},
});

/** Whether this room has a seed record, read straight out of IndexedDB. */
async function storedSeedExists(page: import("@playwright/test").Page, roomId: string) {
	return page.evaluate(async (rid) => {
		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open("weave-identity");
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		});
		if (!db) return false;
		if (!db.objectStoreNames.contains("seeds")) {
			db.close();
			return false;
		}
		const record = await new Promise<unknown>((resolve) => {
			const tx = db.transaction("seeds", "readonly");
			const req = tx.objectStore("seeds").get(rid);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		});
		db.close();
		return record !== null && record !== undefined;
	}, roomId);
}

/** Create a room, join it as `name`, and return its id. */
async function createAndJoin(
	page: import("@playwright/test").Page,
	name: string,
) {
	await page.goto("/", { waitUntil: "networkidle" });
	await page.locator("button", { hasText: "New Room" }).click();
	await expect(
		page.locator('input[placeholder="What should we call you?"]'),
	).toBeVisible({ timeout: 10_000 });

	const roomId = new URL(page.url()).pathname.split("/").pop()!;
	await page.locator('input[placeholder="What should we call you?"]').fill(name);
	await page.locator("button", { hasText: "Join Securely" }).click();
	await expect(page.locator("header .room-info h2")).not.toBeEmpty({
		timeout: 15_000,
	});
	return roomId;
}

test.describe("Identity on a device without a security key", () => {
	test("a first visit stores nothing and says so", async ({ page }) => {
		const roomId = await createAndJoin(page, "MobileUser");

		expect(
			await storedSeedExists(page, roomId),
			"nothing may be written to this device without being asked",
		).toBe(false);

		// The person is told, rather than left to assume their identity lasts.
		await expect(page.locator(".temp-identity")).toBeVisible({
			timeout: 5_000,
		});
		await expect(page.locator(".temp-identity")).toContainText(
			"this session only",
		);
	});

	test("opting in stores the identity, and only after a PIN", async ({
		page,
	}) => {
		const roomId = await createAndJoin(page, "MobileUser");

		await page.locator("button", { hasText: "Keep me on this device" }).click();
		// Still nothing stored: asking is not the same as confirming.
		expect(await storedSeedExists(page, roomId)).toBe(false);

		await page
			.locator('input[aria-label="PIN to protect your identity on this device"]')
			.fill(PIN);
		await page.locator("button", { hasText: "Save" }).click();

		await expect
			.poll(() => storedSeedExists(page, roomId), { timeout: 10_000 })
			.toBe(true);
	});

	test("the wrapping key is not left on the device", async ({ page }) => {
		// The point of the change. A key beside the data it wraps protects
		// against a copied database file and nothing else.
		const roomId = await createAndJoin(page, "MobileUser");
		await page.locator("button", { hasText: "Keep me on this device" }).click();
		await page
			.locator('input[aria-label="PIN to protect your identity on this device"]')
			.fill(PIN);
		await page.locator("button", { hasText: "Save" }).click();
		await expect
			.poll(() => storedSeedExists(page, roomId), { timeout: 10_000 })
			.toBe(true);

		const leftBehind = await page.evaluate(() =>
			localStorage.getItem("weave-device-key"),
		);
		expect(leftBehind).toBeNull();
	});

	test("the right PIN brings the same identity back", async ({ page }) => {
		const roomId = await createAndJoin(page, "MobileUser");
		await page.locator("button", { hasText: "Keep me on this device" }).click();
		await page
			.locator('input[aria-label="PIN to protect your identity on this device"]')
			.fill(PIN);
		await page.locator("button", { hasText: "Save" }).click();
		await expect
			.poll(() => storedSeedExists(page, roomId), { timeout: 10_000 })
			.toBe(true);

		// Come back to the same room. The form must now ask for the PIN.
		await page.goto(`/room/${roomId}`, { waitUntil: "networkidle" });
		const pinField = page.locator(
			'input[aria-label="PIN that unlocks your saved identity on this device"]',
		);
		await expect(pinField).toBeVisible({ timeout: 10_000 });

		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("MobileUser");
		await pinField.fill(PIN);
		await page.locator("button", { hasText: "Join Securely" }).click();
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Identity was restored, so this is not a temporary session.
		await expect(page.locator(".temp-identity")).not.toBeVisible({
			timeout: 3_000,
		});
	});

	test("the wrong PIN still lets you in, as someone new", async ({ page }) => {
		// A forgotten PIN must not wedge the room. It costs the identity, which
		// is the stated trade for not keeping a key that could open it.
		const roomId = await createAndJoin(page, "MobileUser");
		await page.locator("button", { hasText: "Keep me on this device" }).click();
		await page
			.locator('input[aria-label="PIN to protect your identity on this device"]')
			.fill(PIN);
		await page.locator("button", { hasText: "Save" }).click();
		await expect
			.poll(() => storedSeedExists(page, roomId), { timeout: 10_000 })
			.toBe(true);

		await page.goto(`/room/${roomId}`, { waitUntil: "networkidle" });
		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("MobileUser");
		await page
			.locator(
				'input[aria-label="PIN that unlocks your saved identity on this device"]',
			)
			.fill(WRONG_PIN);
		await page.locator("button", { hasText: "Join Securely" }).click();

		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});
		await expect(page.locator(".temp-identity")).toBeVisible({
			timeout: 5_000,
		});
	});
});
