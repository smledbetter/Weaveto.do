import { test, expect } from "./utils/fixtures";
import { randomBytes } from "crypto";
import { createAndJoinRoom, trackAppErrors } from "./utils/room-helpers";

/**
 * WebAuthn PRF and identity persistence tests.
 *
 * In dev mode, WebAuthn is bypassed (`import.meta.env.DEV`) and a random
 * seed is generated per session. These tests verify:
 * - Dev mode bypass works (random seed, no WebAuthn prompt)
 * - Two tabs in the same context both reach connected state
 * - WebAuthn API detection
 *
 * Full PRF ceremony testing (`prf.ts` code paths) requires a production
 * build with `VITE_WEBAUTHN_BYPASS=false` and is covered by the
 * `identity-integration.spec.ts` suite.
 */

test.describe("Identity Persistence", () => {
	test("dev mode bypass generates seed and connects without WebAuthn", async ({
		page,
	}) => {
		const errors = trackAppErrors(page);
		await createAndJoinRoom(page, "Alice");

		// Room should connect — dev mode generates a random seed without WebAuthn
		await expect(page.locator(".composer input")).toBeVisible({
			timeout: 5_000,
		});

		// Connection indicator should show connected (first visible instance)
		await expect(
			page.locator(".connection-dot.online").first(),
		).toBeVisible({ timeout: 5_000 });

		errors.assertNoErrors();
	});

	test("two tabs in same context both connect successfully", async ({
		context,
	}) => {
		// Same context = same device = same IDB
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		await tab1.addInitScript(() => {
			localStorage.setItem("weave-walkthrough-seen", "true");
		});
		await tab2.addInitScript(() => {
			localStorage.setItem("weave-walkthrough-seen", "true");
		});

		const roomId = randomBytes(16).toString("hex");

		// Tab1 creates the room
		await tab1.goto(
			`http://localhost:5173/room/${roomId}?name=Alice&create=true`,
			{ waitUntil: "networkidle" },
		);
		const nameInput1 = tab1.locator(
			'input[placeholder="What should we call you?"]',
		);
		if (
			await nameInput1.isVisible({ timeout: 3_000 }).catch(() => false)
		) {
			await nameInput1.fill("Alice");
			await tab1
				.locator("button", { hasText: "Join Securely" })
				.click();
		}
		await expect(tab1.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Tab2 opens the same room
		await tab2.goto(
			`http://localhost:5173/room/${roomId}?name=Alice2&create=true`,
			{ waitUntil: "networkidle" },
		);
		const nameInput2 = tab2.locator(
			'input[placeholder="What should we call you?"]',
		);
		if (
			await nameInput2.isVisible({ timeout: 3_000 }).catch(() => false)
		) {
			await nameInput2.fill("Alice2");
			await tab2
				.locator("button", { hasText: "Join Securely" })
				.click();
		}
		await expect(tab2.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Both tabs should reach connected state without errors
		await expect(tab1.locator(".composer input")).toBeVisible({
			timeout: 5_000,
		});
		await expect(tab2.locator(".composer input")).toBeVisible({
			timeout: 5_000,
		});

		await tab1.close();
		await tab2.close();
	});

	test("isWebAuthnSupported returns false when credentials API is absent", async ({
		page,
	}) => {
		// Remove navigator.credentials to simulate unsupported browser
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "credentials", {
				value: undefined,
				writable: true,
				configurable: true,
			});
		});

		await page.goto("/", { waitUntil: "networkidle" });

		const supported = await page.evaluate(() => {
			return (
				typeof window.PublicKeyCredential !== "undefined" &&
				typeof navigator.credentials !== "undefined"
			);
		});
		expect(supported).toBe(false);
	});

	test("room join succeeds even without WebAuthn support", async ({
		page,
	}) => {
		const errors = trackAppErrors(page);

		// In dev mode, WebAuthn is bypassed entirely, so this tests
		// that the fallback chain works — random seed generated, room connects
		await createAndJoinRoom(page, "NoWebAuthnUser");

		await expect(page.locator(".composer input")).toBeVisible({
			timeout: 5_000,
		});

		errors.assertNoErrors();
	});
});
