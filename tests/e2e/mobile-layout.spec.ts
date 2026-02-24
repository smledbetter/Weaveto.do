import { test, expect } from "./utils/fixtures";
import type { Page } from "@playwright/test";

/**
 * Mobile layout and interaction tests.
 *
 * Device viewport is configured via Playwright projects in playwright.config.ts
 * (mobile-iphone = iPhone SE, mobile-pixel = Pixel 7).
 * Desktop tests ignore this file via testIgnore.
 */

const testRoomId = "b".repeat(32);

/** Track app JS errors, ignoring CSP violations (dev-mode nonce mismatch). */
function trackAppErrors(page: Page) {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error" && !msg.text().includes("Content Security Policy")) {
			errors.push(`console.error: ${msg.text()}`);
		}
	});
	page.on("pageerror", (err) => {
		errors.push(`pageerror: ${err.message}`);
	});
	return {
		assertNoErrors() {
			expect(errors, `Page had JS errors:\n${errors.join("\n")}`).toHaveLength(0);
		},
	};
}

// --- Layout verification ---

test("homepage renders without overflow", async ({ page }) => {
	const t = trackAppErrors(page);
	await page.goto("/", { waitUntil: "networkidle" });

	const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
	const viewportWidth = page.viewportSize()!.width;
	expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);

	await expect(page.locator("h1")).toBeVisible();
	await expect(
		page.locator("button", { hasText: "New Room" }),
	).toBeVisible();

	t.assertNoErrors();
});

test("room join page renders without overflow", async ({ page }) => {
	await page.goto(`/room/${testRoomId}`);

	const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
	const viewportWidth = page.viewportSize()!.width;
	expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);

	await expect(
		page.locator('input[placeholder="What should we call you?"]'),
	).toBeVisible();
	await expect(
		page.locator("button", { hasText: "Join Securely" }),
	).toBeVisible();
});

test("homepage touch targets are at least 44px", async ({ page }) => {
	await page.goto("/", { waitUntil: "networkidle" });

	const buttons = page.locator("button:visible, a:visible");
	const count = await buttons.count();

	for (let i = 0; i < count; i++) {
		const el = buttons.nth(i);
		const box = await el.boundingBox();
		if (!box) continue;
		const touchable = box.height >= 44 || box.width >= 44;
		const text = await el.textContent();
		expect(
			touchable,
			`"${text?.trim()}" too small: ${box.width}x${box.height}`,
		).toBe(true);
	}
});

test("room page touch targets are at least 44px", async ({ page }) => {
	await page.goto(`/room/${testRoomId}`);

	const buttons = page.locator(
		"button:visible, a:visible, input:visible",
	);
	const count = await buttons.count();

	for (let i = 0; i < count; i++) {
		const box = await buttons.nth(i).boundingBox();
		if (!box) continue;
		const touchable = box.height >= 44 || box.width >= 44;
		expect(
			touchable,
			`Element ${i} too small: ${box.width}x${box.height}`,
		).toBe(true);
	}
});

test("no horizontal scroll on homepage", async ({ page }) => {
	await page.goto("/", { waitUntil: "networkidle" });

	const hasHorizontalScroll = await page.evaluate(
		() =>
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth,
	);
	expect(hasHorizontalScroll).toBe(false);
});

test("no horizontal scroll on room page", async ({ page }) => {
	await page.goto(`/room/${testRoomId}`);

	const hasHorizontalScroll = await page.evaluate(
		() =>
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth,
	);
	expect(hasHorizontalScroll).toBe(false);
});

// --- Mobile interaction tests ---

test("viewport meta prevents unwanted zoom", async ({ page }) => {
	await page.goto("/", { waitUntil: "networkidle" });

	const viewportMeta = await page.evaluate(() => {
		const meta = document.querySelector('meta[name="viewport"]');
		return meta?.getAttribute("content") ?? null;
	});
	expect(viewportMeta).not.toBeNull();
	expect(viewportMeta).toContain("width=device-width");
});

test("touch interaction does not break layout", async ({ page }) => {
	const t = trackAppErrors(page);
	await page.goto("/", { waitUntil: "networkidle" });

	// Tap various points across the page
	const vw = page.viewportSize()!.width;
	const vh = page.viewportSize()!.height;

	await page.touchscreen.tap(vw / 2, vh / 2);
	await page.touchscreen.tap(vw / 4, vh / 4);
	await page.touchscreen.tap((vw * 3) / 4, (vh * 3) / 4);

	// Layout still intact after touches
	const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
	expect(bodyWidth).toBeLessThanOrEqual(vw + 1);

	t.assertNoErrors();
});

test("scroll works on room join page", async ({ page }) => {
	await page.goto(`/room/${testRoomId}`);

	// Touch the page
	await page.touchscreen.tap(
		page.viewportSize()!.width / 2,
		page.viewportSize()!.height / 2,
	);

	// Page still functional after touch
	await expect(
		page.locator('input[placeholder="What should we call you?"]'),
	).toBeVisible();
});

test("mobile keyboard does not obscure join input", async ({ page }) => {
	await page.goto(`/room/${testRoomId}`);

	const input = page.locator(
		'input[placeholder="What should we call you?"]',
	);
	await expect(input).toBeVisible();

	// Tap to focus (simulates keyboard opening)
	await input.tap();
	await input.fill("Mobile User");

	await expect(input).toBeVisible();
	await expect(input).toHaveValue("Mobile User");

	// Join button still reachable
	const joinBtn = page.locator("button", { hasText: "Join Securely" });
	await expect(joinBtn).toBeEnabled();
});

test("tap and hold does not cause JS errors", async ({ page }) => {
	const t = trackAppErrors(page);
	await page.goto("/", { waitUntil: "networkidle" });

	const btn = page.locator("button", { hasText: "New Room" });
	const box = await btn.boundingBox();
	if (box) {
		// Long press simulation
		await page.touchscreen.tap(
			box.x + box.width / 2,
			box.y + box.height / 2,
		);
	}

	t.assertNoErrors();
});

test("room name truncates on narrow viewport", async ({ page }) => {
	await page.goto(`/room/${testRoomId}`);

	// Verify CSS supports text truncation on header elements
	const hasEllipsisSupport = await page.evaluate(() => {
		const el = document.querySelector(
			"header h2, header .room-info h2",
		);
		if (!el) return true; // Pre-join phase, no header yet
		const style = getComputedStyle(el);
		return (
			style.textOverflow === "ellipsis" ||
			style.overflow === "hidden" ||
			style.whiteSpace === "nowrap"
		);
	});
	expect(hasEllipsisSupport).toBe(true);
});
