import { test, expect } from "@playwright/test";
import { dismissOverlays, newRoomId } from "./utils/room-helpers";

/**
 * Multi-Room Tabs (M19) E2E tests.
 *
 * Verifies that multiple rooms can be opened in separate tabs within the same
 * browser context and operate independently without interfering with each other.
 *
 * Key constraints:
 * - Same browser context → shared localStorage / IndexedDB
 * - Each tab gets its own WebSocket connection and Olm identity seed
 * - Dev mode bypasses WebAuthn; rooms auto-create on visit with ?create=true
 * - No PIN flows tested here (requires real WebAuthn setup)
 */

/** Apply the walkthrough-seen flag so coach overlays are suppressed. */
async function suppressOverlays(page: import("@playwright/test").Page) {
	await page.addInitScript(() => {
		localStorage.setItem("weave-walkthrough-seen", "true");
	});
}

/** Navigate to a room and wait until the message composer is ready. */
async function openRoom(
	page: import("@playwright/test").Page,
	roomId: string,
	userName: string,
) {
	await page.goto(
		`http://localhost:5173/room/${roomId}?name=${encodeURIComponent(userName)}&create=true`,
		{ waitUntil: "networkidle" },
	);
	// Room page may show a name-entry step even with ?name= in some flows —
	// handle both: already past it (composer visible) or still on name entry.
	const nameInput = page.locator('input[placeholder="What should we call you?"]');
	if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
		await nameInput.fill(userName);
		await page.locator("button", { hasText: "Join Securely" }).click();
	}
	await expect(page.locator("header .room-info h2")).not.toBeEmpty({
		timeout: 15_000,
	});
	await dismissOverlays(page);
}

// ─── M19: Multi-Room Tabs ────────────────────────────────────────────────────

test.describe("M19: Multi-Room Tabs", () => {
	test("two rooms in separate tabs operate independently", async ({
		context,
	}) => {
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		await suppressOverlays(tab1);
		await suppressOverlays(tab2);

		const roomId1 = newRoomId();
		const roomId2 = newRoomId();

		await openRoom(tab1, roomId1, "User1");
		await openRoom(tab2, roomId2, "User2");

		// Both tabs should show a connected room — composer is visible
		await expect(tab1.locator(".composer input")).toBeVisible({
			timeout: 10_000,
		});
		await expect(tab2.locator(".composer input")).toBeVisible({
			timeout: 10_000,
		});

		// Each tab should display its own room name (slug, not the other tab's)
		const name1 = await tab1.locator("header .room-info h2").textContent();
		const name2 = await tab2.locator("header .room-info h2").textContent();
		expect(name1).toBeTruthy();
		expect(name2).toBeTruthy();

		// Room IDs are different — names must differ (slug derived from ID)
		expect(name1).not.toEqual(name2);

		await tab1.close();
		await tab2.close();
	});

	test("closing one tab does not disrupt another", async ({ context }) => {
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		await suppressOverlays(tab1);
		await suppressOverlays(tab2);

		await openRoom(tab1, newRoomId(), "User1");
		await openRoom(tab2, newRoomId(), "User2");

		// Confirm tab2 is live before closing tab1
		await expect(tab2.locator(".composer input")).toBeVisible({
			timeout: 10_000,
		});

		// Close tab1
		await tab1.close();

		// Give any cleanup a moment to propagate
		await tab2.waitForTimeout(1_000);

		// Tab2 must still show the room (no error screen, composer still present)
		const errorScreen = tab2.locator('.error, [data-phase="error"]');
		await expect(errorScreen).toHaveCount(0);
		await expect(tab2.locator(".composer input")).toBeVisible();

		await tab2.close();
	});

	test("three rooms in separate tabs all operate", async ({ context }) => {
		const tabs = await Promise.all([
			context.newPage(),
			context.newPage(),
			context.newPage(),
		]);

		for (const tab of tabs) {
			await suppressOverlays(tab);
		}

		for (let i = 0; i < 3; i++) {
			await openRoom(tabs[i], newRoomId(), `User${i + 1}`);
		}

		// All three tabs should reach a connected state with the composer
		for (const tab of tabs) {
			await expect(tab.locator(".composer input")).toBeVisible({
				timeout: 15_000,
			});
			await expect(tab.locator("header .room-info h2")).not.toBeEmpty();
		}

		// All three room names should be distinct
		const names = await Promise.all(
			tabs.map((t) => t.locator("header .room-info h2").textContent()),
		);
		const uniqueNames = new Set(names);
		expect(uniqueNames.size).toBe(3);

		for (const tab of tabs) {
			await tab.close();
		}
	});

	test("BroadcastChannel is initialized in a room tab", async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem("weave-walkthrough-seen", "true");
		});

		const roomId = newRoomId();
		await page.goto(
			`http://localhost:5173/room/${roomId}?name=TestUser&create=true`,
			{ waitUntil: "networkidle" },
		);

		const nameInput = page.locator('input[placeholder="What should we call you?"]');
		if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
			await nameInput.fill("TestUser");
			await page.locator("button", { hasText: "Join Securely" }).click();
		}

		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 15_000,
		});

		// BroadcastChannel must be available — required for tab-sync feature
		const hasBC = await page.evaluate(
			() => typeof BroadcastChannel !== "undefined",
		);
		expect(hasBC).toBe(true);
	});

	test("tabs in the same context share no cross-room message leakage", async ({
		context,
	}) => {
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		await suppressOverlays(tab1);
		await suppressOverlays(tab2);

		const base = Date.now();
		await openRoom(tab1, newRoomId(), "Alice");
		await openRoom(tab2, newRoomId(), "Bob");

		// Alice sends a message in her room
		const secret = `secret-${base}`;
		await tab1.locator(".composer input").fill(secret);
		await tab1.locator(".composer input").press("Enter");

		// Message appears in tab1
		await expect(
			tab1.locator(".message", { hasText: secret }),
		).toBeVisible({ timeout: 5_000 });

		// Tab2 must NOT show Alice's message (different room, different key)
		await tab2.waitForTimeout(1_500);
		await expect(
			tab2.locator(".message", { hasText: secret }),
		).toHaveCount(0);

		await tab1.close();
		await tab2.close();
	});

	test("BroadcastChannel messages flow between tabs", async ({ context }) => {
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		await suppressOverlays(tab1);
		await suppressOverlays(tab2);

		await openRoom(tab1, newRoomId(), "Alice");
		await openRoom(tab2, newRoomId(), "Bob");

		// Set up a listener on tab2 that records incoming BroadcastChannel messages
		await tab2.evaluate(() => {
			const messages: unknown[] = [];
			const channel = new BroadcastChannel("weave-tab-sync");
			channel.addEventListener("message", (e) => {
				messages.push(e.data);
			});
			(window as unknown as Record<string, unknown>).__bcMessages = messages;
		});

		// Send a pin-locked broadcast from tab1 via the same channel
		await tab1.evaluate(() => {
			const channel = new BroadcastChannel("weave-tab-sync");
			channel.postMessage({ type: "pin-locked", tabId: "test-tab-1" });
			channel.close();
		});

		// Wait briefly for the message to propagate
		await tab2.waitForTimeout(500);

		// Verify tab2 received the pin-locked message
		const messages = await tab2.evaluate(
			() =>
				(window as unknown as Record<string, unknown>).__bcMessages as Array<{
					type: string;
					tabId: string;
				}>,
		);

		const lockMessages = messages.filter((m) => m.type === "pin-locked");
		expect(lockMessages.length).toBeGreaterThanOrEqual(1);
		expect(lockMessages[0].tabId).toBe("test-tab-1");

		await tab1.close();
		await tab2.close();
	});

	test("TabSync responds to tab-ping with tab-pong", async ({ context }) => {
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		await suppressOverlays(tab1);
		await suppressOverlays(tab2);

		const base = Date.now();
		// Both tabs need to be in rooms so their TabSync instances are active
		await openRoom(tab1, newRoomId(), "Alice");
		await openRoom(tab2, newRoomId(), "Bob");

		// Set up a listener on tab1 for tab-pong responses
		await tab1.evaluate(() => {
			const pongs: unknown[] = [];
			const channel = new BroadcastChannel("weave-tab-sync");
			channel.addEventListener("message", (e) => {
				if (e.data && e.data.type === "tab-pong") {
					pongs.push(e.data);
				}
			});
			(window as unknown as Record<string, unknown>).__pongMessages = pongs;
		});

		// Send a tab-ping from tab1 — tab2's TabSync instance should respond with tab-pong
		const requestId = `ping-${base}`;
		await tab1.evaluate((reqId) => {
			const channel = new BroadcastChannel("weave-tab-sync");
			channel.postMessage({ type: "tab-ping", requestId: reqId });
			channel.close();
		}, requestId);

		// Wait for tab2's TabSync to respond
		await tab1.waitForTimeout(500);

		// Verify tab1 received a tab-pong
		const pongs = await tab1.evaluate(
			() =>
				(window as unknown as Record<string, unknown>).__pongMessages as Array<{
					type: string;
					requestId: string;
					tabId: string;
				}>,
		);

		expect(pongs.length).toBeGreaterThanOrEqual(1);
		expect(pongs[0].requestId).toBe(requestId);
		// tabId should be a UUID (from the room page's TabSync instance)
		expect(pongs[0].tabId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);

		await tab1.close();
		await tab2.close();
	});

	test("no JS errors when two tabs are open simultaneously", async ({
		context,
	}) => {
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

		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		for (const tab of [tab1, tab2]) {
			await suppressOverlays(tab);
			tab.on("console", (msg) => {
				if (msg.type() === "error") {
					const text = msg.text();
					if (!ignoredPatterns.some((p) => text.includes(p))) {
						errors.push(`console.error: ${text}`);
					}
				}
			});
			tab.on("pageerror", (err) => {
				if (!ignoredPatterns.some((p) => err.message.includes(p))) {
					errors.push(`pageerror: ${err.message}`);
				}
			});
		}

		await openRoom(tab1, newRoomId(), "Alice");
		await openRoom(tab2, newRoomId(), "Bob");

		// Brief interaction in each tab
		await tab1.locator(".composer input").fill("ping");
		await tab1.locator(".composer input").press("Enter");
		await tab2.locator(".composer input").fill("pong");
		await tab2.locator(".composer input").press("Enter");

		await tab1.waitForTimeout(1_000);
		await tab2.waitForTimeout(1_000);

		expect(
			errors,
			`Unexpected JS errors with two tabs open:\n${errors.join("\n")}`,
		).toHaveLength(0);

		await tab1.close();
		await tab2.close();
	});
});
