import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/packaged',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
})
