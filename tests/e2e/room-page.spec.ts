import { test, expect } from "./utils/fixtures";
import { trackErrors, assertNoWasmArtifacts } from "./utils/test-helpers";

test.describe("Room Page", () => {
  // Valid 32-hex room ID for smoke tests (room won't exist on relay, that's fine for UI tests)
  const testRoomId = "a".repeat(32);

  test("loads without JS errors", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto(`/room/${testRoomId}`);
    await page.waitForLoadState("networkidle");
    t.assertNoErrors();
  });

  test("shows name input phase initially", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    await expect(page.locator("h2", { hasText: "Join" })).toBeVisible();
    await expect(
      page.locator('input[placeholder="What should we call you?"]'),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "Join Securely" }),
    ).toBeVisible();
  });

  test("Join button disabled until name entered", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    const joinBtn = page.locator("button", { hasText: "Join Securely" });
    await expect(joinBtn).toBeDisabled();

    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Tester");
    await expect(joinBtn).toBeEnabled();
  });

  // M12 folded the standalone key-warning banner into the CoachMarks
  // walkthrough. The two tests that lived here asserted `.warning-banner` on a
  // page that had not joined a room, so the element was never rendered at all —
  // it sits inside `{:else if phase === 'connected'}`. They were replaced with
  // a test of where the message actually reaches a first-time user.
  test("first-time user is told their keys live only in this tab", async ({
    page,
  }) => {
    // utils/fixtures pre-sets weave-walkthrough-seen for every test in this
    // file, which is what suppresses the walkthrough everywhere else. Undo it
    // for this test only — init scripts run in registration order, so this one
    // lands after the fixture's.
    await page.addInitScript(() => {
      localStorage.removeItem("weave-walkthrough-seen");
    });

    await page.goto(`/room/${testRoomId}?create=true`, {
      waitUntil: "networkidle",
    });
    await page
      .locator('input[placeholder="What should we call you?"]')
      .fill("Tester");
    await page.locator("button", { hasText: "Join Securely" }).click();

    const walkthrough = page.locator(".coach-overlay");
    await expect(walkthrough).toBeVisible({ timeout: 15_000 });
    await expect(walkthrough).toContainText("keys live in this tab");

    // Dismissing it persists, so the message is shown once and not nagged.
    // "Next" only advances a step; Skip and the final "Got it" are what call
    // finish() and write the flag.
    await walkthrough.locator("button.skip-btn").click();
    await expect(walkthrough).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("weave-walkthrough-seen")))
      .toBe("true");
  });

  test("has no WASM artifacts", async ({ page }) => {
    await page.goto(`/room/${testRoomId}`);
    await page.waitForLoadState("networkidle");
    await assertNoWasmArtifacts(page);
  });
});
