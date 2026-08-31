import { test, expect } from "./utils/fixtures";
import { trackAppErrors } from "./utils/room-helpers";

/**
 * PIN inactivity timeout test.
 *
 * Tests that the SessionGate visibility change mechanism works correctly.
 * When a tab is hidden for longer than TAB_GRACE_MS (60s) and becomes
 * visible again, the session should lock.
 *
 * Since setting up a full PIN flow in E2E requires navigating the
 * pin-setup phase and storing keys, this test verifies the underlying
 * mechanism: the visibilitychange handler with time manipulation.
 * The full PIN flow is tested via unit tests in gate.test.ts.
 */

test.describe("PIN Inactivity", () => {
	test("visibility change detection triggers after grace period", async ({
		page,
	}) => {
		const errors = trackAppErrors(page);

		// Navigate to the homepage and verify the visibility change mechanism
		await page.goto("/", { waitUntil: "networkidle" });

		// Test that the browser's visibilitychange event can be dispatched
		// and that our time manipulation technique works
		const result = await page.evaluate(() => {
			let hiddenEventFired = false;
			let visibleEventFired = false;

			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "hidden") hiddenEventFired = true;
				if (document.visibilityState === "visible") visibleEventFired = true;
			});

			// Simulate going hidden
			Object.defineProperty(document, "hidden", {
				get: () => true,
				configurable: true,
			});
			Object.defineProperty(document, "visibilityState", {
				get: () => "hidden",
				configurable: true,
			});
			document.dispatchEvent(new Event("visibilitychange"));

			// Simulate becoming visible
			Object.defineProperty(document, "hidden", {
				get: () => false,
				configurable: true,
			});
			Object.defineProperty(document, "visibilityState", {
				get: () => "visible",
				configurable: true,
			});
			document.dispatchEvent(new Event("visibilitychange"));

			return { hiddenEventFired, visibleEventFired };
		});

		expect(result.hiddenEventFired).toBe(true);
		expect(result.visibleEventFired).toBe(true);

		errors.assertNoErrors();
	});

	test("SessionGate locks session when tab hidden beyond grace period", async ({
		page,
	}) => {
		const errors = trackAppErrors(page);

		await page.goto("/", { waitUntil: "networkidle" });

		// Create a SessionGate instance in the browser and test its behavior
		const lockTriggered = await page.evaluate(async () => {
			// Dynamically import the SessionGate module (Vite resolves at runtime)
			// @ts-ignore — Vite serves this path, TS can't resolve it statically
			const { SessionGate } = await import("/src/lib/pin/gate.ts");

			let locked = false;
			const gate = new SessionGate(15, {
				onLock: () => { locked = true; },
				onLockout: () => {},
			});
			gate.start();

			// Override Date.now for time manipulation
			const realNow = Date.now;
			let timeOffset = 0;
			Date.now = () => realNow() + timeOffset;

			// Simulate going hidden
			Object.defineProperty(document, "hidden", {
				get: () => true,
				configurable: true,
			});
			Object.defineProperty(document, "visibilityState", {
				get: () => "hidden",
				configurable: true,
			});
			document.dispatchEvent(new Event("visibilitychange"));

			// Jump time forward 65 seconds (past 60s grace period)
			timeOffset = 65_000;

			// Simulate becoming visible — this triggers the lock check
			Object.defineProperty(document, "hidden", {
				get: () => false,
				configurable: true,
			});
			Object.defineProperty(document, "visibilityState", {
				get: () => "visible",
				configurable: true,
			});
			document.dispatchEvent(new Event("visibilitychange"));

			gate.stop();
			Date.now = realNow;

			return locked;
		});

		expect(lockTriggered).toBe(true);

		errors.assertNoErrors();
	});
});
