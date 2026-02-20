/**
 * Smoke test against live deployment.
 * Run: npx playwright test --config tests/smoke.config.ts
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

const BASE_URL = process.env.SMOKE_URL ?? 'https://weaveto-do.vercel.app';

async function joinRoom(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');

  // Pre-set sessionStorage to suppress coach marks walkthrough overlay
  await page.evaluate(() => sessionStorage.setItem('weave-walkthrough-seen', 'true'));

  const nameInput = page.getByPlaceholder('What should we call you?');
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.fill(name);
  await page.getByRole('button', { name: /join securely/i }).click();
  // Wait for room UI
  const msgInput = page.getByPlaceholder('Type a message or /task...');
  await expect(msgInput).toBeVisible({ timeout: 15000 });

  // Dismiss agent toast if visible
  const agentToast = page.locator('.agent-toast');
  if (await agentToast.isVisible({ timeout: 2000 }).catch(() => false)) {
    const dismissBtn = agentToast.locator('button');
    if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await dismissBtn.click();
    }
  }

  // If coach marks still appeared (race), click Skip
  const skipBtn = page.locator('.skip-btn');
  if (await skipBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await skipBtn.click();
  }

  await page.waitForTimeout(500);
}

test.describe('Live deployment smoke test', () => {
  test('homepage loads and has New Room button', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/weave/i);
    await expect(page.getByRole('button', { name: /new room/i })).toBeVisible({ timeout: 10000 });
  });

  test('create room and join', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /new room/i }).click();
    await expect(page).toHaveURL(/\/room\/[a-f0-9]+/, { timeout: 10000 });

    await joinRoom(page, page.url(), 'Alice');
  });

  test('two users can exchange encrypted messages', async ({ browser }) => {
    // User A creates a room
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(BASE_URL);
    await pageA.waitForLoadState('networkidle');
    await pageA.getByRole('button', { name: /new room/i }).click();
    await expect(pageA).toHaveURL(/\/room\/[a-f0-9]+/, { timeout: 10000 });
    const roomUrl = pageA.url();

    // User A joins
    await joinRoom(pageA, roomUrl, 'Alice');

    // User B joins same room (strip ?create=1 query param)
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const joinUrl = roomUrl.split('?')[0];
    await joinRoom(pageB, joinUrl, 'Bob');

    // Wait for key exchange to complete
    await pageA.waitForTimeout(3000);

    // User A sends a message
    const msgInputA = pageA.getByPlaceholder('Type a message or /task...');
    await msgInputA.fill('hello from Alice');
    await msgInputA.press('Enter');

    // Verify Alice sees her own message
    await expect(pageA.locator('text=hello from Alice')).toBeVisible({ timeout: 5000 });

    // User B should see Alice's message (decrypted)
    await expect(pageB.locator('text=hello from Alice')).toBeVisible({ timeout: 15000 });

    // User B sends a message back
    const msgInputB = pageB.getByPlaceholder('Type a message or /task...');
    await msgInputB.fill('hello from Bob');
    await msgInputB.press('Enter');

    // User A should see Bob's message
    await expect(pageA.locator('text=hello from Bob')).toBeVisible({ timeout: 10000 });

    // Verify no decryption failures for user-sent messages
    const decryptFailsA = await pageA.locator('text=Unable to decrypt').count();
    const decryptFailsB = await pageB.locator('text=Unable to decrypt').count();

    // User B may have 1 "Unable to decrypt" for a pre-join agent message
    expect(decryptFailsB).toBeLessThanOrEqual(1);
    // User A should have zero decrypt failures
    expect(decryptFailsA).toBe(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('relay WebSocket is reachable from app origin', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/weave/i);

    const wsResult = await page.evaluate(async () => {
      return new Promise<string>((resolve) => {
        const ws = new WebSocket('wss://weaveto-relay.fly.dev/room/00000000000000000000000000000099');
        const timeout = setTimeout(() => {
          ws.close();
          resolve('timeout');
        }, 5000);
        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve('connected');
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          resolve('error');
        };
      });
    });
    expect(wsResult).toBe('connected');
  });
});
