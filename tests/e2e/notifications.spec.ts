import { test, expect } from './utils/fixtures';
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
 * Notification.permission must be mocked via addInitScript BEFORE navigation,
 * because the Svelte $state initializer reads it on page load and does not
 * react to later Object.defineProperty changes.
 */

// ─── Helper: create a task with a due date via /task command ──────────────────

async function createTaskWithDueDate(page: import('@playwright/test').Page, title: string) {
	const input = page.locator('.composer input');
	await input.fill(`/task ${title} | due: tomorrow`);
	await input.press('Enter');
	await expect(page.locator('.task-panel')).toBeVisible({ timeout: 5_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Notifications: Opt-in banner', () => {
	test('opt-in banner appears when there is a due-date task and permission is default', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		// Mock Notification.permission = 'default' BEFORE any navigation
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'default' as NotificationPermission,
					requestPermission: () => Promise.resolve('default' as NotificationPermission),
				},
				writable: true,
				configurable: true,
			});
		});

		await createAndJoinRoom(page);

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

		// Mock permission as 'default' BEFORE navigation
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'default' as NotificationPermission,
					requestPermission: () => Promise.resolve('default' as NotificationPermission),
				},
				writable: true,
				configurable: true,
			});
		});

		await createAndJoinRoom(page);

		// Create a task WITHOUT a due date
		const input = page.locator('.composer input');
		await input.fill('/task Write meeting notes');
		await input.press('Enter');
		await expect(page.locator('.task-panel')).toBeVisible({ timeout: 5_000 });

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

		// Mock permission as 'granted' BEFORE navigation
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

		await createAndJoinRoom(page);

		// Even with a due-date task, banner should not appear when permission is granted
		await createTaskWithDueDate(page, 'Deploy hotfix');

		await expect(
			page.locator('.opt-in-banner'),
		).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('opt-in banner dismiss hides the banner', async ({ page }) => {
		const t = trackAppErrors(page);

		// Mock permission as 'default' BEFORE navigation
		await page.addInitScript(() => {
			Object.defineProperty(window, 'Notification', {
				value: {
					permission: 'default' as NotificationPermission,
					requestPermission: () => Promise.resolve('default' as NotificationPermission),
				},
				writable: true,
				configurable: true,
			});
		});

		await createAndJoinRoom(page);
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

		// In Playwright's Chromium, Notification permission defaults to 'denied'.
		// The bell should not render.
		const bell = page.locator('.bell-btn');
		await expect(bell).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('bell icon is visible after permission is granted (mocked)', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		// Mock Notification.permission = 'granted' BEFORE navigation
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

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		// Bell should be visible now that permission is 'granted'
		await expect(page.locator('.bell-btn')).toBeVisible({ timeout: 5_000 });

		t.assertNoErrors();
	});

	test('bell popover opens with toggle and quiet-hours controls', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		// Mock Notification.permission = 'granted' BEFORE navigation
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

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		// Click the bell button to open the popover
		const bellBtn = page.locator('.bell-btn');
		await expect(bellBtn).toBeVisible({ timeout: 5_000 });
		await bellBtn.click();

		// Popover should appear with the notification settings dialog
		const popover = page.locator('.bell-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// The toggle checkbox is visually hidden (opacity:0) but the toggle-switch
		// wrapper and its slider are visible. Check the wrapper and checkbox existence.
		await expect(popover.locator('.toggle-switch[aria-label="Toggle notifications"]')).toBeVisible();
		await expect(popover.locator('#notif-toggle')).toBeAttached();

		// Popover should contain quiet-hours time inputs
		await expect(popover.locator('#quiet-start')).toBeVisible();
		await expect(popover.locator('#quiet-end')).toBeVisible();

		// Dismiss with Escape
		await page.keyboard.press('Escape');
		await expect(popover).not.toBeVisible({ timeout: 2_000 });

		t.assertNoErrors();
	});
});
