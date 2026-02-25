import { test, expect } from './utils/fixtures';
import {
	createAndJoinRoom,
	createTask,
	openTaskPanel,
	trackAppErrors,
} from './utils/room-helpers';

/**
 * E2E tests for M17 Offline Task Store.
 *
 * These tests verify observable UI surfaces and browser-side effects of the
 * offline task store. Simulating actual offline conditions (navigator.onLine,
 * severed WebSocket) is too complex for E2E; instead we focus on:
 *
 * - ConnectionIndicator component presence and connected state
 * - IDB database creation after task activity
 *
 * All tests use the room-helpers utilities to create/join rooms and tasks.
 */

// ─── Connection Indicator ─────────────────────────────────────────────────────

test.describe('Offline Task Store: Connection Indicator', () => {
	test('connection-status element is present in the DOM after joining a room', async ({
		page,
	}) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// The ConnectionIndicator component renders a .connection-status span
		await expect(page.locator('.connection-status')).toBeAttached({ timeout: 5_000 });

		t.assertNoErrors();
	});

	test('connection dot has .online class when connected', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// After joining a room, WebSocket connects and the dot gets the .online class
		await expect(page.locator('.connection-dot.online')).toBeVisible({ timeout: 10_000 });

		t.assertNoErrors();
	});

	test('connection indicator shows no offline label when connected', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// When online, .connection-label should be hidden (empty label → no element)
		// Allow time for initial connection to establish
		await page.waitForTimeout(1_000);
		const label = page.locator('.connection-label');
		// Either not attached, or not visible — both are acceptable when connected
		const isVisible = await label.isVisible().catch(() => false);
		if (isVisible) {
			const text = await label.textContent();
			// If the label IS visible, it must not say "Offline"
			expect(text).not.toContain('Offline');
		}

		t.assertNoErrors();
	});
});

// ─── IDB Database Creation ────────────────────────────────────────────────────

test.describe('Offline Task Store: IDB databases', () => {
	test('weave-offline-tasks IDB database exists after creating a task', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);
		await createTask(page, 'IDB probe task');

		// Give the async saveTaskSnapshot call time to complete
		await page.waitForTimeout(1_000);

		// Check via indexedDB.databases() that the database was created
		const dbNames = await page.evaluate(async () => {
			if (!('databases' in indexedDB)) return [];
			const dbs = await indexedDB.databases();
			return dbs.map((d: IDBDatabaseInfo) => d.name ?? '');
		});

		expect(dbNames).toContain('weave-offline-tasks');

		t.assertNoErrors();
	});

	test('weave-offline-queue IDB database exists after creating a task', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);
		await createTask(page, 'Queue probe task');

		await page.waitForTimeout(1_000);

		const dbNames = await page.evaluate(async () => {
			if (!('databases' in indexedDB)) return [];
			const dbs = await indexedDB.databases();
			return dbs.map((d: IDBDatabaseInfo) => d.name ?? '');
		});

		expect(dbNames).toContain('weave-offline-queue');

		t.assertNoErrors();
	});
});

// ─── Task Panel Sync Dot ──────────────────────────────────────────────────────

test.describe('Offline Task Store: Task panel sync indicators', () => {
	test('task panel renders without errors after task store initialises', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);
		await createTask(page, 'Sync indicator task');

		// Task panel must stay visible and stable — no crash from offline store init
		await expect(page.locator('.task-panel')).toBeVisible({ timeout: 5_000 });

		t.assertNoErrors();
	});

	test('multiple tasks can be created without offline store errors', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		await createTask(page, 'Task alpha');
		await createTask(page, 'Task beta');
		await createTask(page, 'Task gamma');

		// All three tasks must be visible in the panel
		await expect(page.locator('.task-item', { hasText: 'Task alpha' })).toBeVisible();
		await expect(page.locator('.task-item', { hasText: 'Task beta' })).toBeVisible();
		await expect(page.locator('.task-item', { hasText: 'Task gamma' })).toBeVisible();

		t.assertNoErrors();
	});
});
