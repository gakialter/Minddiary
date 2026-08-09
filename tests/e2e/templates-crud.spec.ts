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
const profilePrefix = 'minddiary-templates-crud-e2e-';

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
        const templates = (window as any).api?.templates;
        if (typeof templates?.getAll !== 'function') return false;
        const values = await templates.getAll();
        return Array.isArray(values) && values.length >= 3;
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
        throw new Error(`Template CRUD E2E cleanup failed:\n${cleanupErrors.map(error => (
            error instanceof Error ? error.stack || error.message : String(error)
        )).join('\n')}`);
    }
});

test.describe('Template CRUD (IPC round-trip)', () => {
    let createdId: number;

    test('getAll returns default templates', async () => {
        const templates = await page.evaluate(() => (window as any).api.templates.getAll());
        expect(Array.isArray(templates)).toBe(true);
        expect(templates.length).toBeGreaterThanOrEqual(3);
        for (const t of templates) {
            expect(t).toHaveProperty('id');
            expect(t).toHaveProperty('name');
            expect(t).toHaveProperty('content');
        }
    });

    test('create adds a new template', async () => {
        const newTemplate = await page.evaluate(() =>
            (window as any).api.templates.create({
                name: 'E2E Test Template',
                content: '# E2E Test\n\nThis is an automated test template.',
            })
        );
        expect(newTemplate).toHaveProperty('id');
        expect(newTemplate.name).toBe('E2E Test Template');
        createdId = newTemplate.id;

        const all = await page.evaluate(() => (window as any).api.templates.getAll());
        const found = all.find((t: any) => t.id === createdId);
        expect(found).toBeTruthy();
    });

    test('update modifies the template', async () => {
        const updated = await page.evaluate((id: number) =>
            (window as any).api.templates.update(id, {
                name: 'E2E Updated Template',
                content: '# Updated',
            }),
            createdId
        );
        expect(updated.name).toBe('E2E Updated Template');
    });

    test('delete removes the template', async () => {
        await page.evaluate((id: number) =>
            (window as any).api.templates.delete(id),
            createdId
        );
        const all = await page.evaluate(() => (window as any).api.templates.getAll());
        const found = all.find((t: any) => t.id === createdId);
        expect(found).toBeUndefined();
    });
});
