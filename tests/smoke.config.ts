import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'tests/smoke-test.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 60000,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // No local webServer needed — testing against live deployment
});
