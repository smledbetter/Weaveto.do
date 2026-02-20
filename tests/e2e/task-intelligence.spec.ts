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

/** Open the task panel via the header toggle button. */
async function openTaskPanel(page: Page) {
  const toggle = page.locator(".tasks-toggle");
  await toggle.click();
  await expect(page.locator(".task-panel")).toBeVisible();
}

/** Create a task via /task command in the composer. */
async function createTaskViaCommand(page: Page, command: string) {
  const input = page.locator(".composer input");
  await input.fill(command);
  await input.press("Enter");
}

test.describe("M2: Task Intelligence", () => {
  test.describe("Natural Language Dates", () => {
    test('create task with "tomorrow" due date shows in panel', async ({
      page,
    }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page);
      await createTaskViaCommand(page, "/task Buy groceries | due: tomorrow");

      // Panel should auto-open
      await expect(page.locator(".task-panel")).toBeVisible();

      // Task should appear with formatted due date
      const taskItem = page.locator(".task-item").first();
      await expect(taskItem).toContainText("Buy groceries");
      await expect(taskItem.locator(".task-due")).toBeVisible();

      t.assertNoErrors();
    });

    test('create task with "in 3 hours" due date', async ({ page }) => {
      await createAndJoinRoom(page);
      await createTaskViaCommand(page, "/task Meeting prep | due: in 3 hours");

      await expect(page.locator(".task-panel")).toBeVisible();
      const taskItem = page.locator(".task-item").first();
      await expect(taskItem).toContainText("Meeting prep");
      await expect(taskItem.locator(".task-due")).toBeVisible();
    });

    test("NL date preview in create modal", async ({ page }) => {
      await createAndJoinRoom(page);
      await openTaskPanel(page);

      // Open create modal
      await page.locator(".new-task-btn").click();
      await expect(page.locator(".modal-content h3")).toHaveText("New Task");

      // Type a due date
      const dueInput = page.locator(
        '.modal-content input[placeholder*="tomorrow"]',
      );
      await dueInput.fill("tomorrow");

      // Preview should appear (not "Invalid format")
      const preview = page.locator(".due-preview");
      await expect(preview).toBeVisible();
      await expect(preview).not.toHaveClass(/invalid/);
    });

    test("invalid date shows error in preview", async ({ page }) => {
      await createAndJoinRoom(page);
      await openTaskPanel(page);

      await page.locator(".new-task-btn").click();
      const dueInput = page.locator(
        '.modal-content input[placeholder*="tomorrow"]',
      );
      await dueInput.fill("flibbertigibbet");

      const preview = page.locator(".due-preview");
      await expect(preview).toBeVisible();
      await expect(preview).toHaveClass(/invalid/);
    });
  });

  test.describe("Task Dependencies", () => {
    test("blocked task shows blocked indicator", async ({ page }) => {
      const t = trackErrors(page);
      await createAndJoinRoom(page);

      // Create first task and wait for it to appear in the panel
      await createTaskViaCommand(page, "/task Task A");
      await expect(page.locator(".task-panel")).toBeVisible();
      await expect(
        page.locator(".task-item", { hasText: "Task A" }),
      ).toBeVisible();

      // Open create modal and create Task B blocked by Task A
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Task B");

      // Wait for the dep section to appear in the DOM
      await page.waitForSelector(".dep-select-row", { timeout: 5000 });

      // Select Task A from the dependency dropdown
      const depSelect = page.locator(".dep-select-row select");
      await depSelect.selectOption({ label: "Task A" });

      // Verify Add button is enabled and click it
      const addBtn = page.locator(".add-dep-btn");
      await expect(addBtn).toBeEnabled({ timeout: 2000 });
      await addBtn.click();

      // Verify dep tag appears
      await expect(page.locator(".dep-tag")).toContainText("Task A");

      // Create the task
      await page.locator(".create-btn").click();

      // Task B should show as blocked
      const taskB = page.locator(".task-item", { hasText: "Task B" });
      await expect(taskB).toBeVisible();
      await expect(taskB.locator(".blocked-indicator")).toContainText(
        "Blocked",
      );

      t.assertNoErrors();
    });

    test("completing blocking task unblocks dependent", async ({ page }) => {
      await createAndJoinRoom(page);

      // Create Task A and wait for it to appear
      await createTaskViaCommand(page, "/task Task A");
      await expect(page.locator(".task-panel")).toBeVisible();
      await expect(
        page.locator(".task-item", { hasText: "Task A" }),
      ).toBeVisible();

      // Create Task B blocked by Task A via modal
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Task B");
      const depSelect = page.locator(".dep-select-row select");
      await depSelect.selectOption({ label: "Task A" });
      await page.locator(".add-dep-btn").click();
      await page.locator(".create-btn").click();

      // Task B should be blocked
      const taskB = page.locator(".task-item", { hasText: "Task B" });
      await expect(taskB.locator(".blocked-indicator")).toBeVisible();

      // Complete Task A — use the checkbox button with the specific aria-label
      const taskACheckbox = page.locator(
        "button[aria-label=\"Mark 'Task A' as complete\"]",
      );
      await taskACheckbox.click();

      // Task B should no longer be blocked
      await expect(taskB.locator(".blocked-indicator")).not.toBeVisible();
    });
  });

  test.describe("Progress Visibility", () => {
    test("room progress bar shows correct counts", async ({ page }) => {
      await createAndJoinRoom(page);

      // Create two tasks
      await createTaskViaCommand(page, "/task First task");
      await createTaskViaCommand(page, "/task Second task");

      // Progress bar should show 0/2 complete (0%)
      const progressText = page
        .locator(".room-progress .progress-text")
        .first();
      await expect(progressText).toContainText("0/2 complete (0%)");

      // Complete one task
      const firstTask = page.locator(".task-item", { hasText: "First task" });
      await firstTask.locator(".task-checkbox").click();

      // Progress should update — task moves to completed section
      await expect(progressText).toContainText("1/2 complete (50%)");
    });

    test("subtask progress bar appears for parent with subtasks", async ({
      page,
    }) => {
      await createAndJoinRoom(page);

      // Create parent with subtasks via modal
      await openTaskPanel(page);
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Parent task");

      // Add subtasks
      await page.locator(".add-subtask").click();
      await page.locator(".subtask-row input").first().fill("Subtask 1");
      await page.locator(".add-subtask").click();
      await page.locator(".subtask-row input").last().fill("Subtask 2");

      await page.locator(".create-btn").click();

      // Subtask progress bar should show 0%
      const subtaskProgress = page.locator(".subtask-progress .progress-text");
      await expect(subtaskProgress).toContainText("0%");
    });
  });

  test.describe("Keyboard Shortcuts", () => {
    test("Cmd+T toggles task panel", async ({ page }) => {
      await createAndJoinRoom(page);

      // Panel should not be visible initially
      await expect(page.locator(".task-panel")).not.toBeVisible();

      // Cmd+T to open
      await page.keyboard.press("Meta+t");
      await expect(page.locator(".task-panel")).toBeVisible();

      // Cmd+T again to close
      await page.keyboard.press("Meta+t");
      await expect(page.locator(".task-panel")).not.toBeVisible();
    });

    test("Shift+? shows shortcuts help modal", async ({ page }) => {
      await createAndJoinRoom(page);

      await expect(page.locator(".shortcuts-help-modal")).not.toBeVisible();

      // Shift+? to open
      await page.keyboard.press("Shift+?");
      await expect(page.locator(".shortcuts-help-modal")).toBeVisible();
      await expect(page.locator(".shortcuts-help-modal h3")).toHaveText(
        "Keyboard Shortcuts",
      );

      // Should list registered shortcuts
      const rows = page.locator(".shortcut-row");
      await expect(rows).toHaveCount(4); // t, k, ?, Escape

      // Escape to close
      await page.keyboard.press("Escape");
      await expect(page.locator(".shortcuts-help-modal")).not.toBeVisible();
    });

    test("Cmd+K opens task create modal", async ({ page }) => {
      await createAndJoinRoom(page);

      // Cmd+K should open panel and trigger create modal
      await page.keyboard.press("Meta+k");
      await expect(page.locator(".task-panel")).toBeVisible();
      await expect(page.locator(".modal-content h3")).toHaveText("New Task", {
        timeout: 3000,
      });
    });
  });

  test.describe("Inline Editing", () => {
    test("click task title enables inline editing", async ({ page }) => {
      await createAndJoinRoom(page);
      await createTaskViaCommand(page, "/task Editable task");

      // Click the task title
      const titleBtn = page.locator(".task-title.editable", {
        hasText: "Editable task",
      });
      await titleBtn.click();

      // Inline edit input should appear
      const editInput = page.locator(".inline-edit");
      await expect(editInput).toBeVisible();
      await expect(editInput).toHaveValue("Editable task");
    });

    test("Enter saves inline edit", async ({ page }) => {
      await createAndJoinRoom(page);
      await createTaskViaCommand(page, "/task Original title");

      // Click to edit
      await page
        .locator(".task-title.editable", { hasText: "Original title" })
        .click();

      // Clear and type new title
      const editInput = page.locator(".inline-edit").first();
      await editInput.clear();
      await editInput.fill("Updated title");
      await editInput.press("Enter");

      // Title should be updated
      await expect(
        page.locator(".task-title.editable", { hasText: "Updated title" }),
      ).toBeVisible();
    });

    test("Escape cancels inline edit", async ({ page }) => {
      await createAndJoinRoom(page);
      await createTaskViaCommand(page, "/task Keep this title");

      await page
        .locator(".task-title.editable", { hasText: "Keep this title" })
        .click();

      const editInput = page.locator(".inline-edit").first();
      await editInput.clear();
      await editInput.fill("Should not save");
      await editInput.press("Escape");

      // Original title preserved
      await expect(
        page.locator(".task-title.editable", { hasText: "Keep this title" }),
      ).toBeVisible();
    });
  });

  test.describe("Auto-assign skips blocked tasks", () => {
    test("auto-assign does not assign blocked tasks", async ({ page }) => {
      await createAndJoinRoom(page);

      // Create Task A and wait for it to appear
      await createTaskViaCommand(page, "/task Unblocked task");
      await expect(
        page.locator(".task-item", { hasText: "Unblocked task" }),
      ).toBeVisible();

      // Create Task B blocked by Task A
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Blocked task");
      const depSelect = page.locator(".dep-select-row select");
      await depSelect.selectOption({ label: "Unblocked task" });
      await page.locator(".add-dep-btn").click();
      await page.locator(".create-btn").click();

      // Both tasks exist, one blocked
      await expect(page.locator(".task-item")).toHaveCount(2);

      // Click auto-assign
      await page.locator(".auto-assign-btn").click();

      // Preview should show 1 assignment (only unblocked task)
      const previewModal = page.locator(".preview-modal");
      await expect(previewModal).toBeVisible();
      await expect(previewModal).toContainText("1 task");

      // Cancel to avoid changing state
      await page.locator(".cancel-btn").click();
    });
  });
});
