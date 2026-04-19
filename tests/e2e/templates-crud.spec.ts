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
    await app.close();
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
