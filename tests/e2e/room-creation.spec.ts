import { test, expect, type Page } from "@playwright/test";
import {
  trackErrors,
  extractRoomId,
  assertNoWasmArtifacts,
} from "./utils/test-helpers";

/** Click "New Room" and wait for SvelteKit client-side navigation to the room page. */
async function createRoom(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  const btn = page.locator("button", { hasText: "New Room" });
  await expect(btn).toBeEnabled();
  await btn.click();
  // SvelteKit uses client-side routing — wait for the room name input to appear
  // instead of waitForURL which expects a full page load event.
  await expect(page.locator('input[placeholder="Your name"]')).toBeVisible({
    timeout: 10_000,
  });
  expect(page.url()).toMatch(/\/room\/[a-f0-9]{32}/);
}

test.describe("Room Creation Flow", () => {
  test("click New Room navigates to /room/[id]?create=1", async ({ page }) => {
    const t = trackErrors(page);
    await createRoom(page);

    const url = page.url();
    expect(url).toContain("?create=1");

    const roomId = extractRoomId(url);
    expect(roomId).not.toBeNull();
    expect(roomId).toMatch(/^[a-f0-9]{32}$/);

    t.assertNoErrors();
  });

  test("room UI renders after joining", async ({ page }) => {
    const t = trackErrors(page);
    await createRoom(page);

    // Enter name and join
    await page.locator('input[placeholder="Your name"]').fill("Alice");
    await page.locator("button", { hasText: "Join Securely" }).click();

    // Wait for connected state — the room header appears
    await expect(page.locator("header .room-info h2")).toHaveText("Room", {
      timeout: 15_000,
    });

    // Verify room UI elements
    await expect(page.locator(".encryption-badge")).toContainText(
      "End-to-end encrypted",
    );
    await expect(page.locator(".copy-link")).toBeVisible();
    await expect(page.locator(".member-count")).toContainText("member");
    await expect(page.locator(".composer input")).toBeVisible();
    await expect(
      page.locator(".composer button", { hasText: "Send" }),
    ).toBeVisible();
    await expect(page.locator(".empty-hint")).toContainText(
      "Share the link above",
    );

    await assertNoWasmArtifacts(page);
    t.assertNoErrors();
  });

  test("connection dot shows online", async ({ page }) => {
    await createRoom(page);

    await page.locator('input[placeholder="Your name"]').fill("Bob");
    await page.locator("button", { hasText: "Join Securely" }).click();

    await expect(page.locator("header .room-info h2")).toHaveText("Room", {
      timeout: 15_000,
    });
    await expect(page.locator(".connection-dot")).toHaveClass(/online/);
  });

  test("copy link button works", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await createRoom(page);

    const roomUrl = page.url().split("?")[0];

    await page.locator('input[placeholder="Your name"]').fill("Carol");
    await page.locator("button", { hasText: "Join Securely" }).click();

    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });

    const copyBtn = page.locator(".copy-link");
    await copyBtn.click();
    await expect(copyBtn).toHaveText("Copied!");

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(roomUrl);

    await expect(copyBtn).toHaveText("Copy Link", { timeout: 3_000 });
  });

  test("each room gets a unique ID", async ({ page }) => {
    const ids = new Set<string>();

    for (let i = 0; i < 3; i++) {
      await createRoom(page);
      ids.add(extractRoomId(page.url())!);
    }

    expect(ids.size).toBe(3);
  });
});
