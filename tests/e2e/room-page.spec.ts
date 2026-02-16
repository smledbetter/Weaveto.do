import { test, expect } from "@playwright/test";
import { trackErrors, assertNoWasmArtifacts } from "./utils/test-helpers";

test.describe("Room Page", () => {
  // Valid 32-hex room ID for smoke tests (room won't exist on relay, that's fine for UI tests)
  const testRoomId = "a".repeat(32);

  test("loads without JS errors", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto(`/room/${testRoomId}`);
    await page.waitForLoadState("networkidle");
    t.assertNoErrors();
  });

  test("shows name input phase initially", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    await expect(page.locator("h2", { hasText: "Join" })).toBeVisible();
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "Join Securely" }),
    ).toBeVisible();
  });

  test("Join button disabled until name entered", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    const joinBtn = page.locator("button", { hasText: "Join Securely" });
    await expect(joinBtn).toBeDisabled();

    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Tester");
    await expect(joinBtn).toBeEnabled();
  });

  test("shows key warning banner", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    const banner = page.locator(".warning-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("encryption keys live only in this tab");
  });

  test("dismisses warning banner", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    const banner = page.locator(".warning-banner");
    await expect(banner).toBeVisible();
    await banner.locator("button", { hasText: "Got it" }).click();
    await expect(banner).not.toBeVisible();
  });

  test("has no WASM artifacts", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    await page.waitForLoadState("networkidle");
    await assertNoWasmArtifacts(page);
  });
});
