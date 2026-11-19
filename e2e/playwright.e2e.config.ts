// Optional e2e config (use with `npx playwright test -c e2e/playwright.e2e.config.ts`).
// Same as the root config plus failure artifacts; see the E2E report for proposed root changes.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1400, height: 900 },
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
