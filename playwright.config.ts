import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    retries: 0,
    workers: 1, // Serialize: each spec launches its own Electron instance
    reporter: 'list',
    use: {
        trace: 'on-first-retry',
    },
});
