import { test, expect } from "./utils/fixtures";

/**
 * A link to a room nobody is in must say so.
 *
 * The relay used to refuse a join for a room it did not know, which told a
 * person with a stale link that the room had expired. Making the relay
 * stateless removed that refusal: it now reconstitutes any room on demand, so
 * a dead link silently produces a working, empty, brand-new room instead.
 *
 * The relay reports `roomExisted` so the client can tell the difference. This
 * pins that the client actually acts on it — the first version of the change
 * recorded the flag and never read it, and every other test still passed.
 *
 * It is deliberately a notice and not an error. Someone joining in the seconds
 * after a relay restart sees exactly the same `roomExisted: false`, and telling
 * them the room is gone is the bug the stateless relay exists to fix.
 */

/** A room ID that is well-formed but has never been created. */
function unusedRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NOTICE = /invite link may have expired/i;

test.describe("A link to a room that is not there", () => {
  test("tells a joiner nobody else is here", async ({ page }) => {
    await page.goto(`/room/${unusedRoomId()}`);
    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Bob");
    await page.locator("button", { hasText: "Join Securely" }).click();

    await expect(
      page.locator(".warning-banner.stale-link"),
      "a joiner who found an empty room should be told the link may be stale",
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".warning-banner.stale-link")).toContainText(
      NOTICE,
    );
  });

  test("does not block the person from staying in the room", async ({
    page,
  }) => {
    // A relay restart looks identical from here. The room has to stay usable.
    await page.goto(`/room/${unusedRoomId()}`);
    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Bob");
    await page.locator("button", { hasText: "Join Securely" }).click();

    const banner = page.locator(".warning-banner.stale-link");
    await expect(banner).toBeVisible({ timeout: 30_000 });

    await expect(page.locator("header .room-info h2")).not.toBeEmpty();
    await banner.locator("button", { hasText: "Dismiss" }).click();
    await expect(banner).not.toBeVisible();
  });

  test("says nothing to the person who created the room", async ({ page }) => {
    // The creator is supposed to arrive first. Warning them is noise.
    await page.goto(`/room/${unusedRoomId()}?create=true`);
    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Alice");
    await page.locator("button", { hasText: "Join Securely" }).click();

    await expect(page.locator("header .room-info h2")).not.toBeEmpty({
      timeout: 30_000,
    });
    await expect(page.locator(".warning-banner.stale-link")).toHaveCount(0);
  });
});
