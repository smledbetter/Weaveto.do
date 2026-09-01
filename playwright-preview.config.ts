import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for production-mode integration tests.
 *
 * Runs against `npm run preview` (port 4173) where import.meta.env.DEV
 * is false, enabling tests of production-only code paths like the
 * WebAuthn PRF → IndexedDB identity fallback.
 *
 * Usage: npx playwright test --config playwright-preview.config.ts
 */
export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: /identity-integration/,

	// This config reuses the relay on 3001 the same way, so it can measure a
	// relay that is no longer on disk the same way. See
	// tests/e2e/utils/relay-build.ts.
	globalSetup: "./tests/e2e/global-setup.ts",
	fullyParallel: false, // Serial — room state matters
	retries: 0,
	workers: 1,
	reporter: "html",

	use: {
		baseURL: "http://localhost:4173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},

	projects: [
		{
			name: "chromium-preview",
			use: {
				...devices["Desktop Chrome"],
				contextOptions: {
					permissions: ["clipboard-read", "clipboard-write"],
				},
			},
		},
	],

	webServer: [
		{
			command: "npm run build && npm run preview -- --port 4173",
			url: "http://localhost:4173",
			reuseExistingServer: !process.env.CI,
			stdout: "pipe",
			stderr: "pipe",
			timeout: 120_000,
		},
		{
			command: "npm run relay",
			url: "http://localhost:3001",
			reuseExistingServer: !process.env.CI,
			stdout: "pipe",
			stderr: "pipe",
			timeout: 30_000,
		},
	],
});
