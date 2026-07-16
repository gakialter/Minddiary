import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/updater-e2e',
  timeout: 3_600_000,
  globalTimeout: 4_200_000,
  expect: {
    timeout: 30_000,
  },
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
