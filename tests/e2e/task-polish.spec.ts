import { test, expect, type Page } from "@playwright/test";
import { trackErrors } from "./utils/test-helpers";

/** Create a room and join as the given user name. */
async function createAndJoinRoom(page: Page, name = "Alice") {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator("button", { hasText: "New Room" }).click();
  await expect(page.locator('input[placeholder="Your name"]')).toBeVisible({
    timeout: 10_000,
  });

  await page.locator('input[placeholder="Your name"]').fill(name);
  await page.locator("button", { hasText: "Join Securely" }).click();

  // Wait for connected state
  await expect(page.locator("header .room-info h2")).toHaveText("Room", {
    timeout: 15_000,
  });
}

/** Open the task panel via the header toggle button. */
async function openTaskPanel(page: Page) {
  const panel = page.locator(".task-panel");
  const isVisible = await panel.isVisible();
  if (!isVisible) {
    const toggle = page.locator(".tasks-toggle");
    await toggle.click();
    await expect(panel).toBeVisible();
  }
}

/** Create a task via /task command in the composer. */
async function createTaskViaCommand(page: Page, command: string) {
  const input = page.locator(".composer input");
  await input.fill(command);
  await input.press("Enter");
}

test.describe("M4: Task Polish", () => {
  test.beforeEach(async ({ page }) => {
    await createAndJoinRoom(page);
  });

  test.describe("Task Description", () => {
    test("creates task with description via modal", async ({ page }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Open create modal
      await page.locator(".new-task-btn").click();
      await expect(page.locator(".modal-content h3")).toHaveText("New Task");

      // Fill in title and description
      const titleInput = page.locator(
        '.modal-content input[placeholder="What needs to be done?"]',
      );
      await titleInput.fill("Review pull request");

      const descriptionInput = page.locator(".description-input");
      await descriptionInput.fill(
        "Check the code quality and test coverage",
      );

      // Submit
      await page.locator(".create-btn").click();

      // Verify task appears in panel
      const taskItem = page.locator(".task-item", {
        hasText: "Review pull request",
      });
      await expect(taskItem).toBeVisible();

      // Verify description appears
      await expect(taskItem.locator(".task-description")).toContainText(
        "Check the code quality and test coverage",
      );

      t.assertNoErrors();
    });

    test("description is visible in task panel", async ({ page }) => {
      await openTaskPanel(page);

      // Create task with description
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Task with details");
      await page
        .locator(".description-input")
        .fill("Important context about this task");
      await page.locator(".create-btn").click();

      // Description should be visible immediately
      const description = page
        .locator(".task-item .task-description")
        .first();
      await expect(description).toBeVisible();
      await expect(description).toHaveText(
        "Important context about this task",
      );
    });
  });

  test.describe("Urgent Flag", () => {
    test("creates task with urgent flag via modal", async ({ page }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Open create modal
      await page.locator(".new-task-btn").click();

      // Fill title
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Critical bug fix");

      // Check urgent checkbox
      const urgentCheckbox = page.locator(
        '.urgent-toggle input[type="checkbox"]',
      );
      await urgentCheckbox.check();

      // Submit
      await page.locator(".create-btn").click();

      // Verify urgent badge appears
      const taskItem = page.locator(".task-item", {
        hasText: "Critical bug fix",
      });
      await expect(taskItem).toBeVisible();
      await expect(taskItem.locator(".urgent-badge")).toBeVisible();
      await expect(taskItem.locator(".urgent-badge")).toContainText("Urgent");

      t.assertNoErrors();
    });

    test("urgent badge is visible in task panel", async ({ page }) => {
      await openTaskPanel(page);

      // Create urgent task
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Urgent deadline");
      await page.locator('.urgent-toggle input[type="checkbox"]').check();
      await page.locator(".create-btn").click();

      // Urgent badge should be immediately visible
      const urgentBadge = page.locator(".urgent-badge").first();
      await expect(urgentBadge).toBeVisible();
      await expect(urgentBadge).toContainText("Urgent");
    });
  });

  test.describe("Quick-Pick Date Buttons", () => {
    test("Tomorrow button populates due date input", async ({ page }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Open create modal
      await page.locator(".new-task-btn").click();

      // Click "Tomorrow" button
      const tomorrowBtn = page.locator(".quick-picks button", {
        hasText: "Tomorrow",
      });
      await tomorrowBtn.click();

      // Due input should be populated
      const dueInput = page.locator(
        '.modal-content input[placeholder*="tomorrow"]',
      );
      await expect(dueInput).toHaveValue("tomorrow");

      // Due preview should show parsed date
      const preview = page.locator(".due-preview");
      await expect(preview).toBeVisible();
      await expect(preview).not.toContainText("Invalid format");

      t.assertNoErrors();
    });

    test("Today button populates due date input", async ({ page }) => {
      await openTaskPanel(page);

      await page.locator(".new-task-btn").click();

      const todayBtn = page.locator(".quick-picks button", {
        hasText: "Today",
      });
      await todayBtn.click();

      const dueInput = page.locator(
        '.modal-content input[placeholder*="tomorrow"]',
      );
      await expect(dueInput).toHaveValue("today");

      const preview = page.locator(".due-preview");
      await expect(preview).toBeVisible();
      await expect(preview).not.toContainText("Invalid format");
    });

    test("Next Week button populates due date input", async ({ page }) => {
      await openTaskPanel(page);

      await page.locator(".new-task-btn").click();

      const nextWeekBtn = page.locator(".quick-picks button", {
        hasText: "Next Week",
      });
      await nextWeekBtn.click();

      const dueInput = page.locator(
        '.modal-content input[placeholder*="tomorrow"]',
      );
      await expect(dueInput).toHaveValue("next week");

      const preview = page.locator(".due-preview");
      await expect(preview).toBeVisible();
      await expect(preview).not.toContainText("Invalid format");
    });

    test("creates task with quick-pick date", async ({ page }) => {
      await openTaskPanel(page);

      await page.locator(".new-task-btn").click();

      // Fill title
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Meeting tomorrow");

      // Click Tomorrow button
      const tomorrowBtn = page.locator(".quick-picks button", {
        hasText: "Tomorrow",
      });
      await tomorrowBtn.click();

      // Create task
      await page.locator(".create-btn").click();

      // Verify task has due date
      const taskItem = page.locator(".task-item", {
        hasText: "Meeting tomorrow",
      });
      await expect(taskItem).toBeVisible();
      await expect(taskItem.locator(".task-due")).toBeVisible();
      await expect(taskItem.locator(".task-due")).toContainText("Due");
    });
  });

  test.describe("Sort Toggle", () => {
    test("sort toggle changes task order", async ({ page }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Create two tasks with different due dates
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Task A");
      await page
        .locator('.modal-content input[placeholder*="tomorrow"]')
        .fill("in 2 days");
      await page.locator(".create-btn").click();

      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Task B");
      await page
        .locator('.modal-content input[placeholder*="tomorrow"]')
        .fill("tomorrow");
      await page.locator(".create-btn").click();

      // Get initial order (creation order)
      const taskList = page.locator(".task-list .task-item");
      const firstTaskBefore = await taskList.first().innerText();

      // Click sort toggle to sort by due date (ascending)
      const sortToggle = page.locator(".sort-toggle");
      await sortToggle.click();

      // Wait for re-render
      await page.waitForTimeout(100);

      // Task B (tomorrow) should now be first
      const firstTaskAfter = await taskList.first().innerText();
      expect(firstTaskAfter).toContain("Task B");
      expect(firstTaskBefore).not.toBe(firstTaskAfter);

      t.assertNoErrors();
    });

    test("sort toggle cycles through modes", async ({ page }) => {
      await openTaskPanel(page);

      // Create task to enable sort toggle
      await createTaskViaCommand(page, "/task Sample task");

      const sortToggle = page.locator(".sort-toggle");

      // Initial state: creation order (⇅)
      await expect(sortToggle).toContainText("⇅");

      // Click to sort due date ascending (↑)
      await sortToggle.click();
      await expect(sortToggle).toContainText("↑");

      // Click to sort due date descending (↓)
      await sortToggle.click();
      await expect(sortToggle).toContainText("↓");

      // Click to return to creation order (⇅)
      await sortToggle.click();
      await expect(sortToggle).toContainText("⇅");
    });
  });

  test.describe("Search Filter", () => {
    test("search filters tasks by title", async ({ page }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Create three tasks
      await createTaskViaCommand(page, "/task Buy groceries");
      await createTaskViaCommand(page, "/task Write code");
      await createTaskViaCommand(page, "/task Buy tickets");

      // All three should be visible
      await expect(page.locator(".task-item")).toHaveCount(3);

      // Search for "Buy"
      const searchInput = page.locator(".search-input");
      await searchInput.fill("Buy");

      // Only two tasks should be visible
      await expect(page.locator(".task-item")).toHaveCount(2);
      await expect(
        page.locator(".task-item", { hasText: "Buy groceries" }),
      ).toBeVisible();
      await expect(
        page.locator(".task-item", { hasText: "Buy tickets" }),
      ).toBeVisible();
      await expect(
        page.locator(".task-item", { hasText: "Write code" }),
      ).not.toBeVisible();

      t.assertNoErrors();
    });

    test("search filters tasks by description", async ({ page }) => {
      await openTaskPanel(page);

      // Create task with description
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Project work");
      await page
        .locator(".description-input")
        .fill("Review documentation");
      await page.locator(".create-btn").click();

      // Create another task without matching description
      await createTaskViaCommand(page, "/task Unrelated task");

      // Search by description keyword
      const searchInput = page.locator(".search-input");
      await searchInput.fill("documentation");

      // Only task with matching description should be visible
      await expect(page.locator(".task-item")).toHaveCount(1);
      await expect(
        page.locator(".task-item", { hasText: "Project work" }),
      ).toBeVisible();
    });

    test("search is case insensitive", async ({ page }) => {
      await openTaskPanel(page);

      await createTaskViaCommand(page, "/task Important Meeting");

      // Search with lowercase
      const searchInput = page.locator(".search-input");
      await searchInput.fill("important");

      await expect(page.locator(".task-item")).toHaveCount(1);
      await expect(
        page.locator(".task-item", { hasText: "Important Meeting" }),
      ).toBeVisible();
    });

    test("clearing search shows all tasks", async ({ page }) => {
      await openTaskPanel(page);

      await createTaskViaCommand(page, "/task First task");
      await createTaskViaCommand(page, "/task Second task");

      const searchInput = page.locator(".search-input");

      // Filter
      await searchInput.fill("First");
      await expect(page.locator(".task-item")).toHaveCount(1);

      // Clear filter
      await searchInput.clear();
      await expect(page.locator(".task-item")).toHaveCount(2);
    });
  });

  test.describe("Search Empty State", () => {
    test("no results when searching non-existent keyword", async ({
      page,
    }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Create some tasks
      await createTaskViaCommand(page, "/task Task one");
      await createTaskViaCommand(page, "/task Task two");

      // Verify tasks exist
      await expect(page.locator(".task-item")).toHaveCount(2);

      // Search for non-existent keyword
      const searchInput = page.locator(".search-input");
      await searchInput.fill("nonexistentkeyword123");

      // No tasks should be visible
      await expect(page.locator(".task-item")).toHaveCount(0);

      t.assertNoErrors();
    });

    test("no results shows empty panel", async ({ page }) => {
      await openTaskPanel(page);

      await createTaskViaCommand(page, "/task Sample task");

      // Search for something that won't match
      const searchInput = page.locator(".search-input");
      await searchInput.fill("zzzzz");

      // Task list should have no items
      await expect(page.locator(".task-list .task-item")).toHaveCount(0);
    });
  });

  test.describe("Urgent Toggle on Existing Task", () => {
    test("toggles urgent flag on existing task", async ({ page }) => {
      const t = trackErrors(page);
      await openTaskPanel(page);

      // Create non-urgent task
      await createTaskViaCommand(page, "/task Regular task");

      const taskItem = page.locator(".task-item", { hasText: "Regular task" });
      await expect(taskItem).toBeVisible();

      // Verify no urgent badge initially
      await expect(taskItem.locator(".urgent-badge")).not.toBeVisible();

      // Click urgent toggle button
      const urgentToggleBtn = taskItem.locator(".urgent-toggle-btn");
      await urgentToggleBtn.click();

      // Urgent badge should now appear
      await expect(taskItem.locator(".urgent-badge")).toBeVisible();
      await expect(taskItem.locator(".urgent-badge")).toContainText("Urgent");

      t.assertNoErrors();
    });

    test("removes urgent flag when toggled off", async ({ page }) => {
      await openTaskPanel(page);

      // Create urgent task
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Urgent task");
      await page.locator('.urgent-toggle input[type="checkbox"]').check();
      await page.locator(".create-btn").click();

      const taskItem = page.locator(".task-item", { hasText: "Urgent task" });

      // Verify urgent badge exists
      await expect(taskItem.locator(".urgent-badge")).toBeVisible();

      // Click urgent toggle to remove
      await taskItem.locator(".urgent-toggle-btn").click();

      // Badge should be removed
      await expect(taskItem.locator(".urgent-badge")).not.toBeVisible();
    });

    test("urgent toggle button is visible", async ({ page }) => {
      await openTaskPanel(page);

      await createTaskViaCommand(page, "/task Check toggle");

      const taskItem = page.locator(".task-item").first();
      const urgentToggleBtn = taskItem.locator(".urgent-toggle-btn");

      // Toggle button should be visible in task meta
      await expect(urgentToggleBtn).toBeVisible();
    });
  });

  test.describe("Combined Features", () => {
    test("urgent tasks appear first when sorted", async ({ page }) => {
      await openTaskPanel(page);

      // Create non-urgent task with early due date
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Non-urgent early");
      await page
        .locator('.modal-content input[placeholder*="tomorrow"]')
        .fill("tomorrow");
      await page.locator(".create-btn").click();

      // Create urgent task with later due date
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Urgent later");
      await page
        .locator('.modal-content input[placeholder*="tomorrow"]')
        .fill("in 3 days");
      await page.locator('.urgent-toggle input[type="checkbox"]').check();
      await page.locator(".create-btn").click();

      // Sort by due date
      await page.locator(".sort-toggle").click();

      // Urgent task should be first despite later due date
      const firstTask = page.locator(".task-list .task-item").first();
      await expect(firstTask).toContainText("Urgent later");
      await expect(firstTask.locator(".urgent-badge")).toBeVisible();
    });

    test("search works with task descriptions and urgent flags", async ({
      page,
    }) => {
      await openTaskPanel(page);

      // Create urgent task with description
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Deploy application");
      await page
        .locator(".description-input")
        .fill("Production deployment with monitoring");
      await page.locator('.urgent-toggle input[type="checkbox"]').check();
      await page.locator(".create-btn").click();

      // Create non-urgent task
      await createTaskViaCommand(page, "/task Update docs");

      // Search by description
      const searchInput = page.locator(".search-input");
      await searchInput.fill("monitoring");

      // Only urgent task should be visible
      await expect(page.locator(".task-item")).toHaveCount(1);
      const visibleTask = page.locator(".task-item").first();
      await expect(visibleTask).toContainText("Deploy application");
      await expect(visibleTask.locator(".urgent-badge")).toBeVisible();
    });

    test("quick-pick dates show in search results", async ({ page }) => {
      await openTaskPanel(page);

      // Create task with Tomorrow quick-pick
      await page.locator(".new-task-btn").click();
      await page
        .locator('.modal-content input[placeholder="What needs to be done?"]')
        .fill("Tomorrow's meeting");
      await page
        .locator(".quick-picks button", { hasText: "Tomorrow" })
        .click();
      await page.locator(".create-btn").click();

      // Create another task
      await createTaskViaCommand(page, "/task Other work");

      // Search for the task
      const searchInput = page.locator(".search-input");
      await searchInput.fill("meeting");

      // Task should be visible with due date
      const taskItem = page.locator(".task-item").first();
      await expect(taskItem).toContainText("Tomorrow's meeting");
      await expect(taskItem.locator(".task-due")).toBeVisible();
    });
  });
});
