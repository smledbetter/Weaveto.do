import { test, expect } from './utils/fixtures';
import {
	createAndJoinRoom,
	dismissOverlays,
	trackAppErrors,
} from './utils/room-helpers';

/**
 * E2E tests for M15 Trust & Verification.
 *
 * Covers:
 * - Shield icon presence and healthy state in room header
 * - Shield icon accessible label
 * - Migration banner appearance (via sessionStorage) and dismiss
 * - Emoji verification visible in room info popover (multi-user)
 * - Creator sees Remove button; single-user has no kick target
 */

test.describe('Trust & Verification: Shield icon', () => {
	test('shield icon shows in room header with healthy class', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const shield = page.locator('.shield-icon');
		await expect(shield).toBeVisible({ timeout: 5_000 });
		await expect(shield).toHaveClass(/healthy/);

		t.assertNoErrors();
	});

	test('shield icon has correct aria-label when healthy', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const shield = page.locator('.shield-icon');
		await expect(shield).toBeVisible({ timeout: 5_000 });
		await expect(shield).toHaveAttribute('aria-label', 'All messages received');

		t.assertNoErrors();
	});

	test('shield icon is a button and is focusable', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const shield = page.locator('.shield-icon');
		await expect(shield).toBeVisible({ timeout: 5_000 });

		// ShieldIcon renders as a <button>
		await expect(shield).toHaveRole('button');

		t.assertNoErrors();
	});
});

test.describe('Trust & Verification: Migration banner', () => {
	test('migration banner appears when sessionStorage flag is set', async ({ page }) => {
		const t = trackAppErrors(page);

		// Set the migration flag before the page navigates to the room
		// The room page reads this flag in onMount and removes it
		await page.addInitScript(() => {
			sessionStorage.setItem('weave-migration-banner', 'true');
		});

		await createAndJoinRoom(page, 'Alice');

		const banner = page.locator('.migration-banner');
		await expect(banner).toBeVisible({ timeout: 5_000 });
		await expect(banner).toContainText('tasks have been carried over');

		t.assertNoErrors();
	});

	test('migration banner can be dismissed', async ({ page }) => {
		const t = trackAppErrors(page);

		await page.addInitScript(() => {
			sessionStorage.setItem('weave-migration-banner', 'true');
		});

		await createAndJoinRoom(page, 'Alice');

		const banner = page.locator('.migration-banner');
		await expect(banner).toBeVisible({ timeout: 5_000 });

		// The dismiss button is inside .migration-banner
		const dismissBtn = banner.locator('.dismiss-btn');
		await expect(dismissBtn).toBeVisible();
		await dismissBtn.click();

		await expect(banner).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('migration banner does not appear without sessionStorage flag', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const banner = page.locator('.migration-banner');
		await expect(banner).not.toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('migration banner dismiss button has accessible label', async ({ page }) => {
		const t = trackAppErrors(page);

		await page.addInitScript(() => {
			sessionStorage.setItem('weave-migration-banner', 'true');
		});

		await createAndJoinRoom(page, 'Alice');

		const banner = page.locator('.migration-banner');
		await expect(banner).toBeVisible({ timeout: 5_000 });

		const dismissBtn = banner.locator('.dismiss-btn');
		await expect(dismissBtn).toHaveAttribute('aria-label', 'Dismiss migration notice');

		t.assertNoErrors();
	});
});

test.describe('Trust & Verification: Room info popover', () => {
	test('room info popover opens via Room info button', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		// The room info button shows member count and has aria-label="Room info"
		const roomInfoBtn = page.locator('[aria-label="Room info"]');
		await expect(roomInfoBtn).toBeVisible({ timeout: 5_000 });
		await roomInfoBtn.click();

		// Popover should be open — look for dropdown header text
		const popover = page.locator('.room-info-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		t.assertNoErrors();
	});

	test('single user sees no kick button (no other members)', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const roomInfoBtn = page.locator('[aria-label="Room info"]');
		await roomInfoBtn.click();

		const popover = page.locator('.room-info-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// No other members → no Remove buttons rendered
		const kickBtn = popover.locator('.kick-btn');
		await expect(kickBtn).not.toBeVisible();

		t.assertNoErrors();
	});

	test('single user sees no member-emoji (no remote members)', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const roomInfoBtn = page.locator('[aria-label="Room info"]');
		await roomInfoBtn.click();

		const popover = page.locator('.room-info-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		// No remote peers means no emoji derivation and no .member-emoji elements
		const emojiEl = popover.locator('.member-emoji');
		await expect(emojiEl).not.toBeVisible();

		t.assertNoErrors();
	});

	test('room info popover closes with Escape key', async ({ page }) => {
		const t = trackAppErrors(page);

		await createAndJoinRoom(page, 'Alice');

		const roomInfoBtn = page.locator('[aria-label="Room info"]');
		await roomInfoBtn.click();

		const popover = page.locator('.room-info-popover');
		await expect(popover).toBeVisible({ timeout: 3_000 });

		await page.keyboard.press('Escape');
		await expect(popover).not.toBeVisible({ timeout: 2_000 });

		t.assertNoErrors();
	});
});

test.describe('Trust & Verification: Multi-user emoji verification', () => {
	test('emoji verification shows for remote member in room info', async ({ browser }) => {
		// Two contexts to simulate two independent users
		const contextA = await browser.newContext();
		const contextB = await browser.newContext();

		// Auto-dismiss walkthrough for both contexts
		await contextA.addInitScript(() => {
			localStorage.setItem('weave-walkthrough-seen', 'true');
		});
		await contextB.addInitScript(() => {
			localStorage.setItem('weave-walkthrough-seen', 'true');
		});

		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		try {
			// Alice creates the room
			const roomUrl = await createAndJoinRoom(pageA, 'Alice');

			// Bob navigates to the same room URL (without ?create so he joins, not creates)
			const joinUrl = roomUrl.replace(/[?&]create[^&]*/, '');
			await pageB.goto(joinUrl, { waitUntil: 'networkidle' });
			await dismissOverlays(pageB);

			// Bob fills in his name and joins
			const nameInput = pageB.locator('input[placeholder="What should we call you?"]');
			await expect(nameInput).toBeVisible({ timeout: 10_000 });
			await nameInput.fill('Bob');
			await pageB.locator('button', { hasText: 'Join Securely' }).click();

			// Wait for Bob to reach the connected phase (room header visible)
			await expect(pageB.locator('header .room-info h2')).not.toBeEmpty({ timeout: 15_000 });
			await dismissOverlays(pageB);

			// Give both sides time to exchange keys and derive emoji
			await pageA.waitForTimeout(3_000);

			// Alice opens room info
			const roomInfoBtn = pageA.locator('[aria-label="Room info"]');
			await expect(roomInfoBtn).toBeVisible({ timeout: 5_000 });
			await roomInfoBtn.click();

			const popover = pageA.locator('.room-info-popover');
			await expect(popover).toBeVisible({ timeout: 3_000 });

			// At least one .member-emoji should now be visible (Bob's entry)
			const emojiEl = popover.locator('.member-emoji').first();
			await expect(emojiEl).toBeVisible({ timeout: 5_000 });

			// Verification hint should also appear
			const hint = popover.locator('.verification-hint');
			await expect(hint).toBeVisible();
			await expect(hint).toContainText('Ask members to confirm');
		} finally {
			await contextA.close();
			await contextB.close();
		}
	});

	test('creator sees Remove button for remote member', async ({ browser }) => {
		const contextA = await browser.newContext();
		const contextB = await browser.newContext();

		await contextA.addInitScript(() => {
			localStorage.setItem('weave-walkthrough-seen', 'true');
		});
		await contextB.addInitScript(() => {
			localStorage.setItem('weave-walkthrough-seen', 'true');
		});

		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, 'Alice');

			const joinUrl = roomUrl.replace(/[?&]create[^&]*/, '');
			await pageB.goto(joinUrl, { waitUntil: 'networkidle' });
			await dismissOverlays(pageB);

			const nameInput = pageB.locator('input[placeholder="What should we call you?"]');
			await expect(nameInput).toBeVisible({ timeout: 10_000 });
			await nameInput.fill('Bob');
			await pageB.locator('button', { hasText: 'Join Securely' }).click();
			await expect(pageB.locator('header .room-info h2')).not.toBeEmpty({ timeout: 15_000 });
			await dismissOverlays(pageB);

			// Wait for member list to propagate to Alice
			await pageA.waitForTimeout(2_000);

			// Alice (creator) opens room info
			const roomInfoBtn = pageA.locator('[aria-label="Room info"]');
			await expect(roomInfoBtn).toBeVisible({ timeout: 5_000 });
			await roomInfoBtn.click();

			const popover = pageA.locator('.room-info-popover');
			await expect(popover).toBeVisible({ timeout: 3_000 });

			// Creator should see a Remove button for Bob
			const kickBtn = popover.locator('.kick-btn').first();
			await expect(kickBtn).toBeVisible({ timeout: 5_000 });
			await expect(kickBtn).toHaveAttribute('aria-label', /Remove/);
		} finally {
			await contextA.close();
			await contextB.close();
		}
	});
});
