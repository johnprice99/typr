import { defineConfig } from '@playwright/test'

// End-to-end tests launch the real (built) app, one at a time.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  // Hard limits, so a broken build can never keep launching the app.
  globalTimeout: 5 * 60_000,
  maxFailures: 10,
  expect: { timeout: 4_000 },
  reporter: [['list']],
  retries: 0
})
