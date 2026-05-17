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
        return (window as any).api.settings.updateGeneral({
            pomodoroSound: true,
            pomodoroAlert: true,
        });
    });
    await app.close();
});

test.describe('Settings Persistence (IPC to SQLite to readback)', () => {
    test('pomodoroSound setting persists after updateGeneral', async () => {
        await page.evaluate(() =>
            (window as any).api.settings.updateGeneral({ pomodoroSound: false })
        );
        const value = await page.evaluate(() =>
            (window as any).api.settings.getAll().then((settings: any) => settings.pomodoroSound)
        );
        expect(value).toBe('false');

        await page.evaluate(() =>
            (window as any).api.settings.updateGeneral({ pomodoroSound: true })
        );
        const restored = await page.evaluate(() =>
            (window as any).api.settings.getAll().then((settings: any) => settings.pomodoroSound)
        );
        expect(restored).toBe('true');
    });

    test('pomodoroAlert setting persists after updateGeneral', async () => {
        await page.evaluate(() =>
            (window as any).api.settings.updateGeneral({ pomodoroAlert: false })
        );
        const value = await page.evaluate(() =>
            (window as any).api.settings.getAll().then((settings: any) => settings.pomodoroAlert)
        );
        expect(value).toBe('false');

        await page.evaluate(() =>
            (window as any).api.settings.updateGeneral({ pomodoroAlert: true })
        );
    });

    test('getAllSettings returns data', async () => {
        const all = await page.evaluate(() =>
            (window as any).api.settings.getAll()
        );
        expect(Array.isArray(all) || typeof all === 'object').toBe(true);
    });

    test('preload exposes only the patch-based settings API', async () => {
        const settingKeys = await page.evaluate(() =>
            Object.keys((window as any).api.settings)
        );

        expect(settingKeys).toEqual(expect.arrayContaining([
            'getAll',
            'updateGeneral',
            'updateAI',
            'updateBackup',
            'selectBackupFolder',
        ]));
        expect(settingKeys).not.toContain('set');
        expect(settingKeys).not.toContain('get');
    });
});
