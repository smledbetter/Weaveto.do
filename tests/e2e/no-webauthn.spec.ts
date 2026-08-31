import { test, expect } from "@playwright/test";

/**
 * Browsers without WebAuthn must still be able to create a room.
 *
 * The homepage gated its only entry point on `isWebAuthnSupported()`, which
 * checks whether `PublicKeyCredential` exists. When WebAuthn is bypassed the
 * app derives a random seed instead and works fine without it, so the gate was
 * stricter than the actual requirement: any browser lacking the API saw the
 * "unsupported" notice and had no way to proceed.
 *
 * This went unnoticed locally because macOS WebKit exposes the API. Headless
 * WebKit on Linux does not, so eight mobile-iphone tests failed the first time
 * CI ran them — none of them about WebAuthn.
 */
test.describe("Browser without WebAuthn", () => {
	test.beforeEach(async ({ page }) => {
		// Reproduce the CI environment: no PublicKeyCredential at all.
		await page.addInitScript(() => {
			// @ts-expect-error deliberately removing a platform global
			delete window.PublicKeyCredential;
		});
	});

	test("can still reach the New Room button", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });

		await expect(
			page.evaluate(() => typeof (window as never as Record<string, unknown>).PublicKeyCredential),
		).resolves.toBe("undefined");

		await expect(page.locator("button", { hasText: "New Room" })).toBeVisible({
			timeout: 10_000,
		});
	});

	test("does not show the unsupported-browser dead end", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await expect(page.locator(".unsupported")).not.toBeVisible();
	});

	test("can create and join a room end to end", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("button", { hasText: "New Room" }).click();

		const nameInput = page.locator('input[placeholder="What should we call you?"]');
		await expect(nameInput).toBeVisible({ timeout: 10_000 });
		await nameInput.fill("NoWebAuthn");
		await page.locator("button", { hasText: "Join Securely" }).click();

		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});
	});
});
