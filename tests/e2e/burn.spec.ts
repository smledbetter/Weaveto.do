import { test, expect } from "./utils/fixtures";
import type { Page } from "@playwright/test";
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

/** Create a task via /task command and wait for it to appear in the panel. */
async function createTask(page: Page, title: string) {
  const input = page.locator(".composer input");
  await input.fill(`/task ${title}`);
  await input.press("Enter");
  // Task panel should open automatically
  await expect(page.locator(".task-item", { hasText: title })).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("Burn Command", () => {
  test("/burn opens confirmation modal for room creator", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Type /burn command
    const input = page.locator(".composer input");
    await input.fill("/burn");
    await input.press("Enter");

    // Confirmation modal should appear
    await expect(page.locator("text=Permanently Delete Room")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.locator("text=This action cannot be undone"),
    ).toBeVisible();

    // Delete button should be disabled initially
    const deleteBtn = page.locator("button", { hasText: "Delete Room" });
    await expect(deleteBtn).toBeDisabled();

    // Message input should be cleared (not sent as chat)
    await expect(input).toHaveValue("");

    t.assertNoErrors();
  });

  test("/burn modal requires typing DELETE to enable submit", async ({
    page,
  }) => {
    await createAndJoinRoom(page);

    const input = page.locator(".composer input");
    await input.fill("/burn");
    await input.press("Enter");

    await expect(page.locator("text=Permanently Delete Room")).toBeVisible({
      timeout: 5_000,
    });

    const confirmInput = page.locator('input[placeholder*="DELETE"]');
    const deleteBtn = page.locator("button", { hasText: "Delete Room" });

    // Typing wrong text keeps button disabled
    await confirmInput.fill("delete");
    await expect(deleteBtn).toBeDisabled();

    await confirmInput.fill("DELET");
    await expect(deleteBtn).toBeDisabled();

    // Exact match enables button
    await confirmInput.fill("DELETE");
    await expect(deleteBtn).toBeEnabled();
  });

  test("/burn modal can be cancelled", async ({ page }) => {
    await createAndJoinRoom(page);

    const input = page.locator(".composer input");
    await input.fill("/burn");
    await input.press("Enter");

    await expect(page.locator("text=Permanently Delete Room")).toBeVisible({
      timeout: 5_000,
    });

    // Click cancel
    const cancelBtn = page.locator("button", { hasText: "Cancel" });
    await cancelBtn.click();

    // Modal should close
    await expect(
      page.locator("text=Permanently Delete Room"),
    ).not.toBeVisible();
  });

  test("/burn modal closes on Escape key", async ({ page }) => {
    await createAndJoinRoom(page);

    const input = page.locator(".composer input");
    await input.fill("/burn");
    await input.press("Enter");

    await expect(page.locator("text=Permanently Delete Room")).toBeVisible({
      timeout: 5_000,
    });

    // Press Escape — handled by svelte:window listener
    await page.keyboard.press("Escape");

    await expect(page.locator("text=Permanently Delete Room")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("successful /burn redirects to homepage with deleted notice", async ({
    page,
  }) => {
    await createAndJoinRoom(page);

    const input = page.locator(".composer input");
    await input.fill("/burn");
    await input.press("Enter");

    await expect(page.locator("text=Permanently Delete Room")).toBeVisible({
      timeout: 5_000,
    });

    // Type DELETE and confirm
    const confirmInput = page.locator('input[placeholder*="DELETE"]');
    await confirmInput.fill("DELETE");
    await page.locator("button", { hasText: "Delete Room" }).click();

    // Should redirect to homepage and show deleted room notice
    // Note: homepage cleans the URL via replaceState, so check for notice text
    await expect(page.locator(".deleted-notice")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".deleted-notice")).toContainText("Room deleted");
  });
});

test.describe("Ephemeral Mode", () => {
  test("ephemeral radio button appears on homepage", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const ephemeralRadio = page.locator(
      'input[type="radio"][value="ephemeral"]',
    );
    await expect(ephemeralRadio).toBeVisible();
    await expect(page.locator("label", { hasText: "Ephemeral" })).toBeVisible();
  });

  test("selecting ephemeral adds parameter to room URL", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Select ephemeral radio button
    const ephemeralRadio = page.locator(
      'input[type="radio"][value="ephemeral"]',
    );
    await ephemeralRadio.check();

    // Create room
    const btn = page.locator("button", { hasText: "New Room" });
    await btn.click();

    // URL should contain ephemeral param
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({
      timeout: 10_000,
    });
    expect(page.url()).toContain("ephemeral=true");
  });

  test("ephemeral room shows flame indicator after joining", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Select ephemeral radio button
    const ephemeralRadio = page.locator(
      'input[type="radio"][value="ephemeral"]',
    );
    await ephemeralRadio.check();

    // Create and join room
    await page.locator("button", { hasText: "New Room" }).click();
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible({
      timeout: 10_000,
    });
    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Alice");
    await page.locator("button", { hasText: "Join Securely" }).click();

    // Wait for room to load
    await expect(page.locator("header .room-info h2")).not.toBeEmpty({
      timeout: 15_000,
    });

    // Ephemeral indicator should be visible in the room header
    await expect(
      page.locator('[aria-label="Ephemeral room: no data persistence"]'),
    ).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("Auto-Delete Banner", () => {
  test("completing all tasks shows auto-delete banner", async ({ page }) => {
    await createAndJoinRoom(page);

    // Create a task
    await createTask(page, "Test task");

    // Complete the task via the task-checkbox button (not an input checkbox)
    const taskCheckbox = page
      .locator(".task-item")
      .first()
      .locator(".task-checkbox");
    await taskCheckbox.click();

    // Auto-delete banner should appear with countdown
    await expect(
      page.locator('[role="alert"]', { hasText: "auto-delete" }),
    ).toBeVisible({ timeout: 5_000 });
    // Banner shows time like "23h 59m"
    await expect(
      page.locator('[role="alert"]', { hasText: /\d+h \d+m/ }),
    ).toBeVisible();
  });

  test("Keep Room button dismisses auto-delete banner", async ({ page }) => {
    await createAndJoinRoom(page);

    // Create and complete a task
    await createTask(page, "Test task");
    const taskCheckbox = page
      .locator(".task-item")
      .first()
      .locator(".task-checkbox");
    await taskCheckbox.click();

    // Wait for banner
    await expect(
      page.locator('[role="alert"]', { hasText: "auto-delete" }),
    ).toBeVisible({ timeout: 5_000 });

    // Click Keep Room
    await page.locator("button", { hasText: "Keep Room" }).click();

    // Banner should disappear
    await expect(
      page.locator('[role="alert"]', { hasText: "auto-delete" }),
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

test.describe("Deleted Room Notice", () => {
  test("homepage shows notice when redirected with ?deleted=true", async ({
    page,
  }) => {
    await page.goto("/?deleted=true", { waitUntil: "networkidle" });
    await expect(page.locator(".deleted-notice")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator(".deleted-notice")).toContainText("Room deleted");
  });

  test("homepage shows notice when redirected with ?deleted=auto", async ({
    page,
  }) => {
    await page.goto("/?deleted=auto", { waitUntil: "networkidle" });
    await expect(page.locator(".deleted-notice")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator(".deleted-notice")).toContainText("auto-deleted");
  });

  test("deleted notice auto-dismisses after 5 seconds", async ({ page }) => {
    await page.goto("/?deleted=true", { waitUntil: "networkidle" });
    await expect(page.locator(".deleted-notice")).toBeVisible({
      timeout: 5_000,
    });

    // Wait for auto-dismiss
    await expect(page.locator(".deleted-notice")).not.toBeVisible({
      timeout: 8_000,
    });
  });
});
