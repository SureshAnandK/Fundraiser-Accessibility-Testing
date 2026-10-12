import { defineConfig, devices } from '@playwright/test';

/** Checks that set their own viewport or use a local fixture page; one run is enough. */
const DESKTOP_ONLY = [/00-selfcheck\.spec\.ts/, /05-responsive\.spec\.ts/];

export default defineConfig({
  testDir: './tests',
  outputDir: './reports/test-results',

  // One worker: evidence files are shared between tests, and a live site (A11Y_URLS) should not be hammered.
  fullyParallel: false,
  workers: 1,

  // Accessibility failures are deterministic, so retrying a red test only doubles the traffic.
  retries: Number(process.env.A11Y_RETRIES ?? 0),

  timeout: 240_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['./src/reporting/a11yReporter.ts'],
  ],

  use: {
    headless: !process.env.HEADED,
    // A11Y_CHANNEL=chrome runs the installed Chrome instead of bundled Chromium.
    channel: process.env.A11Y_CHANNEL || undefined,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: process.env.A11Y_TRACE ? 'retain-on-failure' : 'off',
    screenshot: 'off',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testIgnore: DESKTOP_ONLY,
    },
  ],
});
