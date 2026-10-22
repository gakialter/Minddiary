import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createDisposableElectronProfile,
    removeDisposableElectronProfile,
} from './disposableElectronProfile';

const projectRoot = path.resolve(__dirname, '..', '..');
const profilePrefix = 'minddiary-export-modal-e2e-';
const saveDialogStateKey = '__minddiaryExportModalSaveDialogE2E';

interface OwnedElectron {
    application: ElectronApplication;
    process: ChildProcess;
}

interface SaveDialogState {
    originalDialog: unknown;
    requests: Array<{ title?: string; defaultPath?: string; filters?: unknown }>;
}

function hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

async function closeOwnedApplication(owned: OwnedElectron): Promise<void> {
    await owned.application.close();
    await expect.poll(() => hasExited(owned.process), { timeout: 10_000 }).toBe(true);
}

async function cleanup(ownedApps: OwnedElectron[], profilePath: string, bodyFailed: boolean): Promise<void> {
    const errors: unknown[] = [];
    for (const owned of ownedApps) {
        if (hasExited(owned.process)) continue;
        try {
            await closeOwnedApplication(owned);
        } catch (error) {
            errors.push(error);
        }
    }
    try {
        if (ownedApps.some(owned => !hasExited(owned.process))) {
            throw new Error('Refusing to remove a disposable profile while its owned Electron process is running');
        }
        await removeDisposableElectronProfile(profilePath, profilePrefix);
    } catch (error) {
        errors.push(error);
    }
    if (errors.length) {
        console.error('Export modal E2E cleanup failed', errors);
        if (!bodyFailed) throw errors[0];
    }
}

async function launchProduction(profilePath: string, ownedApps: OwnedElectron[]): Promise<{
    owned: OwnedElectron;
    page: Page;
}> {
    const application = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profilePath}`],
        env: { ...process.env, NODE_ENV: 'production' },
    });
    const owned = { application, process: application.process() };
    ownedApps.push(owned);
    const page = await application.firstWindow();
    await page.waitForLoadState('load');
    await expect(page).toHaveURL(pathToFileURL(path.join(projectRoot, 'dist', 'index.html')).href);
    const runtime = await application.evaluate(({ app }) => ({
        userData: app.getPath('userData'),
        nodeEnv: process.env.NODE_ENV,
    }));
    expect(path.relative(profilePath, runtime.userData)).toBe('');
    expect(runtime.nodeEnv).toBe('production');
    const start = page.getByRole('button', { name: '开始使用', exact: true });
    const navigation = page.getByRole('navigation', { name: '主要导航' });
    await expect(start.or(navigation)).toBeVisible();
    if (await start.isVisible().catch(() => false)) await start.click();
    await expect(navigation).toBeVisible();
    return { owned, page };
}

async function openDiary(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: '主要导航' })
        .getByRole('button', { name: '写日记', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '日记正文', exact: true })).toBeVisible();
}

async function readDiary(page: Page, date: string) {
    return page.evaluate(targetDate => window.api.entries.getByDate(targetDate), date);
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
    await testInfo.attach(name, {
        body: JSON.stringify(value, null, 2),
        contentType: 'application/json',
    });
}

test('contains export keyboard focus, protects the diary, and supports cancel, retry, and backup exports', async ({}, testInfo) => {
    test.setTimeout(90_000);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const allowedTargets = {
        pdf: path.join(profilePath, 'synthetic-diary.pdf'),
        json: path.join(profilePath, 'synthetic-diary.json'),
        markdown: path.join(profilePath, 'synthetic-diary.md'),
    } as const;
    const ownedApps: OwnedElectron[] = [];
    let bodyFailed = true;
    let saveDialogMockInstalled = false;

    try {
        const { owned, page } = await launchProduction(profilePath, ownedApps);
        const application = owned.application;
        await openDiary(page);

        const date = (await page.locator('.sidebar-today-date').innerText()).trim();
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const titleFixture = `B2-export-title-${randomUUID()}`;
        const bodyFixture = `B2-export-body-${randomUUID()}`;
        const titleInput = page.getByRole('textbox', { name: '日记标题', exact: true });
        const editor = page.getByRole('textbox', { name: '日记正文', exact: true });
        await titleInput.fill(titleFixture);
        await editor.click();
        await editor.press('ControlOrMeta+A');
        await page.keyboard.insertText(bodyFixture);
        await expect.poll(async () => (await readDiary(page, date))?.content).toBe(bodyFixture);
        await expect.poll(async () => (await readDiary(page, date))?.title).toBe(titleFixture);

        await application.evaluate(({ dialog }, { stateKey, targets }) => {
            const originalDialog = dialog.showSaveDialog;
            const requests: SaveDialogState['requests'] = [];
            const outcomes: Array<string | null> = [null, targets.pdf, targets.json, targets.markdown];
            let index = 0;
            Reflect.set(process, stateKey, { originalDialog, requests } satisfies SaveDialogState);
            Reflect.set(dialog, 'showSaveDialog', async (_window: unknown, options: SaveDialogState['requests'][number]) => {
                requests.push({
                    title: options?.title,
                    defaultPath: options?.defaultPath,
                    filters: options?.filters,
                });
                const selected = outcomes[index++];
                if (selected === undefined) throw new Error('Unexpected extra export save dialog');
                return selected === null
                    ? { canceled: true }
                    : { canceled: false, filePath: selected };
            });
        }, { stateKey: saveDialogStateKey, targets: allowedTargets });
        saveDialogMockInstalled = true;

        const exportTrigger = page.getByRole('button', { name: '导出数据', exact: true });
        await exportTrigger.focus();
        await exportTrigger.click();
        const modal = page.getByRole('dialog', { name: '导出数据' });
        await expect(modal).toBeVisible();
        const closeButton = modal.getByRole('button', { name: '关闭导出', exact: true });
        await expect(closeButton).toBeFocused();
        await closeButton.click();
        await expect(modal).toBeHidden();
        await expect(exportTrigger).toBeFocused();

        await exportTrigger.click();
        await expect(modal).toBeVisible();
        await expect(closeButton).toBeFocused();

        const modalContainsFocus = () => modal.evaluate(root => root.contains(document.activeElement));
        const firstControl = closeButton;
        await page.keyboard.press('Shift+Tab');
        await expect.poll(modalContainsFocus).toBe(true);
        const lastControl = await modal.evaluate(root => {
            const controls = Array.from(root.querySelectorAll<HTMLElement>(
                'button, a[href], input:not([type="file"]), select, textarea, [tabindex]:not([tabindex="-1"])',
            )).filter(control => control.offsetParent !== null && !(control as HTMLButtonElement).disabled);
            const last = controls[controls.length - 1];
            return last?.getAttribute('aria-label') || last?.textContent?.trim() || '';
        });
        expect(lastControl).toMatch(/导入 JSON/);
        await expect(firstControl).not.toBeFocused();
        await page.keyboard.press('Tab');
        await expect(firstControl).toBeFocused();

        for (let index = 0; index < 8; index += 1) {
            await page.keyboard.press('Tab');
            await page.keyboard.type(`hidden-edit-${index}`);
            await expect.poll(modalContainsFocus).toBe(true);
        }
        await expect(modal.getByRole('radio', { name: /PDF 报告/ })).toBeChecked();
        await expect(titleInput).toHaveValue(titleFixture);
        await expect(editor).toHaveText(bodyFixture);

        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(exportTrigger).toBeFocused();
        await expect(titleInput).toHaveValue(titleFixture);
        await expect(editor).toHaveText(bodyFixture);

        await exportTrigger.click();
        await expect(modal).toBeVisible();
        await modal.getByRole('button', { name: '导出文件', exact: true }).click();
        const exportButton = modal.getByRole('button', { name: '导出文件', exact: true });
        await expect(exportButton).toBeEnabled({ timeout: 15_000 });
        await expect(modal).toBeVisible();
        await expect.poll(() => modal.evaluate(root => root.contains(document.activeElement))).toBe(true);

        await exportButton.click();
        await expect(modal.getByText(new RegExp(`已导出到：${allowedTargets.pdf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => existsSync(allowedTargets.pdf)).toBe(true);
        expect(statSync(allowedTargets.pdf).size).toBeGreaterThan(100);
        expect(readFileSync(allowedTargets.pdf).subarray(0, 5).toString('ascii')).toBe('%PDF-');
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = getDocument({ data: new Uint8Array(readFileSync(allowedTargets.pdf)) });
        const pdfDocument = await loadingTask.promise;
        try {
            const extracted: string[] = [];
            for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
                const pdfPage = await pdfDocument.getPage(pageNumber);
                const text = await pdfPage.getTextContent();
                extracted.push(text.items.map(item => 'str' in item ? item.str : '').join(' '));
            }
            const normalizedPdf = extracted.join(' ').normalize('NFKC').replace(/\s+/g, '');
            expect(normalizedPdf).toContain(titleFixture);
            expect(normalizedPdf).toContain(bodyFixture);
        } finally {
            await loadingTask.destroy();
        }

        await modal.getByRole('radio', { name: /JSON 数据快照/ }).focus();
        await page.keyboard.press('Space');
        await modal.getByRole('button', { name: '导出文件', exact: true }).click();
        await expect(modal.getByText(new RegExp(`已导出到：${allowedTargets.json.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => existsSync(allowedTargets.json)).toBe(true);
        const backup = JSON.parse(readFileSync(allowedTargets.json, 'utf8')) as {
            entries: Array<{ date: string; title: string; content: string }>;
        };
        expect(backup.entries).toContainEqual(expect.objectContaining({
            date,
            title: titleFixture,
            content: bodyFixture,
        }));

        await modal.getByRole('radio', { name: 'Markdown', exact: true }).focus();
        await page.keyboard.press('Space');
        await modal.getByRole('button', { name: '导出文件', exact: true }).click();
        await expect(modal.getByText(new RegExp(`已导出到：${allowedTargets.markdown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => existsSync(allowedTargets.markdown)).toBe(true);
        const markdown = readFileSync(allowedTargets.markdown, 'utf8');
        expect(markdown).toContain(titleFixture);
        expect(markdown).toContain(bodyFixture);

        const requests = await application.evaluate((_electron, stateKey) => {
            const state = Reflect.get(process, stateKey) as SaveDialogState | undefined;
            return state?.requests ?? [];
        }, saveDialogStateKey);
        expect(requests).toHaveLength(4);
        expect(requests.map(request => request.title)).toEqual([
            '导出为 PDF 报告', '导出为 PDF 报告', '导出为 JSON 数据快照', '导出为 Markdown',
        ]);
        expect(requests.slice(1).map(request => request.defaultPath)).toEqual([
            expect.stringContaining('MindDiary_'),
            expect.stringContaining('MindDiary_'),
            expect.stringContaining('MindDiary_'),
        ]);

        await attachJson(testInfo, 'export-modal-focus-and-file-allowlist.json', {
            profilePath,
            date,
            titleFixture,
            bodyFixture,
            allowedTargets,
            saveDialogRequests: requests,
            exports: {
                pdf: { exists: existsSync(allowedTargets.pdf), bytes: statSync(allowedTargets.pdf).size, signature: '%PDF-' },
                jsonContainsDiaryFixture: backup.entries.some(entry => entry.date === date && entry.title === titleFixture && entry.content === bodyFixture),
                markdownContainsDiaryFixture: markdown.includes(titleFixture) && markdown.includes(bodyFixture),
            },
        });
        bodyFailed = false;
    } finally {
        const current = ownedApps[0];
        let restoreError: unknown;
        if (saveDialogMockInstalled && current && !hasExited(current.process)) {
            try {
                await current.application.evaluate(({ dialog }, stateKey) => {
                    const state = Reflect.get(process, stateKey) as SaveDialogState | undefined;
                    if (typeof state?.originalDialog === 'function') {
                        Reflect.set(dialog, 'showSaveDialog', state.originalDialog);
                    }
                    Reflect.deleteProperty(process, stateKey);
                }, saveDialogStateKey);
            } catch (error) {
                console.error('Failed to restore ExportModal E2E save-dialog seam', error);
                restoreError = error;
            }
        }
        await cleanup(ownedApps, profilePath, bodyFailed || restoreError !== undefined);
        if (restoreError && !bodyFailed) throw restoreError;
    }
});
