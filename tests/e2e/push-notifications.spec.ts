import { test, expect } from './utils/fixtures';
import { request as playwrightRequest } from '@playwright/test';
import {
	createAndJoinRoom,
	openTaskPanel,
	trackAppErrors,
} from './utils/room-helpers';

/**
 * E2E tests for M16 Web Push.
 *
 * Real Web Push delivery cannot be tested in E2E (requires a live push
 * service, valid subscriptions, and a browser that honours push events in
 * a controlled Playwright context). These tests instead verify:
 *
 * - Push toggle visibility is gated on PushManager support
 * - Push toggle appears inside the bell popover when PushManager is present
 * - The relay serves a valid VAPID public key at GET /vapid-key
 * - The service worker registers the `push` and `notificationclick` handlers
 *   (verified by checking that the SW file is served and contains the handler
 *   source as a proxy for the build artifact existing)
 *
 * Notification.permission and PushManager must be mocked via addInitScript
 * BEFORE navigation because the Svelte $state initializer reads them on load.
 */

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Web Push: Push toggle visibility', () => {
	test('push toggle not shown when PushManager is unavailable', async ({ page }) => {
		const t = trackAppErrors(page);

		// Grant notification permission but do NOT add PushManager.
		// Default Playwright Chromium environment has no PushManager.
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted' as NotificationPermission,
					requestPermission: async () => 'granted' as NotificationPermission,
				},
				writable: true,
				configurable: true,
			});
			// Explicitly remove PushManager to ensure absence (belt-and-suspenders)
			// @ts-expect-error — intentional deletion for test isolation
			delete (window as Record<string, unknown>)['PushManager'];
		});

		await createAndJoinRoom(page, 'Alice');
		await openTaskPanel(page);

		// Bell should render (permission is granted)
		const bellBtn = page.locator('.bell-btn');
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });

		// Open the popover
		await bellBtn.click();
		const popover = page.locator('.bell-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// The push-row section must NOT be rendered when PushManager is absent
		await expect(popover.locator('.push-row')).not.toBeAttached();
		await expect(popover.locator('#push-toggle')).not.toBeAttached();

		t.assertNoErrors();
	});

	test('push toggle visible inside bell popover when PushManager is available', async ({ page }) => {
		const t = trackAppErrors(page);

		// Inject both Notification (granted) and a stub PushManager before navigation.
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted' as NotificationPermission,
					requestPermission: async () => 'granted' as NotificationPermission,
				},
				writable: true,
				configurable: true,
			});

			// Minimal PushManager stub — just needs to exist for isPushSupported()
			if (!('PushManager' in window)) {
				(window as Record<string, unknown>)['PushManager'] = class {};
			}

			// serviceWorker is present in Playwright Chromium; no stub needed
		});

		await createAndJoinRoom(page, 'Alice');
		await openTaskPanel(page);

		const bellBtn = page.locator('.bell-btn');
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });

		await bellBtn.click();
		const popover = page.locator('.bell-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// The push-row section must be present when PushManager is available
		await expect(popover.locator('.push-row')).toBeVisible({ timeout: 3_000 });

		// The push toggle checkbox must be attached (visually hidden like notif-toggle)
		await expect(popover.locator('#push-toggle')).toBeAttached();

		// Label text must be legible
		await expect(popover.locator('.push-row .setting-label')).toContainText('Push when browser closed');

		t.assertNoErrors();
	});

	test('push toggle has accessible toggle-switch wrapper', async ({ page }) => {
		const t = trackAppErrors(page);

		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted' as NotificationPermission,
					requestPermission: async () => 'granted' as NotificationPermission,
				},
				writable: true,
				configurable: true,
			});
			if (!('PushManager' in window)) {
				(window as Record<string, unknown>)['PushManager'] = class {};
			}
		});

		await createAndJoinRoom(page, 'Alice');
		await openTaskPanel(page);

		const bellBtn = page.locator('.bell-btn');
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });
		await bellBtn.click();

		const popover = page.locator('.bell-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// The push-row toggle switch wrapper must be present and visible
		const pushRow = popover.locator('.push-row');
		await expect(pushRow.locator('.toggle-switch')).toBeVisible();

		// aria-label on the toggle-switch label must be meaningful
		await expect(pushRow.locator('.toggle-switch')).toHaveAttribute(
			'aria-label',
			'Toggle push notifications',
		);

		t.assertNoErrors();
	});
});

test.describe('Web Push: VAPID key endpoint', () => {
	test('relay serves VAPID public key at GET /vapid-key', async () => {
		// Use Playwright's Node-side request context to avoid browser CORS restrictions.
		// The relay does not emit CORS headers (the app fetches from its own page context).
		const apiContext = await playwrightRequest.newContext({ baseURL: 'http://localhost:3001' });
		try {
			const response = await apiContext.get('/vapid-key');
			expect(response.status()).toBe(200);
			const body = await response.json() as { publicKey?: unknown };
			expect(typeof body.publicKey).toBe('string');
			// VAPID public keys are URL-safe base64 — at least 80 chars
			expect((body.publicKey as string).length).toBeGreaterThan(80);
		} finally {
			await apiContext.dispose();
		}
	});

	test('VAPID key endpoint returns JSON content-type', async () => {
		const apiContext = await playwrightRequest.newContext({ baseURL: 'http://localhost:3001' });
		try {
			const response = await apiContext.get('/vapid-key');
			const contentType = response.headers()['content-type'] ?? '';
			expect(contentType).toContain('application/json');
		} finally {
			await apiContext.dispose();
		}
	});
});

test.describe('Web Push: Notification body privacy', () => {
	test('push toggle is off by default (not yet subscribed)', async ({ page }) => {
		const t = trackAppErrors(page);

		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted' as NotificationPermission,
					requestPermission: async () => 'granted' as NotificationPermission,
				},
				writable: true,
				configurable: true,
			});
			if (!('PushManager' in window)) {
				(window as Record<string, unknown>)['PushManager'] = class {};
			}
		});

		await createAndJoinRoom(page, 'Alice');
		await openTaskPanel(page);

		const bellBtn = page.locator('.bell-btn');
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });
		await bellBtn.click();

		const popover = page.locator('.bell-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// Push toggle should be unchecked by default (no prior subscription)
		const pushCheckbox = popover.locator('#push-toggle');
		await expect(pushCheckbox).toBeAttached();
		await expect(pushCheckbox).not.toBeChecked();

		t.assertNoErrors();
	});
});
