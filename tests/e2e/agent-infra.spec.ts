import { test, expect, type Page } from '@playwright/test';
import { trackErrors } from './utils/test-helpers';

/** Create a room and join as the given user name. */
async function createAndJoinRoom(page: Page, name = 'Alice') {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'New Room' }).click();
  await expect(page.locator('input[placeholder="Your name"]')).toBeVisible({
    timeout: 10_000,
  });

  await page.locator('input[placeholder="Your name"]').fill(name);
  await page.locator('button', { hasText: 'Join Securely' }).click();

  // Wait for connected state
  await expect(page.locator('header .room-info h2')).toHaveText('Room', {
    timeout: 15_000,
  });
}

test.describe('M3: Agent Infrastructure', () => {
  test('Agents toggle button is visible in room header', async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    const agentsBtn = page.locator('.agents-toggle');
    await expect(agentsBtn).toBeVisible();
    await expect(agentsBtn).toContainText('Agents');

    t.assertNoErrors();
  });

  test('clicking Agents toggle opens the agent panel', async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Panel should not be visible initially
    await expect(page.locator('.agent-panel')).not.toBeVisible();

    // Click the toggle
    await page.locator('.agents-toggle').click();

    // Panel should appear
    await expect(page.locator('.agent-panel')).toBeVisible();
    await expect(page.locator('.agent-panel h3')).toHaveText('Agent Modules');

    t.assertNoErrors();
  });

  test('agent panel shows empty state when no modules uploaded', async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator('.agents-toggle').click();

    await expect(page.locator('.agent-panel')).toBeVisible();
    await expect(page.locator('.agent-panel .empty-state')).toBeVisible();

    t.assertNoErrors();
  });

  test('agent panel close button works', async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Open panel
    await page.locator('.agents-toggle').click();
    await expect(page.locator('.agent-panel')).toBeVisible();

    // Close via panel close button
    await page.locator('.agent-panel .close-panel-btn').click();
    await expect(page.locator('.agent-panel')).not.toBeVisible();

    t.assertNoErrors();
  });

  test('agent panel upload button shows upload form', async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator('.agents-toggle').click();

    // Click upload button
    const uploadBtn = page.locator('.agent-panel button', { hasText: 'Upload Agent' });
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Upload form should appear
    await expect(page.locator('.agent-panel .upload-form')).toBeVisible();

    t.assertNoErrors();
  });

  test('tasks and agents panels can be open simultaneously', async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Open tasks panel
    await page.locator('.tasks-toggle').click();
    await expect(page.locator('.task-panel')).toBeVisible();

    // Open agents panel too
    await page.locator('.agents-toggle').click();
    await expect(page.locator('.agent-panel')).toBeVisible();

    // Both should be visible
    await expect(page.locator('.task-panel')).toBeVisible();
    await expect(page.locator('.agent-panel')).toBeVisible();

    t.assertNoErrors();
  });
});
