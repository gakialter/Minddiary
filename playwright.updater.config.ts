import { defineConfig } from '@playwright/test';
import { UPDATER_PLAYWRIGHT_OUTPUT_DIRECTORY } from './tests/helpers/updaterRuntimeWorkspace';

export default defineConfig({
  testDir: './tests/updater-e2e',
  outputDir: UPDATER_PLAYWRIGHT_OUTPUT_DIRECTORY,
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
