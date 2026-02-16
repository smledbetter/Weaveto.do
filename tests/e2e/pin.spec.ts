/**
 * E2E tests for M6 PIN system.
 *
 * Test Coverage:
 * - PIN policy toggle UI on homepage (PASSING)
 * - Room creation with PIN URL parameters (PASSING)
 * - Shield badge visibility (PASSING for non-PIN rooms)
 *
 * Limitations:
 * - PIN setup, entry, and shield badge tests in PIN-protected rooms are SKIPPED
 *   because they require WebAuthn PRF, which is bypassed in dev mode.
 * - In dev mode, when pinRequired=true but prfSeed is undefined, the room
 *   skips PIN setup and goes directly to 'connected' phase.
 * - To test full PIN functionality (setup modal, entry, locking), use a
 *   production build with WebAuthn enabled on a device with biometrics.
 */

import { test, expect, type Page } from "@playwright/test";
import { trackErrors } from "./utils/test-helpers";

/** Create a room with optional PIN policy and join as creator. */
async function createAndJoinRoom(
  page: Page,
  name = "Alice",
  pinRequired = false,
  pinTimeout = 15,
) {
  await page.goto("/", { waitUntil: "networkidle" });

  if (pinRequired) {
    const checkbox = page.locator("#pin-required");
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Wait for timeout dropdown to be visible
    await expect(page.locator("#inactivity-timeout")).toBeVisible({
      timeout: 2000,
    });

    // Optionally change timeout
    if (pinTimeout !== 15) {
      await page
        .locator("#inactivity-timeout")
        .selectOption(pinTimeout.toString());
    }
  }

  const btn = page.locator("button", { hasText: "New Room" });
  await expect(btn).toBeEnabled();
  await btn.click();

  await expect(
    page.locator('input[placeholder="What should we call you?"]'),
  ).toBeVisible({
    timeout: 10_000,
  });

  await page
    .locator('input[placeholder="What should we call you?"]')
    .fill(name);
  await page.locator("button", { hasText: "Join Securely" }).click();
}

test.describe("PIN Policy Toggle", () => {
  test("PIN policy toggle appears and functions", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // The PinPolicyToggle should be visible
    const pinCheckbox = page.locator("#pin-required");
    await expect(pinCheckbox).toBeVisible();
    await expect(pinCheckbox).not.toBeChecked();

    // Check it
    await pinCheckbox.click();
    await expect(pinCheckbox).toBeChecked();

    // Timeout dropdown should now be visible (it's conditionally rendered)
    const timeoutSelect = page.locator("#inactivity-timeout");
    await expect(timeoutSelect).toBeVisible({ timeout: 2000 });

    // Uncheck - timeout should hide
    await pinCheckbox.uncheck();
    await expect(timeoutSelect).not.toBeVisible();

    t.assertNoErrors();
  });

  test("PIN timeout dropdown has correct options", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const pinCheckbox = page.locator("#pin-required");
    await pinCheckbox.click();
    await expect(pinCheckbox).toBeChecked();

    const timeoutSelect = page.locator("#inactivity-timeout");
    await expect(timeoutSelect).toBeVisible({ timeout: 2000 });

    const options = timeoutSelect.locator("option");
    await expect(options).toHaveCount(3);

    // Options: 5, 15, 30 minutes
    const values = await options.allTextContents();
    expect(values).toEqual(["5 minutes", "15 minutes", "30 minutes"]);
  });
});

test.describe("Room Creation with PIN Policy", () => {
  test("creating room with PIN required adds URL params", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Enable PIN
    const checkbox = page.locator("#pin-required");
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Wait for timeout dropdown to confirm checkbox worked
    await expect(page.locator("#inactivity-timeout")).toBeVisible({
      timeout: 2000,
    });

    // Create room
    await page.locator("button", { hasText: "New Room" }).click();

    // Should navigate to room with pinRequired param
    // Wait for name input instead of URL (SvelteKit client-side routing)
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({ timeout: 10_000 });

    const url = page.url();
    expect(url).toContain("pinRequired=true");
    expect(url).toContain("pinTimeout=15"); // default timeout

    t.assertNoErrors();
  });

  test("creating room without PIN has no PIN params", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("button", { hasText: "New Room" }).click();

    // Wait for name input (SvelteKit client-side routing)
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({ timeout: 10_000 });

    const url = page.url();
    expect(url).not.toContain("pinRequired");
    expect(url).not.toContain("pinTimeout");

    t.assertNoErrors();
  });

  test("creating room with custom timeout adds correct param", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Enable PIN
    const checkbox = page.locator("#pin-required");
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Wait for timeout dropdown
    const timeoutSelect = page.locator("#inactivity-timeout");
    await expect(timeoutSelect).toBeVisible({ timeout: 2000 });

    // Change timeout to 30 minutes
    await timeoutSelect.selectOption("30");

    // Create room
    await page.locator("button", { hasText: "New Room" }).click();

    // Wait for name input (SvelteKit client-side routing)
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({ timeout: 10_000 });

    const url = page.url();
    expect(url).toContain("pinRequired=true");
    expect(url).toContain("pinTimeout=30");
  });
});

test.describe("PIN Setup Flow", () => {
  // NOTE: PIN setup flow requires WebAuthn PRF, which is not available in dev mode.
  // These tests are skipped because `import.meta.env.DEV` bypasses WebAuthn,
  // and without a PRF seed, the PIN setup modal is never shown.
  // To test PIN functionality, use a production build with WebAuthn enabled.

  test.skip("PIN setup modal appears in PIN-required room", async ({
    page,
  }) => {
    const t = trackErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const checkbox = page.locator("#pin-required");
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await page.locator("button", { hasText: "New Room" }).click();

    // Wait for name input (SvelteKit client-side routing)
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({ timeout: 10_000 });

    // Fill name and join
    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Alice");
    await page.locator("button", { hasText: "Join Securely" }).click();

    // Wait for PIN setup to appear (dev mode bypasses WebAuthn)
    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    t.assertNoErrors();
  });

  test.skip("PIN setup accepts and confirms PIN", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page, "Alice", true);

    // Wait for PIN setup
    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    // Enter PIN
    const pinInput = page.locator(".pin-input");
    await pinInput.fill("123456");

    // Should advance to confirm step
    await expect(page.locator("text=Confirm your PIN")).toBeVisible();

    // Enter same PIN
    await pinInput.fill("123456");

    // Should be in connected room (shield badge visible)
    await expect(page.locator(".shield-badge")).toBeVisible({
      timeout: 10000,
    });

    t.assertNoErrors();
  });

  test.skip("PIN mismatch shows error", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    const pinInput = page.locator(".pin-input");
    await pinInput.fill("123456");

    await expect(page.locator("text=Confirm your PIN")).toBeVisible();
    await pinInput.fill("654321");

    // Should show mismatch error
    await expect(page.locator("text=PINs don't match")).toBeVisible();

    // Should reset back to enter step
    await expect(page.locator("text=Set a PIN")).toBeVisible();
  });

  test.skip("PIN cancel returns to join page", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    // Click cancel
    await page.locator("button", { hasText: "Cancel" }).click();

    // Should return to name entry
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible();
  });

  test.skip("PIN setup can be cancelled with Escape key", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    // Press Escape
    await page.keyboard.press("Escape");

    // Should return to name entry
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible();
  });

  test.skip("PIN setup can be cancelled by clicking backdrop", async ({
    page,
  }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    // Click on backdrop (top-left corner, outside modal content)
    await page.locator(".modal-backdrop").click({ position: { x: 10, y: 10 } });

    // Should return to name entry
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible();
  });
});

test.describe("Shield Badge", () => {
  // NOTE: These tests require completing PIN setup, which needs WebAuthn PRF.
  // Dev mode bypasses WebAuthn, so PIN setup never occurs.

  test.skip("shield badge visible in PIN-protected room", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page, "Alice", true);

    // Complete PIN setup
    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });
    const pinInput = page.locator(".pin-input");
    await pinInput.fill("123456");
    await expect(page.locator("text=Confirm your PIN")).toBeVisible();
    await pinInput.fill("123456");

    // Shield badge should be visible
    await expect(page.locator(".shield-badge")).toBeVisible({
      timeout: 10000,
    });

    t.assertNoErrors();
  });

  test("no shield badge in non-PIN room", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("button", { hasText: "New Room" }).click();

    // Wait for name input (SvelteKit client-side routing)
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Alice");
    await page.locator("button", { hasText: "Join Securely" }).click();

    // Wait for room to be connected
    await expect(page.locator(".encryption-badge")).toBeVisible({
      timeout: 10000,
    });

    // Shield badge should NOT be present
    await expect(page.locator(".shield-badge")).not.toBeVisible();

    t.assertNoErrors();
  });

  test.skip("shield badge has expected text", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    // Complete PIN setup
    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });
    const pinInput = page.locator(".pin-input");
    await pinInput.fill("123456");
    await expect(page.locator("text=Confirm your PIN")).toBeVisible();
    await pinInput.fill("123456");

    // Check shield badge text
    const badge = page.locator(".shield-badge");
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText("PIN");
  });
});

test.describe("PIN Entry Flow", () => {
  // NOTE: PIN entry requires WebAuthn PRF (not available in dev mode).

  test.skip("PIN dots reflect input length", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    const pinInput = page.locator(".pin-input");

    // Type partial PIN
    await pinInput.fill("123");

    // Should have 3 filled dots
    const filledDots = page.locator(".dot.filled");
    await expect(filledDots).toHaveCount(3);

    // Complete PIN
    await pinInput.fill("123456");
    await expect(filledDots).toHaveCount(6);
  });

  test.skip("PIN input only accepts digits", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    const pinInput = page.locator(".pin-input");

    // Try to enter non-digit characters
    await pinInput.fill("abc123xyz");

    // Should only have digits
    const value = await pinInput.inputValue();
    expect(value).toBe("123");
  });

  test.skip("PIN input limits to 6 digits", async ({ page }) => {
    await createAndJoinRoom(page, "Alice", true);

    await expect(page.locator("text=Set a PIN")).toBeVisible({
      timeout: 10000,
    });

    const pinInput = page.locator(".pin-input");

    // Try to enter more than 6 digits
    await pinInput.fill("123456789");

    // Should only have 6 digits
    const value = await pinInput.inputValue();
    expect(value).toBe("123456");
  });
});
