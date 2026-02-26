import { test, expect } from "./utils/fixtures";
import {
	createAndJoinRoom,
	sendMessage,
	createTask,
} from "./utils/room-helpers";

/**
 * Extended mobile layout tests — covers manual verification items
 * for mobile UX: font-size auto-zoom prevention, scroll behavior,
 * and coach mark overflow.
 *
 * Runs on mobile-iphone and mobile-pixel projects via testMatch
 * in playwright.config.ts.
 */

/** Open the task panel via MobileNav bottom tab (mobile viewport). */
async function openTaskPanelMobile(page: import("@playwright/test").Page) {
	const mobileNav = page.locator(".mobile-nav .nav-item", { hasText: "Tasks" });
	if (await mobileNav.isVisible({ timeout: 3_000 }).catch(() => false)) {
		await mobileNav.click();
		await expect(page.locator(".task-panel")).toBeVisible({ timeout: 5_000 });
	} else {
		// Fallback to desktop toggle if MobileNav not rendered
		await page.locator(".tasks-toggle").click();
		await expect(page.locator(".task-panel")).toBeVisible();
	}
}

test.describe("Mobile UX: Auto-Zoom Prevention", () => {
	test("all inputs have font-size >= 16px to prevent iOS auto-zoom", async ({
		page,
	}) => {
		await createAndJoinRoom(page, "MobileUser");

		// Check all visible inputs in the room
		const inputs = page.locator("input:visible, textarea:visible");
		const count = await inputs.count();
		expect(count).toBeGreaterThan(0);

		for (let i = 0; i < count; i++) {
			const input = inputs.nth(i);
			const fontSize = await input.evaluate(
				(el) => parseFloat(getComputedStyle(el).fontSize),
			);
			const placeholder = await input.getAttribute("placeholder");
			expect(
				fontSize,
				`Input "${placeholder}" has font-size ${fontSize}px (< 16px causes iOS auto-zoom)`,
			).toBeGreaterThanOrEqual(16);
		}
	});

	test("room join page inputs have font-size >= 16px", async ({ page }) => {
		const roomId = "a".repeat(32);
		await page.goto(`/room/${roomId}`, { waitUntil: "networkidle" });

		const inputs = page.locator("input:visible");
		const count = await inputs.count();

		for (let i = 0; i < count; i++) {
			const fontSize = await inputs.nth(i).evaluate(
				(el) => parseFloat(getComputedStyle(el).fontSize),
			);
			expect(fontSize).toBeGreaterThanOrEqual(16);
		}
	});
});

test.describe("Mobile UX: Scroll Behavior", () => {
	test("message list scrolls with many messages", async ({ page }) => {
		await createAndJoinRoom(page, "Scroller");

		// Send enough messages to exceed viewport
		for (let i = 0; i < 20; i++) {
			await sendMessage(page, `scroll-test-msg-${i}`);
		}

		// Wait for last message to appear
		await expect(
			page.locator(".message", { hasText: "scroll-test-msg-19" }),
		).toBeVisible({ timeout: 10_000 });

		// Message container should be scrollable
		const isScrollable = await page.evaluate(() => {
			// Check .messages and .messages-col — one of them should overflow
			for (const sel of [".messages", ".messages-col"]) {
				const el = document.querySelector(sel);
				if (el && el.scrollHeight > el.clientHeight + 10) return true;
			}
			return false;
		});
		expect(isScrollable).toBe(true);
	});

	test("task panel scrolls with many tasks", async ({ page }) => {
		await createAndJoinRoom(page, "TaskScroller");

		// Create tasks from chat view first (composer is visible in Chat mode)
		// 15 tasks ensures overflow even on tall viewports like Pixel 7 (915px CSS height)
		for (let i = 0; i < 15; i++) {
			await sendMessage(page, `/task scroll-task-${i}`);
			// Wait briefly for task creation
			await page.waitForTimeout(300);
		}

		// Switch to Tasks view on mobile
		await openTaskPanelMobile(page);

		// Wait for tasks to appear
		await expect(
			page.locator(".task-item", { hasText: "scroll-task-14" }),
		).toBeVisible({ timeout: 10_000 });

		// Task panel should be scrollable (.panel-body is the overflow-y:auto container)
		const isScrollable = await page.evaluate(() => {
			for (const sel of [".panel-body", ".task-panel", ".task-list", ".tasks-col"]) {
				const el = document.querySelector(sel);
				if (el && el.scrollHeight > el.clientHeight + 10) return true;
			}
			return false;
		});
		expect(isScrollable).toBe(true);
	});
});

test.describe("Mobile UX: Coach Marks", () => {
	test("coach marks do not overflow viewport on small screens", async ({
		page,
	}) => {
		// Don't suppress walkthrough — we want to see coach marks
		await page.addInitScript(() => {
			localStorage.removeItem("weave-walkthrough-seen");
		});

		// Create and join room to trigger coach marks
		await page.goto("/", { waitUntil: "networkidle" });
		await page.locator("button", { hasText: "New Room" }).click();
		await expect(
			page.locator('input[placeholder="What should we call you?"]'),
		).toBeVisible({ timeout: 10_000 });
		await page
			.locator('input[placeholder="What should we call you?"]')
			.fill("CoachTest");
		await page.locator("button", { hasText: "Join Securely" }).click();

		// Wait for room to load
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// Check if coach overlay appeared
		const overlay = page.locator(".coach-overlay");
		if (await overlay.isVisible({ timeout: 3_000 }).catch(() => false)) {
			const viewport = page.viewportSize()!;

			// Check all coach mark elements are within viewport bounds
			const marks = page.locator(
				".coach-overlay .coach-step, .coach-overlay .coach-card, .coach-overlay [class*='coach']",
			);
			const markCount = await marks.count();

			for (let i = 0; i < markCount; i++) {
				const box = await marks.nth(i).boundingBox();
				if (!box) continue;

				// Element should not extend beyond viewport
				expect(
					box.x + box.width,
					`Coach mark ${i} overflows right edge`,
				).toBeLessThanOrEqual(viewport.width + 2); // 2px tolerance
				expect(
					box.y + box.height,
					`Coach mark ${i} overflows bottom edge`,
				).toBeLessThanOrEqual(viewport.height + 50); // some vertical tolerance for scroll
			}
		}
	});
});
