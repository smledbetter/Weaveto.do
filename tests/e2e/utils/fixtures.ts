import { test as base } from '@playwright/test';

/**
 * Extended test fixture that auto-dismisses coach marks overlay.
 * Import { test } from './utils/fixtures' instead of '@playwright/test'.
 */
export const test = base.extend({
	page: async ({ page }, use) => {
		await page.addInitScript(() => {
			sessionStorage.setItem('weave-walkthrough-seen', 'true');
		});
		await use(page);
	},
});

export { expect } from '@playwright/test';
