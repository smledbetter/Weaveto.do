import { expect, type Page } from "@playwright/test";

/** Dismiss coach marks walkthrough and key warning banner if visible. */
export async function dismissOverlays(page: Page) {
	// Coach marks walkthrough (full-screen overlay, blocks all interaction)
	const coachSkip = page.locator(".coach-overlay button", {
		hasText: /skip|got it/i,
	});
	if (await coachSkip.isVisible({ timeout: 1_000 }).catch(() => false)) {
		await coachSkip.click();
		await expect(page.locator(".coach-overlay")).not.toBeVisible({
			timeout: 2_000,
		});
	}

	// Key warning banner
	const keyBanner = page.locator(".warning-banner button", {
		hasText: "Got it",
	});
	if (await keyBanner.isVisible({ timeout: 500 }).catch(() => false)) {
		await keyBanner.click();
	}
}

/** Create a room and join as creator with given name. Returns room URL. */
export async function createAndJoinRoom(page: Page, name = "Alice") {
	await page.goto("/", { waitUntil: "networkidle" });
	await page.locator("button", { hasText: "New Room" }).click();
	await expect(
		page.locator('input[placeholder="What should we call you?"]'),
	).toBeVisible({ timeout: 10_000 });
	await page
		.locator('input[placeholder="What should we call you?"]')
		.fill(name);
	await page.locator("button", { hasText: "Join Securely" }).click();
	await expect(page.locator("header .room-info h2")).not.toBeEmpty({
		timeout: 15_000,
	});
	await dismissOverlays(page);
	return page.url();
}

/** Create a task via /task command and wait for it to appear. */
export async function createTask(page: Page, title: string) {
	const input = page.locator(".composer input");
	await input.fill(`/task ${title}`);
	await input.press("Enter");
	await expect(
		page.locator(".task-item", { hasText: title }),
	).toBeVisible({ timeout: 5_000 });
}

/** Open the task panel via header toggle. */
export async function openTaskPanel(page: Page) {
	const panel = page.locator(".task-panel");
	if (!(await panel.isVisible())) {
		await page.locator(".tasks-toggle").click();
		await expect(panel).toBeVisible();
	}
}

/** Send a chat message via the composer. */
export async function sendMessage(page: Page, text: string) {
	const input = page.locator(".composer input");
	await input.fill(text);
	await input.press("Enter");
}

/** Track app JS errors, ignoring known framework/CSP noise. */
export function trackAppErrors(page: Page) {
	const errors: string[] = [];
	const ignoredPatterns = [
		"Content Security Policy",
		"WebSocket",
		"net::ERR_",
		"Failed to fetch",
		"NetworkError",
		"[vite]",
		"[HMR]",
	];
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			const text = msg.text();
			if (!ignoredPatterns.some((p) => text.includes(p))) {
				errors.push(`console.error: ${text}`);
			}
		}
	});
	page.on("pageerror", (err) => {
		if (!ignoredPatterns.some((p) => err.message.includes(p))) {
			errors.push(`pageerror: ${err.message}`);
		}
	});
	return {
		assertNoErrors() {
			expect(
				errors,
				`Page had JS errors:\n${errors.join("\n")}`,
			).toHaveLength(0);
		},
	};
}
