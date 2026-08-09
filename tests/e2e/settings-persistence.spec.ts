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
const profilePrefix = 'minddiary-settings-persistence-e2e-';

test.beforeAll(async () => {
    profilePath = createDisposableElectronProfile(profilePrefix);
    app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    const actualUserData = await app.evaluate(({ app }) => app.getPath('userData'));
    expect(path.relative(profilePath, actualUserData)).toBe('');
    await page.waitForLoadState('load');
    await expect.poll(() => page.evaluate(async () => {
        const settings = (window as any).api?.settings;
        if (typeof settings?.getAll !== 'function') return false;
        const values = await settings.getAll();
        return values !== null && typeof values === 'object';
    })).toBe(true);
});

test.afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    if (page) {
        try {
            await page.evaluate(() => {
                return (window as any).api.settings.updateGeneral({
                    pomodoroSound: true,
                    pomodoroAlert: true,
                });
            });
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
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
        throw new Error(`Settings persistence E2E cleanup failed:\n${cleanupErrors.map(error => (
            error instanceof Error ? error.stack || error.message : String(error)
        )).join('\n')}`);
    }
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
            'selectBackupFile',
            'restoreBackupFromZip',
        ]));
        expect(settingKeys).not.toContain('set');
        expect(settingKeys).not.toContain('get');
    });
});
