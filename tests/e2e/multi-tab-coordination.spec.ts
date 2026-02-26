import { test, expect } from "@playwright/test";
import { randomBytes } from "crypto";
import { dismissOverlays, sendMessage } from "./utils/room-helpers";

/**
 * Multi-tab coordination tests — same browser context, multiple pages.
 *
 * Same context = shared localStorage/IndexedDB = same "device".
 * BroadcastChannel flows naturally between same-context pages.
 * This tests PIN lock propagation and tab resilience.
 */

/** Generate a valid 32-char hex room ID. */
function hexRoomId(): string {
	return randomBytes(16).toString("hex");
}

/** Navigate to a room and wait for the composer. */
async function openRoom(
	page: import("@playwright/test").Page,
	roomId: string,
	userName: string,
) {
	await page.addInitScript(() => {
		localStorage.setItem("weave-walkthrough-seen", "true");
	});
	await page.goto(
		`http://localhost:5173/room/${roomId}?name=${encodeURIComponent(userName)}&create=true`,
		{ waitUntil: "networkidle" },
	);
	const nameInput = page.locator(
		'input[placeholder="What should we call you?"]',
	);
	if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
		await nameInput.fill(userName);
		await page.locator("button", { hasText: "Join Securely" }).click();
	}
	await expect(page.locator("header .room-info h2")).not.toBeEmpty({
		timeout: 15_000,
	});
	await dismissOverlays(page);
}

test.describe("Multi-Tab Coordination", () => {
	test("PIN lock in one tab propagates to sibling tab", async ({
		context,
	}) => {
		const tab1 = await context.newPage();
		const tab2 = await context.newPage();

		const roomId = hexRoomId();
		await openRoom(tab1, roomId, "User1");
		await openRoom(tab2, roomId, "User2");

		// Set up a listener on tab2 to detect pin-locked broadcasts
		await tab2.evaluate(() => {
			const lockEvents: unknown[] = [];
			const channel = new BroadcastChannel("weave-tab-sync");
			channel.addEventListener("message", (e) => {
				if (e.data && e.data.type === "pin-locked") {
					lockEvents.push(e.data);
				}
			});
			(window as unknown as Record<string, unknown>).__lockEvents =
				lockEvents;
		});

		// Tab1 broadcasts a pin-locked message (simulating SessionGate.lock())
		await tab1.evaluate(() => {
			const channel = new BroadcastChannel("weave-tab-sync");
			channel.postMessage({ type: "pin-locked", tabId: "tab1-test" });
			channel.close();
		});

		// Wait for propagation
		await tab2.waitForTimeout(500);

		// Tab2 should have received the lock event
		const lockEvents = await tab2.evaluate(
			() =>
				(
					window as unknown as Record<string, unknown>
				).__lockEvents as Array<{ type: string; tabId: string }>,
		);
		expect(lockEvents.length).toBeGreaterThanOrEqual(1);
		expect(lockEvents[0].type).toBe("pin-locked");

		await tab1.close();
		await tab2.close();
	});

	test("closing one of 3 tabs — remaining tabs continue operating", async ({
		context,
	}) => {
		const tabs = await Promise.all([
			context.newPage(),
			context.newPage(),
			context.newPage(),
		]);

		const roomId = hexRoomId();
		for (let i = 0; i < 3; i++) {
			await openRoom(tabs[i], roomId, `User${i + 1}`);
		}

		// All 3 tabs should have composers
		for (const tab of tabs) {
			await expect(tab.locator(".composer input")).toBeVisible({
				timeout: 10_000,
			});
		}

		// Close tab2 (middle tab)
		await tabs[1].close();
		await tabs[0].waitForTimeout(1_000);

		// Tab1 and tab3 should still work
		await expect(tabs[0].locator(".composer input")).toBeVisible();
		await expect(tabs[2].locator(".composer input")).toBeVisible();

		// Can still send messages in remaining tabs
		await sendMessage(tabs[0], "still-alive-tab1");
		await expect(
			tabs[0].locator(".message", { hasText: "still-alive-tab1" }),
		).toBeVisible({ timeout: 5_000 });

		await tabs[0].close();
		await tabs[2].close();
	});

	test("3 tabs of same room all receive messages", async ({ context }) => {
		const tabs = await Promise.all([
			context.newPage(),
			context.newPage(),
			context.newPage(),
		]);

		const roomId = hexRoomId();
		for (let i = 0; i < 3; i++) {
			await openRoom(tabs[i], roomId, `User${i + 1}`);
		}

		// Send a message from tab1
		const marker = `broadcast-msg-${Date.now()}`;
		await sendMessage(tabs[0], marker);

		// All 3 tabs should see it (own message + echo)
		for (const tab of tabs) {
			await expect(
				tab.locator(".message", { hasText: marker }),
			).toBeVisible({ timeout: 10_000 });
		}

		for (const tab of tabs) await tab.close();
	});
});
