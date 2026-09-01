import { test, expect } from "@playwright/test";
import { createAndJoinRoom } from "./utils/room-helpers";
import { newDeviceContext, joinExistingRoom } from "./utils/context-helpers";

/**
 * A member's name must reach the other members and nothing else.
 *
 * It used to travel in the `join` message, so the relay held a name for every
 * person in every room, beside their address and their activity. People put
 * their real names in that box. It now rides in the Olm-encrypted key share
 * that members exchange at join anyway, so the relay routes it as ciphertext.
 *
 * Both halves have to be tested together. Removing the name from the join is
 * easy and useless on its own, because the room stops working. Keeping the
 * room working is easy and useless on its own, because the name may simply
 * have gone back on the wire somewhere else.
 */

/** A distinctive name, so finding it in a frame is unambiguous. */
const ALICE = "Wilhelmina Q Farnsworth";
const BOB = "Bartholomew Nightingale";

test.describe("Display names", () => {
	test.describe.configure({ timeout: 180_000 });

	test("reach the other member, and never appear on the wire", async ({
		browser,
	}) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		// Record every frame each client sends to or receives from the relay.
		// Anything a name shows up in is something the relay can read.
		const frames: string[] = [];
		for (const page of [pageA, pageB]) {
			page.on("websocket", (ws) => {
				ws.on("framesent", (f) => frames.push(String(f.payload)));
				ws.on("framereceived", (f) => frames.push(String(f.payload)));
			});
		}

		try {
			const roomUrl = await createAndJoinRoom(pageA, ALICE);
			await joinExistingRoom(pageB, roomUrl, BOB);

			// Each has to end up seeing the other's real name, not a placeholder.
			await expect(
				pageB.locator("body"),
				"Bob should learn Alice's name over the encrypted channel",
			).toContainText(ALICE, { timeout: 45_000 });

			await expect(
				pageA.locator("body"),
				"Alice should learn Bob's name over the encrypted channel",
			).toContainText(BOB, { timeout: 45_000 });

			// Now the half that matters. Neither name may appear in any frame.
			expect(frames.length, "no relay traffic was captured").toBeGreaterThan(0);

			const leaked = frames.filter(
				(f) => f.includes(ALICE) || f.includes(BOB),
			);
			expect(
				leaked,
				`a display name appeared in ${leaked.length} relay frame(s), so the relay can read it`,
			).toEqual([]);
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("a member is identifiable before their name arrives", async ({
		page,
	}) => {
		// Names now arrive after the key exchange rather than with the join, so
		// there is a window where the room knows someone is there and not who.
		// An empty space in that window is a worse experience than a stable
		// stand-in, and it makes two unnamed members indistinguishable.
		await createAndJoinRoom(page, ALICE);
		await expect(page.locator("header .room-info h2")).not.toBeEmpty({
			timeout: 30_000,
		});
	});
});
