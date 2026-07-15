import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/setup-smoke',
  timeout: 240_000,
  expect: {
    timeout: 15_000,
  },
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
})
