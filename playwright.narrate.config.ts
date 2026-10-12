import { defineConfig, devices } from '@playwright/test';

/**
 * Narrated screen-reader videos. Kept apart from the audit config so a narration run writes only
 * to reports/narration and never rewrites the accessibility report.
 */
export default defineConfig({
  testDir: './narration',
  outputDir: './reports/narration/.playwright',

  fullyParallel: false,
  workers: 1,
  retries: 0,

  // Every tab stop is held on screen while it is read out, so a long page runs for many minutes.
  timeout: 30 * 60_000,

  reporter: [['list']],

  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    headless: !process.env.HEADED,
    channel: process.env.A11Y_CHANNEL || undefined,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
});
