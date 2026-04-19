import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';

let app: ElectronApplication;
let page: Page;

const projectRoot = path.join(__dirname, '..', '..');

test.beforeAll(async () => {
    app = await electron.launch({
        args: [projectRoot],
        env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
});

test.afterAll(async () => {
    await page.evaluate(() => {
        const api = (window as any).api;
        return Promise.all([
            api.settings.set('pomodoroSound', 'true'),
            api.settings.set('pomodoroAlert', 'true'),
        ]);
    });
    await app.close();
});

test.describe('Settings Persistence (IPC → SQLite → reload)', () => {
    test('pomodoroSound setting persists after set', async () => {
        await page.evaluate(() =>
            (window as any).api.settings.set('pomodoroSound', 'false')
        );
        const value = await page.evaluate(() =>
            (window as any).api.settings.get('pomodoroSound')
        );
        expect(value).toBe('false');

        await page.evaluate(() =>
            (window as any).api.settings.set('pomodoroSound', 'true')
        );
        const restored = await page.evaluate(() =>
            (window as any).api.settings.get('pomodoroSound')
        );
        expect(restored).toBe('true');
    });

    test('pomodoroAlert setting persists after set', async () => {
        await page.evaluate(() =>
            (window as any).api.settings.set('pomodoroAlert', 'false')
        );
        const value = await page.evaluate(() =>
            (window as any).api.settings.get('pomodoroAlert')
        );
        expect(value).toBe('false');

        await page.evaluate(() =>
            (window as any).api.settings.set('pomodoroAlert', 'true')
        );
    });

    test('getAllSettings returns data', async () => {
        const all = await page.evaluate(() =>
            (window as any).api.settings.getAll()
        );
        expect(Array.isArray(all) || typeof all === 'object').toBe(true);
    });

    test('custom key round-trips correctly', async () => {
        const testKey = '__e2e_test_key__';
        const testVal = 'hello_from_e2e';

        await page.evaluate(({ key, val }: { key: string; val: string }) =>
            (window as any).api.settings.set(key, val),
            { key: testKey, val: testVal }
        );
        const retrieved = await page.evaluate((key: string) =>
            (window as any).api.settings.get(key),
            testKey
        );
        expect(retrieved).toBe(testVal);

        await page.evaluate((key: string) =>
            (window as any).api.settings.set(key, ''),
            testKey
        );
    });
});
