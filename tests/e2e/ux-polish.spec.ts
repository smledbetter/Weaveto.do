import { test, expect, type Page } from "@playwright/test";
import { trackErrors } from "./utils/test-helpers";

/** Create a room and join as creator with given name. */
async function createAndJoinRoom(page: Page, name = "Alice") {
  await page.goto("/", { waitUntil: "networkidle" });
  const btn = page.locator("button", { hasText: "New Room" });
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.locator('input[placeholder="What should we call you?"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('input[placeholder="What should we call you?"]').fill(name);
  await page.locator("button", { hasText: "Join Securely" }).click();
  await expect(page.locator("header .room-info h2")).not.toBeEmpty({
    timeout: 15_000,
  });
}

test.describe("M5.5: UX Polish", () => {
  test.describe("Homepage Radio Buttons", () => {
    test("Standard mode is selected by default", async ({ page }) => {
      const t = trackErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      const standardRadio = page.locator('input[type="radio"][value="standard"]');
      await expect(standardRadio).toBeChecked();

      t.assertNoErrors();
    });

    test("can select Ephemeral mode", async ({ page }) => {
      const t = trackErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      const ephemeralRadio = page.locator('input[type="radio"][value="ephemeral"]');
      await ephemeralRadio.check();
      await expect(ephemeralRadio).toBeChecked();

      const standardRadio = page.locator('input[type="radio"][value="standard"]');
      await expect(standardRadio).not.toBeChecked();

      t.assertNoErrors();
    });

    test("creating room with Ephemeral adds ephemeral URL param", async ({ page }) => {
      const t = trackErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      // Select Ephemeral
      const ephemeralRadio = page.locator('input[type="radio"][value="ephemeral"]');
      await ephemeralRadio.check();

      // Create room
      const btn = page.locator("button", { hasText: "New Room" });
      await btn.click();

      // URL should contain ephemeral param
      await expect(page.locator('input[placeholder="What should we call you?"]')).toBeVisible({
        timeout: 10_000,
      });
      expect(page.url()).toContain("ephemeral=true");

      t.assertNoErrors();
    });

    test("creating room with Standard does not add ephemeral param", async ({ page }) => {
      const t = trackErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      // Standard is selected by default, just create room
      const btn = page.locator("button", { hasText: "New Room" });
      await btn.click();

      // URL should NOT contain ephemeral param
      await expect(page.locator('input[placeholder="What should we call you?"]')).toBeVisible({
        timeout: 10_000,
      });
      expect(page.url()).not.toContain("ephemeral=true");

      t.assertNoErrors();
    });
  });

  test.describe("Room Name in Header", () => {
    test("h2 shows 2-word room name after joining", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page);

      const h2 = page.locator("header .room-info h2");
      await expect(h2).toBeVisible();
      await expect(h2).toHaveText(/^[a-z]+-[a-z]+$/);

      t.assertNoErrors();
    });

    test("room name is not empty", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page);

      const h2 = page.locator("header .room-info h2");
      await expect(h2).not.toBeEmpty();

      t.assertNoErrors();
    });
  });

  test.describe("Page Title", () => {
    test("page title includes room name after joining", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page);

      // Wait for title to update
      await page.waitForTimeout(500);
      const title = await page.title();

      // Title should contain a hyphenated word pair (e.g., "swift-falcon | weaveto.do")
      expect(title).toMatch(/[a-z]+-[a-z]+/);

      t.assertNoErrors();
    });

    test("page title contains weaveto.do", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page);

      await page.waitForTimeout(500);
      const title = await page.title();
      expect(title).toContain("weaveto.do");

      t.assertNoErrors();
    });
  });

  test.describe("Join Page Copy", () => {
    test("join page shows 'You've been invited' in subtitle", async ({ page }) => {
      const t = trackErrors(page);

      // Create room to get a valid room ID
      await page.goto("/", { waitUntil: "networkidle" });
      await page.locator("button", { hasText: "New Room" }).click();
      await expect(page.locator('input[placeholder="What should we call you?"]')).toBeVisible({
        timeout: 10_000,
      });

      // Extract room ID from URL
      const url = page.url();
      const match = url.match(/\/room\/([a-f0-9]{32})/);
      expect(match).not.toBeNull();
      const roomId = match![1];

      // Navigate to join page (without create param)
      await page.goto(`/room/${roomId}`, { waitUntil: "networkidle" });

      // Check for invite copy
      await expect(page.locator("text=You've been invited")).toBeVisible();

      t.assertNoErrors();
    });

    test("join page heading shows room name", async ({ page }) => {
      const t = trackErrors(page);

      // Create room to get a valid room ID
      await page.goto("/", { waitUntil: "networkidle" });
      await page.locator("button", { hasText: "New Room" }).click();
      await expect(page.locator('input[placeholder="What should we call you?"]')).toBeVisible({
        timeout: 10_000,
      });

      // Extract room ID from URL
      const url = page.url();
      const match = url.match(/\/room\/([a-f0-9]{32})/);
      expect(match).not.toBeNull();
      const roomId = match![1];

      // Navigate to join page (without create param)
      await page.goto(`/room/${roomId}`, { waitUntil: "networkidle" });

      // Check for "Join {roomName}" heading
      const heading = page.locator("h2");
      await expect(heading).toBeVisible();
      const headingText = await heading.textContent();
      expect(headingText).toMatch(/^Join [a-z]+-[a-z]+$/);

      t.assertNoErrors();
    });
  });

  test.describe("Display Name Visibility", () => {
    test("header shows 'You: {name}' after joining", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page, "Alice");

      // Wait for header to be visible
      await expect(page.locator("header")).toBeVisible();

      // Check for display name in header
      await expect(page.locator("header")).toContainText("You: Alice");

      t.assertNoErrors();
    });

    test("display name updates when different name is used", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page, "BobTheBuilder");

      await expect(page.locator("header")).toBeVisible();
      await expect(page.locator("header")).toContainText("You: BobTheBuilder");

      t.assertNoErrors();
    });
  });

  test.describe("Room Creation Flow with New Copy", () => {
    test("create room shows new placeholder text", async ({ page }) => {
      const t = trackErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      await page.locator("button", { hasText: "New Room" }).click();

      const input = page.locator('input[placeholder="What should we call you?"]');
      await expect(input).toBeVisible({ timeout: 10_000 });

      t.assertNoErrors();
    });

    test("join button is enabled after entering name", async ({ page }) => {
      const t = trackErrors(page);
      await page.goto("/", { waitUntil: "networkidle" });

      await page.locator("button", { hasText: "New Room" }).click();

      const input = page.locator('input[placeholder="What should we call you?"]');
      await expect(input).toBeVisible({ timeout: 10_000 });

      const joinBtn = page.locator("button", { hasText: "Join Securely" });
      await expect(joinBtn).toBeDisabled();

      await input.fill("TestUser");
      await expect(joinBtn).toBeEnabled();

      t.assertNoErrors();
    });
  });
});
