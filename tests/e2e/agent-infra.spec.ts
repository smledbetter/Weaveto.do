import { test, expect } from "./utils/fixtures";
import type { Page } from "@playwright/test";
import { trackErrors } from "./utils/test-helpers";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Built-in agents that auto-activate on room join, read from the manifests on
 * disk rather than hardcoded. These assertions previously pinned "(1)" and a
 * bare `.builtin` selector, and broke silently when the second built-in
 * shipped. Reading the directory means a third one updates them for free.
 */
const AGENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/lib/agents",
);
const BUILTIN_AGENTS: string[] = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".manifest.json"))
  .map((f) => JSON.parse(readFileSync(join(AGENTS_DIR, f), "utf8")).name)
  .sort();

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
    await expect(agentsBtn).toContainText("Automation");

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
    // One row per built-in agent. There is no "Built-in" badge any more:
    // custom agents are roadmap-only, so every agent is built in and the badge
    // said nothing. Assert the count rather than a bare .toBeVisible(), which
    // is a strict-mode violation once there is more than one.
    await expect(page.locator(".agent-panel .module-item")).toHaveCount(
      BUILTIN_AGENTS.length,
    );
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

  // The custom-agent upload UI was removed ("deferred to a later milestone").
  // Its test is deleted rather than skipped: the selectors no longer exist, so
  // a skipped test would just be a lie in the suite. Upload returns in M20 4c,
  // and gets a fresh test then, including Ed25519 signature rejection.

  test("tasks and agents panels can be open simultaneously", async ({
    page,
  }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);

    // The task panel is open by default (weave-task-panel-open defaults to
    // true in onMount), so toggle only if it is currently closed. Clicking
    // unconditionally closed it and the assertion below never found it.
    const taskPanel = page.locator(".task-panel");
    if (!(await taskPanel.isVisible())) {
      await page.locator(".tasks-toggle").click();
    }
    await expect(taskPanel).toBeVisible();

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

    // Count reflects however many built-ins ship, not a hardcoded 1.
    const agentsBtn = page.locator(".agents-toggle");
    await expect(agentsBtn).toContainText(`(${BUILTIN_AGENTS.length})`, {
      timeout: 10_000,
    });

    t.assertNoErrors();
  });

  test("built-in agent can be deactivated and reactivated", async ({
    page,
  }) => {
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator(".agents-toggle").click();

    // Should show active status
    const autoBalanceRow = page.locator(".module-item", {
      hasText: BUILTIN_AGENTS[0],
    });
    const statusBadge = autoBalanceRow.locator(".status-badge");
    await expect(statusBadge).toHaveClass(/active/);

    // Deactivate
    const deactivateBtn = autoBalanceRow.locator(".toggle-btn");
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

  test("no agent can be deleted", async ({ page }) => {
    // Deleting only ever applied to an uploaded agent, and there is no way to
    // upload one. The affordance is gone rather than merely hidden.
    const t = trackErrors(page);
    await createAndJoinRoom(page);
    await page.locator(".agents-toggle").click();

    await expect(page.locator(".agent-panel .module-item")).toHaveCount(
      BUILTIN_AGENTS.length,
    );
    await expect(page.locator(".agent-panel .delete-btn")).toHaveCount(0);

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
