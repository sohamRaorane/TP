import { defineConfig } from '@playwright/test';

// Run against a running app: `npm run dev:all` then `npm run e2e`
// (or E2E_BASE_URL=http://host:port npm run e2e).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1400, height: 900 },
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
