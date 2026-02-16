import { test, expect, type Page } from "@playwright/test";
import { trackErrors } from "./utils/test-helpers";

/** Create a room and join as creator with given name. */
async function createAndJoinRoom(page: Page, name = "Alice") {
  await page.goto("/", { waitUntil: "networkidle" });
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
  await expect(page.locator("header .room-info h2")).not.toBeEmpty({
    timeout: 15_000,
  });
}

test.describe("Invite UX", () => {
  test("Invite button is visible in room header", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await expect(page.locator("button.invite-btn")).toBeVisible();
    await expect(page.locator("button.invite-btn")).toHaveText("Invite");
    t.assertNoErrors();
  });

  test("solo member banner shows when alone in room", async ({ page }) => {
    await createAndJoinRoom(page);
    const banner = page.locator(".solo-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("You're the only one here");
  });

  test("solo member banner can be dismissed", async ({ page }) => {
    await createAndJoinRoom(page);
    const banner = page.locator(".solo-banner");
    await expect(banner).toBeVisible();

    // Click dismiss
    await banner.locator('button[aria-label="Dismiss"]').click();
    await expect(banner).not.toBeVisible();
  });

  test("solo member banner invite link opens modal", async ({ page }) => {
    await createAndJoinRoom(page);
    const banner = page.locator(".solo-banner");
    await expect(banner).toBeVisible();

    // Click the "invite someone" link in the banner
    await banner.locator("button.invite-link").click();
    await expect(
      page.locator('[aria-labelledby="invite-modal-title"]'),
    ).toBeVisible();
    const titleText = await page.locator("#invite-modal-title").textContent();
    expect(titleText).toMatch(/^Invite to [a-z]+-[a-z]+$/);
  });

  test("Invite button opens invite modal", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    await page.locator("button.invite-btn").click();

    // Modal should be visible
    const modal = page.locator('[aria-labelledby="invite-modal-title"]');
    await expect(modal).toBeVisible();
    const titleText = await page.locator("#invite-modal-title").textContent();
    expect(titleText).toMatch(/^Invite to [a-z]+-[a-z]+$/);

    t.assertNoErrors();
  });

  test("invite modal contains QR code SVG", async ({ page }) => {
    await createAndJoinRoom(page);
    await page.locator("button.invite-btn").click();

    const qrContainer = page.locator(".qr-container");
    await expect(qrContainer).toBeVisible();

    // Should contain an SVG element
    const svg = qrContainer.locator("svg");
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("xmlns", "http://www.w3.org/2000/svg");
  });

  test("invite modal shows copyable room URL", async ({ page }) => {
    await createAndJoinRoom(page);
    await page.locator("button.invite-btn").click();

    const urlInput = page.locator(".url-input");
    await expect(urlInput).toBeVisible();

    // URL should contain /room/
    const value = await urlInput.inputValue();
    expect(value).toContain("/room/");

    // Copy button should be visible
    await expect(page.locator("button.copy-btn")).toHaveText("Copy");
  });

  test("invite modal shows member list with You badge", async ({ page }) => {
    await createAndJoinRoom(page, "TestUser");
    await page.locator("button.invite-btn").click();

    // Should show member list header
    await expect(page.locator(".member-list h4")).toContainText("Members");

    // Should show current user with "You" badge
    await expect(page.locator(".you-badge")).toHaveText("You");
    await expect(page.locator(".member-name").first()).toHaveText("TestUser");
  });

  test("invite modal shows privacy footer", async ({ page }) => {
    await createAndJoinRoom(page);
    await page.locator("button.invite-btn").click();

    await expect(page.locator(".privacy-footer")).toContainText(
      "end-to-end encrypted",
    );
  });

  test("invite modal closes on Escape", async ({ page }) => {
    await createAndJoinRoom(page);
    await page.locator("button.invite-btn").click();

    const modal = page.locator('[aria-labelledby="invite-modal-title"]');
    await expect(modal).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });

  test("invite modal closes on close button", async ({ page }) => {
    await createAndJoinRoom(page);
    await page.locator("button.invite-btn").click();

    const modal = page.locator('[aria-labelledby="invite-modal-title"]');
    await expect(modal).toBeVisible();

    await page.locator('button[aria-label="Close"]').click();
    await expect(modal).not.toBeVisible();
  });

  test("invite modal closes on backdrop click", async ({ page }) => {
    await createAndJoinRoom(page);
    await page.locator("button.invite-btn").click();

    const modal = page.locator('[aria-labelledby="invite-modal-title"]');
    await expect(modal).toBeVisible();

    // Click on backdrop (top-left corner, outside modal content)
    await page.locator(".modal-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(modal).not.toBeVisible();
  });

  test("no Copy Link button after replacement", async ({ page }) => {
    await createAndJoinRoom(page);
    await expect(page.locator("button.copy-link")).not.toBeVisible();
  });
});
