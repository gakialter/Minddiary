import { defineConfig } from '@playwright/test';
import { UPDATER_PLAYWRIGHT_OUTPUT_DIRECTORY } from './tests/helpers/updaterRuntimeWorkspace';

export default defineConfig({
  testDir: './tests/updater-e2e',
  outputDir: UPDATER_PLAYWRIGHT_OUTPUT_DIRECTORY,
  timeout: 1_500_000,
  globalTimeout: 1_800_000,
  expect: {
    timeout: 30_000,
  },
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'off',
  },
});
