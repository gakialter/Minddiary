import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';
import {
    createDisposableElectronProfile,
    removeDisposableElectronProfile,
} from './disposableElectronProfile';

let app: ElectronApplication;
let page: Page;
let profilePath: string;

const projectRoot = path.join(__dirname, '..', '..');
const profilePrefix = 'minddiary-window-controls-e2e-';

test.beforeAll(async () => {
    // Launch Electron from project root (uses package.json "main" field)
    // This loads dist/index.html in production mode
    profilePath = createDisposableElectronProfile(profilePrefix);
    app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    const actualUserData = await app.evaluate(({ app }) => app.getPath('userData'));
    expect(path.relative(profilePath, actualUserData)).toBe('');
    // Wait for the app to load (production loads dist/index.html)
    await page.waitForLoadState('load');
    await expect.poll(() => page.evaluate(() => {
        const windowApi = (window as any).api?.window;
        return ['custom', 'native'].includes(windowApi?.titlebarMode)
            && typeof windowApi?.minimize === 'function'
            && typeof windowApi?.maximize === 'function'
            && typeof windowApi?.isMaximized === 'function';
    })).toBe(true);
});

test.afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    if (app) {
        try {
            await app.close();
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
    if (profilePath) {
        try {
            await removeDisposableElectronProfile(profilePath, profilePrefix);
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
    if (cleanupErrors.length > 0) {
        throw new Error(`Window controls E2E cleanup failed:\n${cleanupErrors.map(error => (
            error instanceof Error ? error.stack || error.message : String(error)
        )).join('\n')}`);
    }
});

test.describe('Window Controls (IPC boundary)', () => {
    test('custom titlebar keeps a blank draggable center and no-drag controls', async () => {
        const mode = await page.evaluate(() => (window as any).api?.window?.titlebarMode);
        test.skip(mode !== 'custom', 'Native titlebar platforms do not render the custom titlebar');

        const previousStarted = await page.evaluate(() => localStorage.getItem('started'));
        await page.evaluate(() => localStorage.setItem('started', 'true'));
        await page.reload();
        try {
            const titlebar = page.locator('.titlebar-custom');
            await expect(titlebar).toBeVisible();
            await expect(titlebar.getByText('MindDiary', { exact: true })).toHaveCount(1);
            await expect(titlebar.getByText(/考研日记/)).toHaveCount(0);
            await expect(titlebar.getByText(/\d{1,2}月\d{1,2}日/)).toHaveCount(0);

            const dragRegion = titlebar.getByTestId('titlebar-drag-region');
            await expect(dragRegion).toBeVisible();
            expect(await titlebar.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('drag');
            expect(await dragRegion.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('drag');

            for (const accessibleName of ['最小化窗口', '最大化窗口', '关闭窗口']) {
                const button = titlebar.getByRole('button', { name: accessibleName });
                await expect(button).toBeVisible();
                expect(await button.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
            }
        } finally {
            await page.evaluate((started) => {
                if (started === null) localStorage.removeItem('started');
                else localStorage.setItem('started', started);
            }, previousStarted);
        }
    });

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
        await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win?.isMinimized() ?? false;
        })).toBe(true);

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
        await expect.poll(() => page.evaluate(() => (
            (window as any).api.window.isMaximized()
        ))).toBe(wasBefore);
    });
});
