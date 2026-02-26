import { test, expect } from "./utils/fixtures";
import {
	createAndJoinRoom,
	openTaskPanel,
	trackAppErrors,
} from "./utils/room-helpers";
import { installWsGate } from "./utils/network-helpers";

/**
 * Push subscription lifecycle tests — enable and disable push toggle.
 *
 * Extends the existing `push-notifications.spec.ts` with deeper integration:
 * verifies that toggling push actually sends subscription/unsubscription
 * messages through the WebSocket to the relay.
 *
 * Key mocks needed:
 * 1. Notification API (permission: "granted")
 * 2. PushManager + serviceWorker.ready
 * 3. HTTP route for /vapid-key (handlePushToggle fetches this first)
 *
 * IMPORTANT: bypassCSP required because:
 * - connect-src blocks http://localhost:3001/vapid-key (only ws:// is allowed)
 * - script-src blocks addInitScript injection
 */

/**
 * Inject Notification + PushManager stubs with a mock subscribe function.
 * Uses context-level route for VAPID endpoint to intercept before CSP.
 */
async function injectPushStubs(
	context: import("@playwright/test").BrowserContext,
	page: import("@playwright/test").Page,
) {
	await page.addInitScript(() => {
		// Mock Notification
		Object.defineProperty(window, "Notification", {
			value: {
				permission: "granted" as NotificationPermission,
				requestPermission: async () =>
					"granted" as NotificationPermission,
			},
			writable: true,
			configurable: true,
		});

		// Mock PushManager (must exist for isPushSupported() check)
		if (!("PushManager" in window)) {
			(window as Record<string, unknown>)["PushManager"] = class {};
		}

		// Mock service worker ready with a push manager that can subscribe
		const mockSubscription = {
			endpoint: "https://fcm.googleapis.com/fcm/send/test-sub-123",
			getKey: (name: string) => {
				const key = new Uint8Array(65);
				key[0] = name === "p256dh" ? 0x04 : 0x01;
				return key.buffer;
			},
			unsubscribe: async () => true,
			toJSON: () => ({
				endpoint: "https://fcm.googleapis.com/fcm/send/test-sub-123",
				keys: { p256dh: "dGVzdA==", auth: "dGVzdA==" },
			}),
		};

		let subscribed = false;
		const mockPushManager = {
			subscribe: async () => {
				subscribed = true;
				return mockSubscription;
			},
			getSubscription: async () => (subscribed ? mockSubscription : null),
		};

		const mockRegistration = {
			pushManager: mockPushManager,
			active: { state: "activated" },
		};

		// Override serviceWorker.ready
		if ("serviceWorker" in navigator) {
			Object.defineProperty(navigator.serviceWorker, "ready", {
				value: Promise.resolve(mockRegistration),
				writable: true,
				configurable: true,
			});
		}
	});

	// Mock the VAPID key HTTP endpoint at context level
	await context.route("**/vapid-key", (route) => {
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				publicKey:
					"BDd3_hVL9fZi9Ybo2UUzA284WG5FZR30_95YeZJsiApwXK" +
					"pNcF1E9CnGrGLIo1NOF6-J0T-3xICzE5DJ_-XVqg",
			}),
		});
	});
}

test.describe("Push Subscription Lifecycle", () => {
	// Bypass CSP: connect-src blocks http://localhost:3001/vapid-key,
	// script-src blocks addInitScript injection
	test.use({ bypassCSP: true });

	test("enabling push toggle sends subscription to relay via WebSocket", async ({
		page,
		context,
	}) => {
		const errors = trackAppErrors(page);
		const gate = await installWsGate(context);
		await injectPushStubs(context, page);

		await createAndJoinRoom(page, "Alice");
		await openTaskPanel(page);

		// Open bell popover
		const bellBtn = page.locator(".bell-btn");
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });
		await bellBtn.click();

		const popover = page.locator(".bell-popover");
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// Push toggle should be visible (pushSupported = true from mocks)
		const pushToggle = popover.locator(".push-row .toggle-switch");
		await expect(pushToggle).toBeVisible({ timeout: 3_000 });

		// Record frame count before toggling
		const framesBefore = gate.sentFrames.length;

		// Click the push toggle to enable
		await pushToggle.click();

		// Wait for subscription flow: fetch VAPID key → subscribe → send WS message
		await expect(async () => {
			const newFrames = gate.sentFrames.slice(framesBefore);
			const pushSubFrame = newFrames.find((f) => {
				try {
					const msg = JSON.parse(f);
					return msg.type === "push_subscribe";
				} catch {
					return false;
				}
			});
			expect(
				pushSubFrame,
				"Expected a push_subscribe WebSocket frame to be sent to relay",
			).toBeTruthy();
		}).toPass({ timeout: 10_000 });

		errors.assertNoErrors();
	});

	test("disabling push toggle sends unsubscription to relay", async ({
		page,
		context,
	}) => {
		const errors = trackAppErrors(page);
		const gate = await installWsGate(context);
		await injectPushStubs(context, page);

		await createAndJoinRoom(page, "Alice");
		await openTaskPanel(page);

		const bellBtn = page.locator(".bell-btn");
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });
		await bellBtn.click();

		const popover = page.locator(".bell-popover");
		await expect(popover).toBeVisible({ timeout: 3_000 });

		const pushToggle = popover.locator(".push-row .toggle-switch");
		await expect(pushToggle).toBeVisible({ timeout: 3_000 });

		// Enable push first
		await pushToggle.click();

		// Wait for subscribe to complete
		await expect(async () => {
			const sub = gate.sentFrames.find((f) => {
				try { return JSON.parse(f).type === "push_subscribe"; }
				catch { return false; }
			});
			expect(sub).toBeTruthy();
		}).toPass({ timeout: 10_000 });

		// Record frame count
		const framesBefore = gate.sentFrames.length;

		// Disable push
		await pushToggle.click();

		// Wait for unsubscribe message
		await expect(async () => {
			const newFrames = gate.sentFrames.slice(framesBefore);
			const pushUnsubFrame = newFrames.find((f) => {
				try {
					const msg = JSON.parse(f);
					return msg.type === "push_unsubscribe";
				} catch {
					return false;
				}
			});
			expect(
				pushUnsubFrame,
				"Expected a push_unsubscribe WebSocket frame to be sent to relay",
			).toBeTruthy();
		}).toPass({ timeout: 10_000 });

		errors.assertNoErrors();
	});
});
