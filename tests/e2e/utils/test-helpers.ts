import { expect, type Page } from '@playwright/test';

/**
 * Collect console errors and page errors during a test.
 * Call at start of test, then call assertNoErrors() after interactions.
 */
export function trackErrors(page: Page) {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  return {
    get errors() { return errors; },
    assertNoErrors() {
      expect(errors, `Page had JS errors:\n${errors.join('\n')}`).toHaveLength(0);
    },
  };
}

/** Assert no <p>Hello from Rust!</p> WASM artifact in the DOM. */
export async function assertNoWasmArtifacts(page: Page) {
  const count = await page.locator('p').filter({ hasText: 'Hello from Rust!' }).count();
  expect(count, '"Hello from Rust!" WASM artifact should be removed').toBe(0);
}

/** Extract 32-hex room ID from a URL string. */
export function extractRoomId(url: string): string | null {
  const match = url.match(/\/room\/([a-f0-9]{32})/);
  return match ? match[1] : null;
}
