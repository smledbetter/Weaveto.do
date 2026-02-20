import { test, expect } from "./utils/fixtures";
import { trackErrors, assertNoWasmArtifacts } from "./utils/test-helpers";

test.describe("Homepage", () => {
  test("loads without JS errors", async ({ page }) => {
    const t = trackErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    t.assertNoErrors();
  });

  test("displays expected UI elements", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("weaveto.do");
    await expect(page.locator(".tagline")).toContainText(
      "Private, encrypted coordination",
    );
    await expect(page.locator("button", { hasText: "New Room" })).toBeVisible();
    await expect(page.locator("footer")).toContainText("End-to-end encrypted");
  });

  test("has no WASM artifacts", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await assertNoWasmArtifacts(page);
  });

  test("New Room button is enabled", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("button", { hasText: "New Room" });
    await expect(btn).toBeEnabled();
  });
});
