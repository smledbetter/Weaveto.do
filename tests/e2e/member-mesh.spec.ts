import { test, expect, type Page } from "@playwright/test";
import { createAndJoinRoom, sendMessage } from "./utils/room-helpers";
import { newDeviceContext, joinExistingRoom } from "./utils/context-helpers";

/**
 * Full-mesh encryption: EVERY ordered pair of members must be able to read
 * each other, not just the pairs involving the room creator.
 *
 * The pre-existing "3+ members" test in multi-device-encryption.spec.ts asserts
 * Alice→Bob, Alice→Carol, Bob→Alice and Carol→Alice. It never asserts Bob↔Carol
 * — the only pair that was broken. A room of five people has twenty ordered
 * pairs; the old test covered six of them and passed for nineteen milestones
 * while non-creator members could not read each other at all.
 *
 * Each browser context is an isolated device: its own IndexedDB, localStorage
 * and WebSocket connection. Dev mode bypasses WebAuthn with a random seed per
 * context, so each gets a distinct Curve25519 identity.
 */

/** Message text for a given sender, unique per run so it cannot collide. */
function probe(sender: string, run: string): string {
	return `mesh-${run}-from-${sender}`;
}

/** Read every rendered message body on a page. */
async function messagesOn(page: Page): Promise<string[]> {
	return page.locator(".message").allTextContents();
}

/** Assert no message on the page rendered as a decryption failure. */
async function expectNoDecryptFailures(page: Page, who: string) {
	const texts = await messagesOn(page);
	const failures = texts.filter((t) => /unable to decrypt/i.test(t));
	expect(
		failures,
		`${who} saw ${failures.length} undecryptable message(s). ` +
			`Every member must hold every other member's Megolm key.`,
	).toEqual([]);
}

// Serial: each case opens several browser contexts with live WebSocket
// connections. Running them in parallel overwhelms the local relay and turns
// genuine key-exchange failures into indistinguishable flake.
test.describe.serial("Full-mesh member encryption", () => {
	// Each case boots up to five browser contexts, completes a WebSocket join
	// and an Olm handshake for each, then waits for key exchange to settle.
	// That does not fit in Playwright's 30s default.
	test.describe.configure({ timeout: 180_000 });

	for (const memberCount of [2, 3, 4, 5]) {
		test(`${memberCount} members: every ordered pair can read the others`, async ({
			browser,
		}) => {
			const run = `${memberCount}m`;
			const names = ["Alice", "Bob", "Carol", "Dave", "Erin"].slice(0, memberCount);
			const contexts = [];
			const pages: Page[] = [];

			try {
				for (let i = 0; i < memberCount; i++) {
					const ctx = await newDeviceContext(browser);
					contexts.push(ctx);
					pages.push(await ctx.newPage());
				}

				// Alice creates; everyone else joins in turn. Joins are sequential
				// with a settle window so each key exchange completes before the
				// next member arrives.
				const roomUrl = await createAndJoinRoom(pages[0], names[0]);
				for (let i = 1; i < memberCount; i++) {
					await joinExistingRoom(pages[i], roomUrl, names[i]);
					await pages[0].waitForTimeout(3_000);
				}
				// Final settle: the last joiner's reciprocal key shares must land.
				await pages[0].waitForTimeout(3_000);

				// Every member sends one identifiable message.
				for (let i = 0; i < memberCount; i++) {
					await sendMessage(pages[i], probe(names[i], run));
				}

				// Every member must see every OTHER member's message. This is the
				// assertion the old test omitted for non-creator pairs.
				for (let receiver = 0; receiver < memberCount; receiver++) {
					for (let sender = 0; sender < memberCount; sender++) {
						if (sender === receiver) continue;
						await expect(
							pages[receiver].locator(".message", {
								hasText: probe(names[sender], run),
							}),
							`${names[receiver]} should be able to read ${names[sender]}`,
						).toBeVisible({ timeout: 20_000 });
					}
				}

				// And nobody may be showing a decrypt-failure placeholder.
				for (let i = 0; i < memberCount; i++) {
					await expectNoDecryptFailures(pages[i], names[i]);
				}
			} finally {
				for (const ctx of contexts) await ctx.close();
			}
		});
	}

	test("3 members: a task event from one non-creator reaches the other", async ({
		browser,
	}) => {
		// Task events ride the same Megolm channel as chat, so a broken pairwise
		// channel silently drops task state too — a worse failure than a missing
		// message, because the task list just looks different to different people.
		const contexts = [];
		const pages: Page[] = [];

		try {
			for (let i = 0; i < 3; i++) {
				const ctx = await newDeviceContext(browser);
				contexts.push(ctx);
				pages.push(await ctx.newPage());
			}
			const [alice, bob, carol] = pages;

			const roomUrl = await createAndJoinRoom(alice, "Alice");
			await joinExistingRoom(bob, roomUrl, "Bob");
			await alice.waitForTimeout(3_000);
			await joinExistingRoom(carol, roomUrl, "Carol");
			await alice.waitForTimeout(6_000);

			// Bob creates a task via the /task command in the composer.
			const bobInput = bob.locator(".composer input");
			await bobInput.fill("/task mesh-task-from-bob");
			await bobInput.press("Enter");

			// Carol — the other non-creator — must see it.
			await expect(
				carol.locator(".task-panel", { hasText: "mesh-task-from-bob" }),
				"Carol should receive Bob's task event",
			).toBeVisible({ timeout: 20_000 });

			await expectNoDecryptFailures(carol, "Carol");
		} finally {
			for (const ctx of contexts) await ctx.close();
		}
	});
});
