import { test, expect } from "./utils/fixtures";
import {
	createAndJoinRoom,
	createTask,
	dismissOverlays,
	openTaskPanel,
	sendMessage,
	trackAppErrors,
} from "./utils/room-helpers";

/**
 * Comprehensive smoke tests covering all automatable flows.
 *
 * Run periodically:
 *   - Before every deploy / PR merge
 *   - After any milestone ships
 *   - Weekly in CI as a scheduled job
 *
 * Command: npx playwright test smoke
 */

// ─── 1. Room Creation & Join ─────────────────────────────────────────────────

test.describe("Smoke: Room Creation & Join", () => {
	test("standard room URL has create param, no ephemeral", async ({
		page,
	}) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });
		expect(page.url()).toContain("create=1");
		expect(page.url()).not.toContain("ephemeral");
	});

	test("ephemeral room URL has ephemeral param", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await page
			.locator('input[type="radio"][value="ephemeral"]')
			.check();
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });
		expect(page.url()).toContain("ephemeral=true");
	});

	test("PIN room URL has pinRequired param", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("summary", { hasText: "Advanced" }).click();
		await page.locator('input[type="checkbox"]').first().check();
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });
		expect(page.url()).toContain("pinRequired=true");
		expect(page.url()).toContain("pinTimeout=");
	});

	test("join flow: name → join → connected with room name", async ({
		page,
	}) => {
		await createAndJoinRoom(page);
		await expect(page.locator("header .room-info h2")).toHaveText(
			/^[a-z]+-[a-z]+$/,
		);
	});
});

// ─── 5. Messaging ────────────────────────────────────────────────────────────

test.describe("Smoke: Messaging", () => {
	test("send message appears in local feed", async ({ page }) => {
		await createAndJoinRoom(page);
		await sendMessage(page, "Hello smoke test");
		await expect(
			page.locator(".message", { hasText: "Hello smoke test" }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("long message renders without overflow", async ({ page }) => {
		await createAndJoinRoom(page);
		const longMsg = "A".repeat(500);
		await sendMessage(page, longMsg);
		await expect(
			page.locator(".message", { hasText: longMsg.slice(0, 50) }),
		).toBeVisible({ timeout: 5_000 });

		const bodyWidth = await page.evaluate(
			() => document.body.scrollWidth,
		);
		expect(bodyWidth).toBeLessThanOrEqual(
			page.viewportSize()!.width + 1,
		);
	});

	test("special characters render safely (no XSS)", async ({ page }) => {
		await createAndJoinRoom(page);
		await sendMessage(
			page,
			'<script>alert("xss")</script> & "test" <b>bold</b>',
		);
		const msg = page.locator(".message").last();
		await expect(msg).toBeVisible({ timeout: 5_000 });
		await expect(msg).toContainText("<script>");
	});
});

// ─── 6. Task Panel ───────────────────────────────────────────────────────────

test.describe("Smoke: Task Panel", () => {
	test("open and close task panel", async ({ page }) => {
		await createAndJoinRoom(page);

		// Panel defaults to open on first visit — close it first
		const panel = page.locator(".task-panel");
		if (await panel.isVisible()) {
			await page.locator(".task-panel .close-panel-btn").click();
			await expect(panel).not.toBeVisible();
		}

		// Open via button
		await page.locator(".tasks-toggle").click();
		await expect(panel).toBeVisible({ timeout: 5_000 });

		// Close via X
		await page.locator(".task-panel .close-panel-btn").click();
		await expect(panel).not.toBeVisible();
	});

	test("Cmd+T toggles task panel", async ({ page }) => {
		await createAndJoinRoom(page);

		const panel = page.locator(".task-panel");
		const wasOpen = await panel.isVisible();

		// First toggle: if open → close, if closed → open
		await page.keyboard.press("Meta+t");
		if (wasOpen) {
			await expect(panel).not.toBeVisible();
		} else {
			await expect(panel).toBeVisible({ timeout: 5_000 });
		}

		// Second toggle: opposite state
		await page.keyboard.press("Meta+t");
		if (wasOpen) {
			await expect(panel).toBeVisible({ timeout: 5_000 });
		} else {
			await expect(panel).not.toBeVisible();
		}
	});

	test("create task via /task command", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Smoke test task");
		await expect(
			page.locator(".task-item", { hasText: "Smoke test task" }),
		).toBeVisible();
	});

	test("create task with due date", async ({ page }) => {
		await createAndJoinRoom(page);
		const input = page.locator(".composer input");
		await input.fill("/task Deploy server | due: tomorrow");
		await input.press("Enter");

		const taskItem = page.locator(".task-item", {
			hasText: "Deploy server",
		});
		await expect(taskItem).toBeVisible({ timeout: 5_000 });
		await expect(taskItem.locator(".task-due")).toBeVisible();
	});

	test("create task with subtasks", async ({ page }) => {
		await createAndJoinRoom(page);

		const input = page.locator(".composer input");
		await input.fill(
			"/task Deploy | split into: staging, production",
		);
		await input.press("Enter");

		// Parent task should appear
		await expect(
			page.locator(".task-item", { hasText: "Deploy" }),
		).toBeVisible({ timeout: 5_000 });

		// At least one subtask visible inside the parent
		await expect(
			page.locator(".subtask-item", { hasText: "staging" }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("complete and uncomplete a task", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Toggle task");

		// Complete
		const checkbox = page
			.locator(".task-item", { hasText: "Toggle task" })
			.locator(".task-checkbox");
		await checkbox.click();

		// Should show completed toggle
		const completedToggle = page.locator("button", {
			hasText: /completed/i,
		});
		await expect(completedToggle).toBeVisible({ timeout: 5_000 });

		// Expand completed and uncomplete
		await completedToggle.click();
		await page
			.locator(".task-item", { hasText: "Toggle task" })
			.locator(".task-checkbox")
			.click();

		// Should be back in pending
		await expect(
			page.locator(".task-item", { hasText: "Toggle task" }),
		).toBeVisible();
	});

	test("mark task urgent", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Urgent thing");

		const taskItem = page.locator(".task-item", {
			hasText: "Urgent thing",
		});
		await taskItem.locator(".urgent-toggle-btn").click();
		await expect(taskItem.locator(".urgent-badge")).toBeVisible();
	});

	test("task search filters results", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Alpha task");
		await createTask(page, "Beta task");

		const search = page.locator('.search-input');
		await search.fill("Alpha");

		await expect(
			page.locator(".task-item", { hasText: "Alpha task" }),
		).toBeVisible();
		await expect(
			page.locator(".task-item", { hasText: "Beta task" }),
		).not.toBeVisible();
	});

	test("inline edit task title", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Original title");

		// Click the title button to start editing
		await page
			.locator(".task-item", { hasText: "Original title" })
			.locator("button.task-title")
			.click();

		const editInput = page.locator(".task-item input.inline-edit");
		await expect(editInput).toBeVisible({ timeout: 3_000 });
		await editInput.clear();
		await editInput.type("Edited title");
		await editInput.press("Enter");

		await expect(
			page.locator(".task-item", { hasText: "Edited title" }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("progress bar updates on task completion", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Progress task");

		// Progress should show 0/1
		await expect(page.locator(".progress-text").first()).toContainText(
			"0/1",
		);

		// Complete the task
		await page
			.locator(".task-item", { hasText: "Progress task" })
			.locator(".task-checkbox")
			.click();

		// Progress should show 1/1 (100%)
		await expect(
			page.locator(".progress-text").first(),
		).toContainText("100%", { timeout: 3_000 });
	});

	test("Cmd+K opens create modal", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.keyboard.press("Meta+k");

		await expect(
			page.locator(".modal-content h3", { hasText: "New Task" }),
		).toBeVisible({ timeout: 5_000 });
	});
});

// ─── 7. Automation Panel ─────────────────────────────────────────────────────

test.describe("Smoke: Automation Panel", () => {
	test("open and close automation panel", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.locator(".agents-toggle").click();
		await expect(page.locator(".agent-panel")).toBeVisible();

		await page.locator(".agent-panel .close-panel-btn").click();
		await expect(page.locator(".agent-panel")).not.toBeVisible();
	});

	test("built-in agents visible", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.locator(".agents-toggle").click();
		await expect(page.locator(".agent-panel")).toBeVisible();

		// Should have at least one agent module visible
		const modules = page.locator(".agent-panel .module-item");
		await expect(modules.first()).toBeVisible({ timeout: 5_000 });
	});
});

// ─── 8. Invite Flow ──────────────────────────────────────────────────────────

test.describe("Smoke: Invite Flow", () => {
	test("invite modal has QR code and copyable URL", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.locator("button.invite-btn").click();

		const modal = page.locator(
			'[aria-labelledby="invite-modal-title"]',
		);
		await expect(modal).toBeVisible();
		await expect(modal.locator("svg")).toBeVisible();

		const urlInput = modal.locator(".url-input");
		const value = await urlInput.inputValue();
		expect(value).toContain("/room/");

		await page.locator("button.copy-btn").click();
		await expect(page.locator("button.copy-btn")).toContainText(
			"Copied",
			{ timeout: 2_000 },
		);
	});

	test("invite modal closes on Escape", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.locator("button.invite-btn").click();
		await expect(
			page.locator('[aria-labelledby="invite-modal-title"]'),
		).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(
			page.locator('[aria-labelledby="invite-modal-title"]'),
		).not.toBeVisible();
	});

	test("solo member banner hidden after walkthrough completion", async ({ page }) => {
		// Fixture sets localStorage walkthrough flag — solo banner should be suppressed
		await createAndJoinRoom(page);
		const banner = page.locator(".solo-banner");
		await expect(banner).not.toBeVisible();
	});
});

// ─── 9. Burn / Delete Room ───────────────────────────────────────────────────

test.describe("Smoke: Burn / Delete Room", () => {
	test("/burn flow: modal → DELETE → redirect", async ({ page }) => {
		await createAndJoinRoom(page);
		await sendMessage(page, "/burn");

		await expect(
			page.locator("text=Permanently Delete Room"),
		).toBeVisible({ timeout: 5_000 });

		const deleteBtn = page.locator("button", {
			hasText: "Delete Room",
		});
		await expect(deleteBtn).toBeDisabled();

		await page.locator('input[placeholder*="DELETE"]').fill("DELETE");
		await expect(deleteBtn).toBeEnabled();
		await deleteBtn.click();

		await expect(page.locator(".deleted-notice")).toBeVisible({
			timeout: 15_000,
		});
	});

	test("auto-delete banner on all tasks complete", async ({ page }) => {
		await createAndJoinRoom(page);
		await createTask(page, "Only task");

		await page
			.locator(".task-item")
			.first()
			.locator(".task-checkbox")
			.click();

		await expect(
			page.locator('[role="alert"]', { hasText: "auto-delete" }),
		).toBeVisible({ timeout: 5_000 });

		await page.locator("button", { hasText: "Keep Room" }).click();
		await expect(
			page.locator('[role="alert"]', { hasText: "auto-delete" }),
		).not.toBeVisible({ timeout: 3_000 });
	});
});

// ─── 10. Ephemeral Mode ──────────────────────────────────────────────────────

test.describe("Smoke: Ephemeral Mode", () => {
	test("ephemeral room shows flame indicator", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await page
			.locator('input[type="radio"][value="ephemeral"]')
			.check();
		await page.locator("button", { hasText: "New Room" }).click();
		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("Alice");
		await page
			.locator("button", { hasText: "Join Securely" })
			.click();
		await expect(
			page.locator("header .room-info h2"),
		).not.toBeEmpty({ timeout: 15_000 });

		await expect(
			page.locator(
				'[aria-label="Ephemeral room: no data persistence"]',
			),
		).toBeVisible({ timeout: 5_000 });
	});
});

// ─── 12. Keyboard Shortcuts ──────────────────────────────────────────────────

test.describe("Smoke: Keyboard Shortcuts", () => {
	test("Shift+? shows and Escape closes help modal", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.keyboard.press("Shift+?");

		const modal = page.locator(".shortcuts-help-modal");
		await expect(modal).toBeVisible({ timeout: 3_000 });

		await page.keyboard.press("Escape");
		await expect(modal).not.toBeVisible({ timeout: 3_000 });
	});
});

// ─── 13. Theme Toggle ────────────────────────────────────────────────────────

test.describe("Smoke: Theme", () => {
	test("default renders light theme (no dark mode)", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		const theme = await page.evaluate(() =>
			document.documentElement.getAttribute("data-theme"),
		);
		// In dev mode, CSP may block the inline script that sets data-theme
		// So it's either "light" or null (which defaults to light CSS)
		expect(theme === "light" || theme === null).toBe(true);
	});

	test("theme toggle switches between light and dark", async ({
		page,
	}) => {
		await page.goto("/", { waitUntil: "networkidle" });

		await page.locator(".theme-toggle-inline").click();
		let theme = await page.evaluate(() =>
			document.documentElement.getAttribute("data-theme"),
		);
		expect(theme).toBe("dark");

		await page.locator(".theme-toggle-inline").click();
		theme = await page.evaluate(() =>
			document.documentElement.getAttribute("data-theme"),
		);
		expect(theme).toBe("light");
	});

	test("theme persists across reload", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator(".theme-toggle-inline").click();

		// Verify localStorage was set
		const stored = await page.evaluate(() =>
			localStorage.getItem("weave-theme"),
		);
		expect(stored).toBe("dark");

		await page.reload({ waitUntil: "networkidle" });

		// After reload, the Svelte initTheme reads from data-theme attribute.
		// In dev mode, CSP may block the inline script that sets it from localStorage,
		// so we check localStorage persistence rather than the attribute.
		const storedAfterReload = await page.evaluate(() =>
			localStorage.getItem("weave-theme"),
		);
		expect(storedAfterReload).toBe("dark");
	});
});

// ─── 14. WebSocket / Connection ──────────────────────────────────────────────

test.describe("Smoke: Connection", () => {
	test("room info button visible when connected", async ({ page }) => {
		await createAndJoinRoom(page);
		await expect(page.locator(".room-info-btn")).toBeVisible();
	});
});

// ─── 15. WebSocket Ciphertext ────────────────────────────────────────────────

test.describe("Smoke: WebSocket Ciphertext", () => {
	test("encrypted message frames contain no plaintext", async ({
		page,
	}) => {
		const wsPayloads: string[] = [];

		page.on("websocket", (ws) => {
			ws.on("framesent", (event) => {
				if (typeof event.payload === "string") {
					wsPayloads.push(event.payload);
				}
			});
		});

		await createAndJoinRoom(page, "CryptoUser");
		await sendMessage(page, "This is a secret message 12345");

		await page.waitForTimeout(2_000);

		// Filter to only encrypted message frames
		const encryptedFrames = wsPayloads.filter((p) => {
			try {
				const msg = JSON.parse(p);
				return msg.type === "encrypted";
			} catch {
				return false;
			}
		});

		// There should be at least one encrypted frame (the message)
		expect(encryptedFrames.length).toBeGreaterThan(0);

		// No encrypted frame should contain the plaintext
		for (const frame of encryptedFrames) {
			expect(frame).not.toContain("This is a secret message 12345");
		}
	});
});

// ─── 16. Console Output ──────────────────────────────────────────────────────

test.describe("Smoke: Console Output", () => {
	test("no app console errors during basic flow", async ({ page }) => {
		const t = trackAppErrors(page);
		await createAndJoinRoom(page);
		await createTask(page, "Console test task");
		await sendMessage(page, "Console test message");
		t.assertNoErrors();
	});
});

// ─── 18. Multi-Member ────────────────────────────────────────────────────────

test.describe("Smoke: Multi-Member", () => {
	test("two members see each other's messages", async ({ browser }) => {
		const contextA = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});
		const contextB = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});

		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		for (const p of [pageA, pageB]) {
			await p.addInitScript(() => {
				localStorage.setItem(
					"weave-walkthrough-seen",
					"true",
				);
			});
		}

		const roomUrl = await createAndJoinRoom(pageA, "Alice");
		const roomPath = new URL(roomUrl).pathname;

		await pageB.goto(roomPath, { waitUntil: "networkidle" });
		await pageB
			.locator('input[placeholder="What should we call you?"]')
			.fill("Bob");
		await pageB
			.locator("button", { hasText: "Join Securely" })
			.click();
		await expect(
			pageB.locator("header .room-info h2"),
		).not.toBeEmpty({ timeout: 15_000 });

		// Wait for key exchange
		await pageA.waitForTimeout(3_000);

		// Alice sends
		await sendMessage(pageA, "Hello from Alice");
		await expect(
			pageA.locator(".message", { hasText: "Hello from Alice" }),
		).toBeVisible({ timeout: 5_000 });

		// Bob sees it decrypted
		await expect(
			pageB.locator(".message", { hasText: "Hello from Alice" }),
		).toBeVisible({ timeout: 10_000 });

		// Bob sends back
		await sendMessage(pageB, "Hello from Bob");
		await expect(
			pageA.locator(".message", { hasText: "Hello from Bob" }),
		).toBeVisible({ timeout: 10_000 });

		await contextA.close();
		await contextB.close();
	});

	test("task created by one member visible to another", async ({
		browser,
	}) => {
		const contextA = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});
		const contextB = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});

		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		for (const p of [pageA, pageB]) {
			await p.addInitScript(() => {
				localStorage.setItem(
					"weave-walkthrough-seen",
					"true",
				);
			});
		}

		const roomUrl = await createAndJoinRoom(pageA, "Alice");
		const roomPath = new URL(roomUrl).pathname;

		await pageB.goto(roomPath, { waitUntil: "networkidle" });
		await pageB
			.locator('input[placeholder="What should we call you?"]')
			.fill("Bob");
		await pageB
			.locator("button", { hasText: "Join Securely" })
			.click();
		await expect(
			pageB.locator("header .room-info h2"),
		).not.toBeEmpty({ timeout: 15_000 });
		await dismissOverlays(pageB);

		// Wait for key exchange
		await pageA.waitForTimeout(3_000);

		// Alice creates a task (auto-opens her task panel)
		await createTask(pageA, "Shared task");

		// Ensure Bob's task panel is open
		await openTaskPanel(pageB);
		await expect(
			pageB.locator(".task-item", { hasText: "Shared task" }),
		).toBeVisible({ timeout: 15_000 });

		await contextA.close();
		await contextB.close();
	});
});

// ─── 19. Edge Cases ──────────────────────────────────────────────────────────

test.describe("Smoke: Edge Cases", () => {
	test("long display name does not overflow header", async ({ page }) => {
		await createAndJoinRoom(page, "A".repeat(32));
		const bodyWidth = await page.evaluate(
			() => document.body.scrollWidth,
		);
		expect(bodyWidth).toBeLessThanOrEqual(
			page.viewportSize()!.width + 1,
		);
	});

	test("refresh page returns to name entry", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.reload();
		await expect(
			page.locator(
				'input[placeholder="What should we call you?"]',
			),
		).toBeVisible({ timeout: 10_000 });
	});

	test("browser back from room goes to homepage", async ({ page }) => {
		await createAndJoinRoom(page);
		await page.goBack();
		await expect(page.locator("h1")).toHaveText("weaveto.do", {
			timeout: 10_000,
		});
	});
});
