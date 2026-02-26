import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { dismissOverlays } from "./room-helpers";

/**
 * Create a fresh browser context with walkthrough suppressed.
 * Each context is fully isolated (IndexedDB, localStorage, credentials)
 * — equivalent to a separate device.
 */
export async function newDeviceContext(browser: Browser): Promise<BrowserContext> {
	const ctx = await browser.newContext();
	await ctx.addInitScript(() => {
		localStorage.setItem("weave-walkthrough-seen", "true");
	});
	return ctx;
}

/**
 * Join an existing room as a new member (strips ?create param).
 * Fills in the name input and waits for the room header to appear.
 */
export async function joinExistingRoom(
	page: Page,
	roomUrl: string,
	name: string,
): Promise<void> {
	const joinUrl = roomUrl.replace(/[?&]create[^&]*/g, "").replace(/[?&]+$/, "");
	await page.goto(joinUrl, { waitUntil: "networkidle" });
	await dismissOverlays(page);

	const nameInput = page.locator('input[placeholder="What should we call you?"]');
	if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
		await nameInput.fill(name);
		await page.locator("button", { hasText: "Join Securely" }).click();
	}

	await expect(page.locator("header .room-info h2")).not.toBeEmpty({
		timeout: 15_000,
	});
	await dismissOverlays(page);
}
