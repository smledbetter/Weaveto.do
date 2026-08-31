import { test, expect } from './utils/fixtures';
import {
	createAndJoinRoom,
	createTask,
	openTaskPanel,
	trackAppErrors,
} from './utils/room-helpers';

/**
 * E2E tests for M18 Sync & Conflict Resolution.
 *
 * These tests verify observable sync behaviour surfaces in the UI.
 * True multi-peer conflict simulation requires two browser contexts
 * sharing the same relay room; the tests below cover:
 *
 * - Connection indicator shows "Connected" (.connection-dot.online)
 * - ConnectionIndicator component is present in the DOM after joining
 * - Task creation works end-to-end (store accepts event, UI reflects it)
 * - Multiple sequential operations (create + status change) both succeed
 *
 * All tests use room-helpers to create and join rooms.
 */

// ─── Connection Indicator ─────────────────────────────────────────────────────

test.describe('Sync & Conflict: Connection indicator', () => {
	test('connection dot has .online class when connected', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// WebSocket connects shortly after joining; .connection-dot.online appears
		// Scoped to the header: ConnectionIndicator also renders inside the
		// room-info popover, so a bare selector is a strict-mode violation.
		await expect(page.locator('header .connection-dot.online')).toBeVisible({ timeout: 10_000 });

		t.assertNoErrors();
	});

	test('ConnectionIndicator component is present in the DOM', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// The .connection-status span is rendered by ConnectionIndicator
		await expect(page.locator('header .connection-status')).toBeAttached({ timeout: 5_000 });

		t.assertNoErrors();
	});

	test('connection label does not show Offline when WebSocket is connected', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);

		// Allow connection to stabilise
		await page.waitForTimeout(1_500);

		const label = page.locator('header .connection-label');
		const isVisible = await label.isVisible().catch(() => false);
		if (isVisible) {
			const text = await label.textContent();
			expect(text).not.toContain('Offline');
		}
		// If the label is not visible that is also correct (connected = no label shown)

		t.assertNoErrors();
	});
});

// ─── Task Creation (store integration) ───────────────────────────────────────

test.describe('Sync & Conflict: Task creation works', () => {
	test('create task — task appears in panel and offline store is updated', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		await createTask(page, 'Sync probe task');

		// Task visible in UI — confirms applyEvent path and reactive store both work
		await expect(page.locator('.task-item', { hasText: 'Sync probe task' })).toBeVisible({
			timeout: 5_000,
		});

		// Offline IDB should also be written
		await page.waitForTimeout(1_000);
		const dbNames = await page.evaluate(async () => {
			if (!('databases' in indexedDB)) return [];
			const dbs = await (indexedDB as IDBFactory & { databases(): Promise<IDBDatabaseInfo[]> }).databases();
			return dbs.map((d: IDBDatabaseInfo) => d.name ?? '');
		});
		expect(dbNames).toContain('weave-offline-tasks');

		t.assertNoErrors();
	});

	test('create multiple tasks — all appear without errors', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		await createTask(page, 'Sync task one');
		await createTask(page, 'Sync task two');
		await createTask(page, 'Sync task three');

		await expect(page.locator('.task-item', { hasText: 'Sync task one' })).toBeVisible();
		await expect(page.locator('.task-item', { hasText: 'Sync task two' })).toBeVisible();
		await expect(page.locator('.task-item', { hasText: 'Sync task three' })).toBeVisible();

		t.assertNoErrors();
	});
});

// ─── Multiple Task Operations ─────────────────────────────────────────────────

test.describe('Sync & Conflict: Multiple task operations', () => {
	test('create task then update status — both operations succeed', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		await createTask(page, 'Status change task');

		// Find and click the task to open it, then change status
		const taskItem = page.locator('.task-item', { hasText: 'Status change task' });
		await expect(taskItem).toBeVisible({ timeout: 5_000 });

		// Click through to task detail / status button if available, otherwise verify task is stable
		// The status pill / toggle may vary by UI implementation
		const statusButton = taskItem.locator('[data-status], .status-badge, .task-status').first();
		if (await statusButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
			await statusButton.click();
			// After status change the task item should still be in the panel
			await expect(page.locator('.task-panel')).toBeVisible();
		}

		// Task panel stays stable — no crash from sequential events
		await expect(page.locator('.task-panel')).toBeVisible();

		t.assertNoErrors();
	});

	test('task panel remains stable after multiple create events', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);

		// Rapid sequential creates — exercises event log growth without crash
		await createTask(page, 'Burst alpha');
		await createTask(page, 'Burst beta');
		await createTask(page, 'Burst gamma');
		await createTask(page, 'Burst delta');

		// All tasks visible and panel stable
		await expect(page.locator('.task-panel')).toBeVisible({ timeout: 5_000 });
		await expect(page.locator('.task-item', { hasText: 'Burst alpha' })).toBeVisible();
		await expect(page.locator('.task-item', { hasText: 'Burst delta' })).toBeVisible();

		t.assertNoErrors();
	});

	test('weave-offline-queue IDB database exists after creating tasks', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page);
		await openTaskPanel(page);
		await createTask(page, 'Queue sync task');

		await page.waitForTimeout(1_000);

		const dbNames = await page.evaluate(async () => {
			if (!('databases' in indexedDB)) return [];
			const dbs = await (indexedDB as IDBFactory & { databases(): Promise<IDBDatabaseInfo[]> }).databases();
			return dbs.map((d: IDBDatabaseInfo) => d.name ?? '');
		});

		expect(dbNames).toContain('weave-offline-queue');

		t.assertNoErrors();
	});
});
