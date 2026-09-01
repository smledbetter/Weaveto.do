import { test, expect } from "@playwright/test";
import { createAndJoinRoom } from "./utils/room-helpers";
import { newDeviceContext, joinExistingRoom } from "./utils/context-helpers";

/**
 * Rapidly created tasks must all reach the other members.
 *
 * The app sent one relay frame per task event. That made bulk creation
 * indistinguishable from a flood: creating tasks quickly exceeded the relay's
 * per-connection rate limit and the client was disconnected with 4029 partway
 * through, losing the rest. Raising the limit would not fix it, because
 * nothing bounds how many tasks someone creates.
 *
 * Task events are now coalesced into one frame. This drives the whole path,
 * because the batch has to survive encryption, the relay, and a peer's
 * decrypt-and-apply. A batch that is sent but not understood on receipt looks
 * exactly like a batch that was never sent.
 */

const TASK_COUNT = 30;

test.describe("Bulk task creation", () => {
	test.describe.configure({ timeout: 120_000 });

	test("every rapidly created task reaches the other member", async ({
		browser,
	}) => {
		const ctxA = await newDeviceContext(browser);
		const ctxB = await newDeviceContext(browser);
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		try {
			const roomUrl = await createAndJoinRoom(pageA, "Alice");
			await joinExistingRoom(pageB, roomUrl, "Bob");
			await pageA.waitForTimeout(3_000);

			const input = pageA.locator(".composer input");
			for (let i = 1; i <= TASK_COUNT; i++) {
				await input.fill(`/task Batched ${i}`);
				await input.press("Enter");
			}

			// The last one is the one a dropped batch loses, so wait on it.
			await expect(
				pageB.locator(".task-item", { hasText: `Batched ${TASK_COUNT}` }),
				"Bob should receive the last of a rapid burst of tasks",
			).toBeVisible({ timeout: 45_000 });

			await expect
				.poll(() => pageB.locator(".task-item").count(), {
					timeout: 30_000,
					message: "Bob should end up with every task Alice created",
				})
				.toBeGreaterThanOrEqual(TASK_COUNT);
		} finally {
			await ctxA.close();
			await ctxB.close();
		}
	});

	test("the sender is not disconnected for creating tasks quickly", async ({
		page,
	}) => {
		// A rate-limit close shows as a reconnect. Creating tasks is an ordinary
		// thing to do and must never look like abuse to the relay.
		await createAndJoinRoom(page, "Alice");

		const input = page.locator(".composer input");
		for (let i = 1; i <= TASK_COUNT; i++) {
			await input.fill(`/task Rapid ${i}`);
			await input.press("Enter");
		}

		await page.waitForTimeout(3_000);
		await expect(
			page.locator("text=Reconnecting..."),
			"creating tasks quickly should not drop the connection",
		).toHaveCount(0);
	});
});
