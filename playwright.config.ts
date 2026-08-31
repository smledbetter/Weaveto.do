import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: {
          permissions: ['clipboard-read', 'clipboard-write'],
        },
      },
      testIgnore: /mobile-layout|mobile-layout-extended|identity-integration|member-mesh|relay-restart/,
    },
    {
      // Takes the relay port over to kill and restart it, so it cannot share
      // a relay with anything else. Own project, one worker.
      name: 'relay-restart',
      testMatch: /relay-restart/,
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Full-mesh encryption runs several browser contexts at once and needs
      // the local relay to itself. Sharing workers with the rest of the suite
      // starves the join handshake and produces setup flake that looks like a
      // crypto failure. Its own project, one worker.
      name: 'mesh',
      testMatch: /member-mesh/,
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone SE'] },
      testMatch: /mobile-layout|mobile-layout-extended/,
    },
    {
      name: 'mobile-pixel',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile-layout|mobile-layout-extended/,
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      command: 'npm run relay',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
  ],
});
