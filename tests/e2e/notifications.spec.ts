import { test, expect } from './utils/fixtures';
import type { Page } from '@playwright/test';
import {
	createAndJoinRoom,
	openTaskPanel,
	trackAppErrors,
} from './utils/room-helpers';

/**
 * E2E tests for M14 Local Notifications.
 *
 * These tests cover the UI surfaces of the notification system:
 * - Opt-in banner visibility (requires permission === 'default' + due-date tasks)
 * - Opt-in banner dismiss behavior
 * - Bell icon visibility (requires permission === 'granted')
 * - Bell popover controls
 *
 * Note: The Notification API may not be available in all Playwright browser contexts.
 * Where it is unavailable, tests that depend on it are skipped gracefully.
 * The opt-in and dismiss tests work in any environment because they test
 * DOM state gated on permission === 'default', which is the default when the API
 * is absent or not yet granted.
 */

// ─── Helper: force Notification.permission to a specific value ────────────────

async function mockNotificationPermission(
	page: Page,
	permission: 'default' | 'granted' | 'denied',
) {
	await page.evaluate((perm) => {
		Object.defineProperty(window, 'Notification', {
			value: {
				permission: perm,
				requestPermission: () => Promise.resolve(perm),
			},
			writable: true,
			configurable: true,
		});
	}, permission);
}

// ─── Helper: create a task with a due date ────────────────────────────────────

async function createTaskWithDueDate(page: Page, title: string) {
	const input = page.locator('.composer input');
	await input.fill(`/task ${title} | due: tomorrow`);
	await input.press('Enter');
	// Task panel should auto-open after creating a task
	await expect(page.locator('.task-panel')).toBeVisible({ timeout: 5_000 });
}

// ─── Helper: create a task without a due date ─────────────────────────────────

async function createTaskWithoutDueDate(page: Page, title: string) {
	const input = page.locator('.composer input');
	await input.fill(`/task ${title}`);
	await input.press('Enter');
	await expect(page.locator('.task-panel')).toBeVisible({ timeout: 5_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Notifications: Opt-in banner', () => {
	test('opt-in banner appears when there is a due-date task and permission is default', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// Ensure Notification.permission is 'default' (not yet requested)
		// In Playwright's Chromium, Notification permission is 'denied' by default for localhost.
		// We must mock it to 'default' to exercise the opt-in path.
		await page.evaluate(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'default',
					requestPermission: () => Promise.resolve('default'),
				},
				writable: true,
				configurable: true,
			});
		});

		// Create a task with a due date — this sets hasDueDateTasks = true
		await createTaskWithDueDate(page, 'Review quarterly report');

		// The opt-in banner should now be visible inside the task panel
		await expect(
			page.locator('.opt-in-banner'),
		).toBeVisible({ timeout: 5_000 });

		// Verify the prompt text is present
		await expect(
			page.locator('.opt-in-banner'),
		).toContainText('Get reminded when tasks are due');

		t.assertNoErrors();
	});

	test('opt-in banner does not appear when there are no due-date tasks', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// Mock permission as 'default' so the only suppression condition left is hasDueDateTasks
		await page.evaluate(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'default',
					requestPermission: () => Promise.resolve('default'),
				},
				writable: true,
				configurable: true,
			});
		});

		// Create a task WITHOUT a due date
		await createTaskWithoutDueDate(page, 'Write meeting notes');

		// The banner should NOT be visible — no due-date tasks
		await expect(
			page.locator('.opt-in-banner'),
		).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('opt-in banner does not appear when permission is already granted', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// Mock permission as 'granted' so the banner condition is false
		await page.evaluate(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted',
					requestPermission: () => Promise.resolve('granted'),
				},
				writable: true,
				configurable: true,
			});
		});

		// Even with a due-date task, banner should not appear when permission is granted
		await createTaskWithDueDate(page, 'Deploy hotfix');

		await expect(
			page.locator('.opt-in-banner'),
		).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('opt-in banner dismiss hides the banner', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// Force permission to 'default' so the banner renders
		await page.evaluate(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'default',
					requestPermission: () => Promise.resolve('default'),
				},
				writable: true,
				configurable: true,
			});
		});

		await createTaskWithDueDate(page, 'Prepare demo slides');

		// Wait for the banner to appear
		const banner = page.locator('.opt-in-banner');
		await expect(banner).toBeVisible({ timeout: 5_000 });

		// Click the dismiss button (×)
		await page.locator('.dismiss-btn[aria-label="Dismiss notification prompt"]').click();

		// Banner should disappear after dismissing
		await expect(banner).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});
});

test.describe('Notifications: Bell icon', () => {
	test('bell icon is not visible by default (permission not granted)', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		// In Playwright's Chromium the Notification API may not be available,
		// or permission starts as 'denied'. Either way the bell should not render.
		const bell = page.locator('.bell-btn');
		await expect(bell).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('bell icon is visible after permission is granted (mocked)', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// Mock permission as 'granted' via initScript before page loads
		// Since we're already on the page, we need to force a re-evaluation
		// by mocking Notification and triggering the opt-in flow.
		await page.evaluate(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted',
					requestPermission: () => Promise.resolve('granted'),
				},
				writable: true,
				configurable: true,
			});
		});

		// Reload the page so the $state initializer re-reads Notification.permission
		// The fixture already sets walkthrough-seen=true via addInitScript
		await page.reload({ waitUntil: 'networkidle' });

		// After reload we need to re-join (room state is lost)
		// Instead, navigate directly with the existing room URL, but the simplest
		// approach is to re-create the room with the mocked permission already set.
		// The addInitScript in the fixture ensures the walkthrough is skipped.

		// Re-navigate after mocking Notification at the page level
		// Note: page.evaluate runs in browser context; it affects the current
		// document but not subsequent navigations. We must use addInitScript for
		// persistent mocking across navigations.
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted' as NotificationPermission,
					requestPermission: () => Promise.resolve('granted' as NotificationPermission),
				},
				writable: true,
				configurable: true,
			});
		});

		// Navigate to a fresh room with permission pre-mocked
		await page.goto('/', { waitUntil: 'networkidle' });
		await page.locator('button', { hasText: 'New Room' }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });
		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill('Alice');
		await page.locator('button', { hasText: 'Join Securely' }).click();
		await expect(page.locator('header .room-info h2')).not.toBeEmpty({
			timeout: 15_000,
		});

		// Dismiss any overlays
		const coachSkip = page.locator('.coach-overlay button');
		if (await coachSkip.isVisible({ timeout: 1_000 }).catch(() => false)) {
			await coachSkip.click();
		}

		// Open task panel — bell renders only inside the panel header
		await openTaskPanel(page);

		// Bell should be visible now that permission is 'granted'
		await expect(page.locator('.bell-btn')).toBeVisible({ timeout: 5_000 });

		t.assertNoErrors();
	});

	test('bell popover opens with toggle and quiet-hours controls', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		// Mock Notification as granted from the start of this navigation
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'granted' as NotificationPermission,
					requestPermission: () => Promise.resolve('granted' as NotificationPermission),
				},
				writable: true,
				configurable: true,
			});
		});

		await page.goto('/', { waitUntil: 'networkidle' });
		await page.locator('button', { hasText: 'New Room' }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });
		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill('Bob');
		await page.locator('button', { hasText: 'Join Securely' }).click();
		await expect(page.locator('header .room-info h2')).not.toBeEmpty({
			timeout: 15_000,
		});

		// Dismiss coach marks if present
		const coachSkip = page.locator('.coach-overlay button');
		if (await coachSkip.isVisible({ timeout: 1_000 }).catch(() => false)) {
			await coachSkip.click();
		}

		await openTaskPanel(page);

		// Click the bell button to open the popover
		const bellBtn = page.locator('.bell-btn');
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });
		await bellBtn.click();

		// Popover should appear with the notification settings dialog
		const popover = page.locator('.bell-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// Popover should contain the notifications toggle
		await expect(
			popover.locator('#notif-toggle'),
		).toBeVisible();

		// Popover should contain quiet-hours time inputs
		await expect(
			popover.locator('#quiet-start'),
		).toBeVisible();
		await expect(
			popover.locator('#quiet-end'),
		).toBeVisible();

		// Dismiss with Escape
		await page.keyboard.press('Escape');
		await expect(popover).not.toBeVisible({ timeout: 2_000 });

		t.assertNoErrors();
	});
});
