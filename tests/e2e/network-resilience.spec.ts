import { test, expect } from "./utils/fixtures";
import {
	createAndJoinRoom,
	sendMessage,
	trackAppErrors,
} from "./utils/room-helpers";
import { installWsGate } from "./utils/network-helpers";
import { newDeviceContext, joinExistingRoom } from "./utils/context-helpers";

/**
 * Network resilience E2E tests.
 *
 * Uses `routeWebSocket` gate to intercept WS connections and simulate
 * disconnects via `gate.dropConnection()`.
 *
 * IMPORTANT: Single-user disconnect causes the relay to destroy the room
 * (no members left). So ALL reconnection tests use two-user scenarios
 * where Alice keeps the room alive while Bob disconnects/reconnects.
 */

test.describe("Network Resilience", () => {
	test("WiFi drop shows Offline indicator", async ({
		browser,
	}) => {
		// Two users so the room stays alive when Bob disconnects
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const gateB = await installWsGate(ctxB);

		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();
		const errors = trackAppErrors(pageB);

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			// Both connected
			await expect(pageB.locator(".connection-dot.online").first()).toBeVisible({
				timeout: 10_000,
			});

			// Drop Bob's connection
			gateB.dropConnection();

			// Bob should show offline — green dot disappears
			await expect(pageB.locator(".connection-dot.online").first()).not.toBeVisible({
				timeout: 10_000,
			});

			// The connection-label should appear
			await expect(pageB.locator(".connection-label").first()).toBeVisible({
				timeout: 5_000,
			});

			errors.assertNoErrors();
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("disconnect and reconnect with message delivery", async ({
		browser,
	}) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const gateB = await installWsGate(ctxB);

		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			// Both connected
			await expect(pageA.locator(".connection-dot.online").first()).toBeVisible({
				timeout: 10_000,
			});
			await expect(pageB.locator(".connection-dot.online").first()).toBeVisible({
				timeout: 10_000,
			});

			// Wait for key exchange
			await pageA.waitForTimeout(3_000);

			// Alice sends before disconnect
			await sendMessage(pageA, "before-drop");
			await expect(
				pageB.locator(".message", { hasText: "before-drop" }),
			).toBeVisible({ timeout: 10_000 });

			// Drop Bob's connection
			gateB.dropConnection();

			// Bob should show disconnected
			await expect(pageB.locator(".connection-dot.online").first()).not.toBeVisible({
				timeout: 10_000,
			});

			// Bob should reconnect (room still alive via Alice, gate forwards new WS)
			await expect(pageB.locator(".connection-dot.online").first()).toBeVisible({
				timeout: 30_000,
			});

			// Bob sends after reconnect
			await sendMessage(pageB, "after-reconnect");
			await expect(
				pageB.locator(".message", { hasText: "after-reconnect" }),
			).toBeVisible({ timeout: 10_000 });

			// Alice should see Bob's post-reconnect message
			await expect(
				pageA.locator(".message", { hasText: "after-reconnect" }),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("post-reconnect messages have no decrypt errors", async ({
		browser,
	}) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const gateB = await installWsGate(ctxB);

		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");

			await expect(pageA.locator(".connection-dot.online").first()).toBeVisible({ timeout: 10_000 });
			await expect(pageB.locator(".connection-dot.online").first()).toBeVisible({ timeout: 10_000 });
			await pageA.waitForTimeout(3_000);

			// Drop and reconnect Bob
			gateB.dropConnection();
			await expect(pageB.locator(".connection-dot.online").first()).toBeVisible({
				timeout: 30_000,
			});

			// Send messages in both directions
			const markerA = `from-alice-${Date.now()}`;
			const markerB = `from-bob-${Date.now()}`;

			await sendMessage(pageA, markerA);
			await sendMessage(pageB, markerB);

			// Both should see each other's messages (decrypted)
			await expect(pageA.locator(".message", { hasText: markerB })).toBeVisible({ timeout: 15_000 });
			await expect(pageB.locator(".message", { hasText: markerA })).toBeVisible({ timeout: 15_000 });

			// No decrypt error indicators
			for (const p of [pageA, pageB]) {
				await expect(
					p.locator("[data-decrypt-error], .decrypt-error"),
				).toHaveCount(0);
			}
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});
});
