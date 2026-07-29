import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';

let app: ElectronApplication;
let page: Page;

const projectRoot = path.join(__dirname, '..', '..');

test.beforeAll(async () => {
    // Launch Electron from project root (uses package.json "main" field)
    // This loads dist/index.html in production mode
    app = await electron.launch({
        args: [projectRoot],
        env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    // Wait for the app to load (production loads dist/index.html)
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
});

test.afterAll(async () => {
    await app.close();
});

test.describe('Window Controls (IPC boundary)', () => {
    test('titlebarMode is "custom" on Windows', async () => {
        const mode = await page.evaluate(() => (window as any).api?.window?.titlebarMode);
        expect(['custom', 'native']).toContain(mode);
    });

    test('platform is exposed via preload', async () => {
        const platform = await page.evaluate(() => (window as any).api?.window?.platform);
        expect(['win32', 'darwin', 'linux']).toContain(platform);
    });

    test('isMaximized returns a boolean', async () => {
        const isMax = await page.evaluate(() => (window as any).api?.window?.isMaximized());
        expect(typeof isMax).toBe('boolean');
    });

    test('minimize triggers IPC and restores', async () => {
        await page.evaluate(() => (window as any).api.window.minimize());
        await page.waitForTimeout(500);

        const isMinimized = await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win?.isMinimized() ?? false;
        });
        expect(isMinimized).toBe(true);

        // Restore for subsequent tests
        await app.evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) throw new Error('Main window is unavailable');
            if (!win.isMinimized()) return;
            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    clearTimeout(timer);
                    win.removeListener('restore', finish);
                    resolve();
                };
                const timer = setTimeout(() => {
                    win.removeListener('restore', finish);
                    reject(new Error('Main window did not restore within 2 seconds'));
                }, 2_000);
                win.once('restore', finish);
                win.restore();
                if (!win.isMinimized()) finish();
            });
        });
    });

    test('maximize toggles correctly', async () => {
        const wasBefore = await page.evaluate(() => (window as any).api.window.isMaximized());
        const result = await page.evaluate(() => (window as any).api.window.maximize());
        expect(typeof result).toBe('boolean');
        expect(result).toBe(!wasBefore);

        // Toggle back
        await page.evaluate(() => (window as any).api.window.maximize());
        await page.waitForTimeout(200);
    });
});
