import { test, expect } from "./utils/fixtures";
import type { Page } from "@playwright/test";
import { trackErrors } from "./utils/test-helpers";

/** Create a room and join as the given user name. */
async function createAndJoinRoom(page: Page, name = "Alice") {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator("button", { hasText: "New Room" }).click();
  await expect(
    page.locator('input[placeholder="What should we call you?"]'),
  ).toBeVisible({
    timeout: 10_000,
  });

  await page
    .locator('input[placeholder="What should we call you?"]')
    .fill(name);
  await page.locator("button", { hasText: "Join Securely" }).click();

  // Wait for connected state
  await expect(page.locator("header .room-info h2")).not.toBeEmpty({
    timeout: 15_000,
  });
}

test.describe("M3: Agent Infrastructure", () => {
  test("Agents toggle button is visible in room header", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    const agentsBtn = page.locator(".agents-toggle");
    await expect(agentsBtn).toBeVisible();
    await expect(agentsBtn).toContainText("Agents");

    t.assertNoErrors();
  });

  test("clicking Agents toggle opens the agent panel", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Panel should not be visible initially
    await expect(page.locator(".agent-panel")).not.toBeVisible();

    // Click the toggle
    await page.locator(".agents-toggle").click();

    // Panel should appear
    await expect(page.locator(".agent-panel")).toBeVisible();
    await expect(page.locator(".agent-panel h3")).toHaveText("Automation");

    t.assertNoErrors();
  });

  test("agent panel shows built-in auto-balance agent", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator(".agents-toggle").click();

    await expect(page.locator(".agent-panel")).toBeVisible();
    // Built-in agent should be listed
    await expect(
      page.locator(".module-name", { hasText: "auto-balance" }),
    ).toBeVisible();
    // Should show "Built-in" badge
    await expect(page.locator(".builtin-badge")).toBeVisible();
    // Should NOT show empty state
    await expect(page.locator(".agent-panel .empty-state")).not.toBeVisible();

    t.assertNoErrors();
  });

  test("agent panel close button works", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Open panel
    await page.locator(".agents-toggle").click();
    await expect(page.locator(".agent-panel")).toBeVisible();

    // Close via panel close button
    await page.locator(".agent-panel .close-panel-btn").click();
    await expect(page.locator(".agent-panel")).not.toBeVisible();

    t.assertNoErrors();
  });

  test("agent panel upload is behind advanced toggle", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator(".agents-toggle").click();

    // Upload button should not be visible initially
    await expect(page.locator(".agent-panel .upload-btn")).not.toBeVisible();

    // Click "Advanced" toggle link
    const advancedLink = page.locator(".upload-toggle-link");
    await expect(advancedLink).toBeVisible();
    await advancedLink.click();

    // Now upload button should appear
    const uploadBtn = page.locator(".agent-panel .upload-btn");
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Upload form should appear
    await expect(page.locator(".agent-panel .upload-form")).toBeVisible();

    t.assertNoErrors();
  });

  test("tasks and agents panels can be open simultaneously", async ({
    page,
  }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Open tasks panel
    await page.locator(".tasks-toggle").click();
    await expect(page.locator(".task-panel")).toBeVisible();

    // Open agents panel too
    await page.locator(".agents-toggle").click();
    await expect(page.locator(".agent-panel")).toBeVisible();

    // Both should be visible
    await expect(page.locator(".task-panel")).toBeVisible();
    await expect(page.locator(".agent-panel")).toBeVisible();

    t.assertNoErrors();
  });
});

test.describe("M3.5: Built-in Auto-Balance Agent", () => {
  test("built-in agent is active by default and shows in header badge", async ({
    page,
  }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // Agents button should show count (1) for the active built-in
    const agentsBtn = page.locator(".agents-toggle");
    await expect(agentsBtn).toContainText("(1)", { timeout: 10_000 });

    t.assertNoErrors();
  });

  test("built-in agent can be deactivated and reactivated", async ({
    page,
  }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator(".agents-toggle").click();

    // Should show active status
    const statusBadge = page.locator(".module-item.builtin .status-badge");
    await expect(statusBadge).toHaveClass(/active/);

    // Deactivate
    const deactivateBtn = page.locator(".module-item.builtin .toggle-btn");
    await expect(deactivateBtn).toContainText("Deactivate");
    await deactivateBtn.click();

    // Should now show inactive
    await expect(statusBadge).not.toHaveClass(/active/);
    await expect(deactivateBtn).toContainText("Activate");

    // Reactivate (worker instantiation may take time)
    await deactivateBtn.click();
    await expect(statusBadge).toHaveClass(/active/, { timeout: 15_000 });

    t.assertNoErrors();
  });

  test("built-in agent has no delete button", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator(".agents-toggle").click();

    // Built-in module should be visible
    await expect(page.locator(".module-item.builtin")).toBeVisible();
    // Should NOT have a delete button
    await expect(
      page.locator(".module-item.builtin .delete-btn"),
    ).not.toBeVisible();

    t.assertNoErrors();
  });

  test("first-run toast appears on initial load", async ({ page }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // First-run toast should appear
    const toast = page.locator(".agent-toast");
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toContainText("Auto-balance agent is active");

    // Dismiss it
    await toast.locator("button").click();
    await expect(toast).not.toBeVisible();

    t.assertNoErrors();
  });
});
