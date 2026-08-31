import { test, expect } from "@playwright/test";
import { createAndJoinRoom, sendMessage, dismissOverlays } from "./utils/room-helpers";
import { newDeviceContext, joinExistingRoom } from "./utils/context-helpers";

/**
 * Multi-device end-to-end encryption tests.
 *
 * Each `browser.newContext()` is a fully isolated device with its own
 * IndexedDB (vodozemac keys), localStorage, and WebSocket connection.
 * Dev mode bypasses WebAuthn with random seeds, giving each context
 * a unique identity key — equivalent to separate physical devices.
 */

// Serial: each test creates 2-3 browser contexts with WebSocket connections.
// Running them in parallel overwhelms the relay and causes flaky key exchanges.
test.describe.serial("Multi-Device E2E Encryption", () => {
	test("Device A message appears decrypted on Device B", async ({ browser }) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			// Wait for key exchange to complete
			await pageA.waitForTimeout(3_000);

			// Alice sends a message
			await sendMessage(pageA, "hello from Alice");

			// Bob should see it decrypted
			await expect(
				pageB.locator(".message", { hasText: "hello from Alice" }),
			).toBeVisible({ timeout: 10_000 });
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("late joiner cannot decrypt pre-join messages", async ({ browser }) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const ctxC = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();
		const pageC = await ctxC.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			// Wait for key exchange
			await pageA.waitForTimeout(3_000);

			// Alice and Bob exchange messages before Carol joins
			await sendMessage(pageA, "pre-join-secret-alpha");
			await expect(
				pageB.locator(".message", { hasText: "pre-join-secret-alpha" }),
			).toBeVisible({ timeout: 10_000 });

			// Carol joins late
			await joinExistingRoom(pageC, roomUrl, "Carol");
			await pageC.waitForTimeout(3_000);

			// Carol should NOT see pre-join messages (Megolm forward secrecy)
			// They either don't appear at all or show as decrypt errors
			const preJoinMsg = pageC.locator(".message", {
				hasText: "pre-join-secret-alpha",
			});
			const preJoinCount = await preJoinMsg.count();
			if (preJoinCount > 0) {
				// If the message element exists, it should show a decrypt error
				await expect(
					pageC.locator("[data-decrypt-error], .decrypt-error"),
				).toBeVisible();
			}

			// But Carol CAN decrypt post-join messages
			await sendMessage(pageA, "post-join-public-beta");
			await expect(
				pageC.locator(".message", { hasText: "post-join-public-beta" }),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await ctxA.close();
			await ctxB.close();
			await ctxC.close();
		}
	});

	test("3+ members: creator sees all, members see creator", async ({ browser }) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const ctxC = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();
		const pageC = await ctxC.newPage();

		try {
			// Sequential joins with waits to ensure key exchanges complete
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");
			// Wait for Alice ↔ Bob key exchange
			await pageA.waitForTimeout(3_000);
			await joinExistingRoom(pageC, roomUrl, "Carol");
			// Wait for Carol ↔ Alice key exchange
			await pageA.waitForTimeout(5_000);

			// Alice (creator) sends — verify it reaches Bob and Carol
			await sendMessage(pageA, "msg-from-Alice");
			await expect(
				pageB.locator(".message", { hasText: "msg-from-Alice" }),
			).toBeVisible({ timeout: 15_000 });
			await expect(
				pageC.locator(".message", { hasText: "msg-from-Alice" }),
			).toBeVisible({ timeout: 15_000 });

			// Bob sends — verify Alice (creator) can decrypt
			await sendMessage(pageB, "msg-from-Bob");
			await expect(
				pageA.locator(".message", { hasText: "msg-from-Bob" }),
			).toBeVisible({ timeout: 15_000 });

			// Carol sends — verify Alice (creator) can decrypt
			await sendMessage(pageC, "msg-from-Carol");
			await expect(
				pageA.locator(".message", { hasText: "msg-from-Carol" }),
			).toBeVisible({ timeout: 15_000 });

			// Verify member count shows 3
			await expect(pageA.locator('[aria-label="Room info"]')).toContainText("3", {
				timeout: 5_000,
			});
		} finally {
			await ctxA.close();
			await ctxB.close();
			await ctxC.close();
		}
	});

	test("emoji verification shows matching pair for both members", async ({
		browser,
	}) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			// Wait for key exchange and emoji derivation
			await pageA.waitForTimeout(3_000);

			// Alice opens room info
			await pageA.locator('[aria-label="Room info"]').click();
			const popoverA = pageA.locator(".room-info-popover");
			await expect(popoverA).toBeVisible({ timeout: 3_000 });
			const emojiA = await popoverA
				.locator(".member-emoji")
				.first()
				.textContent();

			// Bob opens room info
			await pageB.locator('[aria-label="Room info"]').click();
			const popoverB = pageB.locator(".room-info-popover");
			await expect(popoverB).toBeVisible({ timeout: 3_000 });
			const emojiB = await popoverB
				.locator(".member-emoji")
				.first()
				.textContent();

			// Both should see the same emoji pair (commutative hash)
			expect(emojiA).toBeTruthy();
			expect(emojiB).toBeTruthy();
			expect(emojiA).toEqual(emojiB);
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("creator kicks member — member gets redirected", async ({
		browser,
	}) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			// Wait for member list to propagate
			await pageA.waitForTimeout(3_000);

			// Record Bob's current URL
			const bobUrlBefore = pageB.url();

			// Alice opens room info and clicks Remove
			await pageA.locator('[aria-label="Room info"]').click();
			const popover = pageA.locator(".room-info-popover");
			await expect(popover).toBeVisible({ timeout: 3_000 });

			const kickBtn = popover.locator(".kick-btn").first();
			await expect(kickBtn).toBeVisible({ timeout: 5_000 });
			await kickBtn.click();

			// Bob should be redirected away from the original room
			await expect(async () => {
				const bobUrlAfter = pageB.url();
				expect(bobUrlAfter).not.toEqual(bobUrlBefore);
			}).toPass({ timeout: 15_000 });
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});
});
