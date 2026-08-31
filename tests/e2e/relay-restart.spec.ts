import { test, expect, type Page } from "@playwright/test";
import { createAndJoinRoom, sendMessage } from "./utils/room-helpers";
import { newDeviceContext, joinExistingRoom } from "./utils/context-helpers";
import { restartRelay, handBackRelay } from "./utils/relay-control";
import type { ChildProcess } from "node:child_process";

/**
 * A relay restart must not destroy live rooms.
 *
 * Rooms live in a single in-process Map, so every deploy loses all of them.
 * The client's reconnect join omits `create`, so the restarted relay answers
 * `room_not_found` and every member is told the room "does not exist or has
 * expired" — for a planned deploy, mid-conversation.
 *
 * That makes the relay un-deployable as a public service: you can never ship a
 * fix without breaking everyone currently using it. These tests pin the
 * behaviour that has to replace it.
 *
 * Runs in its own single-worker project because it takes the relay port over.
 */

let spawned: ChildProcess | null = null;

test.afterEach(async () => {
	await handBackRelay(spawned);
	spawned = null;
});

/** Text the client shows when the relay reports a room it does not know. */
const GONE = /does not exist|has expired|has been deleted/i;

async function expectStillInRoom(page: Page, who: string) {
	await expect(
		page.locator("header .room-info h2"),
		`${who} should still be in the room`,
	).not.toBeEmpty({ timeout: 30_000 });

	const body = await page.locator("body").innerText();
	expect(
		GONE.test(body),
		`${who} was told the room is gone after a relay restart`,
	).toBe(false);
}

test.describe.serial("Relay restart", () => {
	test.describe.configure({ timeout: 180_000 });

	test("a solo member is not told the room disappeared", async ({ page }) => {
		await createAndJoinRoom(page, "Alice");
		await sendMessage(page, "before-restart");

		spawned = await restartRelay();

		// Reconnect uses exponential backoff from 1s; give it several attempts.
		await page.waitForTimeout(12_000);
		await expectStillInRoom(page, "Alice");
	});

	test("two members keep the same room across a restart", async ({ browser }) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");
			await pageA.waitForTimeout(3_000);

			await sendMessage(pageA, "before-restart-alice");
			await expect(
				pageB.locator(".message", { hasText: "before-restart-alice" }),
			).toBeVisible({ timeout: 15_000 });

			spawned = await restartRelay();
			await pageA.waitForTimeout(15_000);

			await expectStillInRoom(pageA, "Alice");
			await expectStillInRoom(pageB, "Bob");
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("messaging resumes after a restart without a manual rejoin", async ({
		browser,
	}) => {
		// The point of the whole change: a deploy should be invisible, not a
		// conversation ending.
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");
			await pageA.waitForTimeout(3_000);

			spawned = await restartRelay();
			// Reconnect, re-join, and a fresh Olm/Megolm exchange all have to land.
			await pageA.waitForTimeout(20_000);

			await sendMessage(pageA, "after-restart-alice");
			await expect(
				pageB.locator(".message", { hasText: "after-restart-alice" }),
				"Bob should receive a message Alice sent after the relay restarted",
			).toBeVisible({ timeout: 30_000 });
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});
});
