import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createDisposableElectronProfile,
    removeDisposableElectronProfile,
} from './disposableElectronProfile';

const projectRoot = path.resolve(__dirname, '..', '..');
const profilePrefix = 'minddiary-stabilization-save-export-e2e-';
const pdfMainStateKey = '__minddiaryStabilizationPdfMain';
const pdfRendererStateKey = '__minddiaryStabilizationPdfRenderer';

interface OwnedElectron {
    application: ElectronApplication;
    process: ChildProcess;
}

function hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

async function closeOwnedApplication(owned: OwnedElectron): Promise<void> {
    await owned.application.close();
    await expect.poll(() => hasExited(owned.process), { timeout: 10_000 }).toBe(true);
}

async function cleanup(
    ownedApps: OwnedElectron[],
    profilePath: string,
    bodyFailed: boolean,
): Promise<void> {
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
        console.error('Stabilization E2E cleanup failed', errors);
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

test('persists the latest CodeMirror edit when sidebar navigation precedes autosave, reload, and a different-PID restart', async ({}, testInfo) => {
    test.setTimeout(90_000);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const ownedApps: OwnedElectron[] = [];
    let bodyFailed = true;
    try {
        const first = await launchProduction(profilePath, ownedApps);
        const firstPid = first.owned.process.pid;
        expect(firstPid).toBeGreaterThan(0);
        await openDiary(first.page);
        const date = (await first.page.locator('.sidebar-today-date').innerText()).trim();
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const sentinel = `MindDiary latest navigation save ${randomUUID()}`;
        const editor = first.page.getByRole('textbox', { name: '日记正文', exact: true });
        await expect(editor).toHaveClass(/cm-content/);
        await editor.click();
        await editor.press('ControlOrMeta+A');
        const typedAt = Date.now();
        await first.page.keyboard.insertText(sentinel);
        await first.page.getByRole('navigation', { name: '主要导航' })
            .getByRole('button', { name: '搜索日记', exact: true }).click();
        const navigationElapsedMs = Date.now() - typedAt;
        expect(navigationElapsedMs).toBeLessThan(2_000);
        await expect(editor).toBeHidden();
        await expect.poll(async () => (await readDiary(first.page, date))?.content).toBe(sentinel);
        const afterNavigation = await readDiary(first.page, date);

        await first.page.reload();
        await first.page.waitForLoadState('load');
        await expect.poll(async () => (await readDiary(first.page, date))?.content).toBe(sentinel);
        await openDiary(first.page);
        await expect(first.page.getByRole('textbox', { name: '日记正文', exact: true })).toHaveText(sentinel);
        const afterReload = await readDiary(first.page, date);

        await closeOwnedApplication(first.owned);
        const restarted = await launchProduction(profilePath, ownedApps);
        const restartedPid = restarted.owned.process.pid;
        expect(restartedPid).toBeGreaterThan(0);
        expect(restartedPid).not.toBe(firstPid);
        await openDiary(restarted.page);
        await expect(restarted.page.getByRole('textbox', { name: '日记正文', exact: true })).toHaveText(sentinel);
        const afterRestart = await readDiary(restarted.page, date);
        expect(afterRestart?.content).toBe(sentinel);
        expect(afterRestart?.id).toBe(afterNavigation?.id);
        await attachJson(testInfo, 'navigation-save-persistence.json', {
            profilePath, date, sentinel, navigationElapsedMs, firstPid, restartedPid,
            afterNavigation, afterReload, afterRestart,
        });
        await testInfo.attach('diary-after-restart', {
            body: await restarted.page.screenshot(),
            contentType: 'image/png',
        });
        bodyFailed = false;
    } finally {
        await cleanup(ownedApps, profilePath, bodyFailed);
    }
});

test('isolates overlapping real IPC PDF exports through distinct hidden print windows and cleans each source', async ({}, testInfo) => {
    test.setTimeout(90_000);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const ownedApps: OwnedElectron[] = [];
    const savePaths = [path.join(profilePath, 'A.pdf'), path.join(profilePath, 'B.pdf')] as const;
    const sentinels = [`MindDiary-PDF-A-${randomUUID()}`, `MindDiary-PDF-B-${randomUUID()}`] as const;
    let bodyFailed = true;
    let restorePending = false;
    let exportCompletion: Promise<{ outcomes?: { status: string; reason?: string }[]; error?: string }> | undefined;
    try {
        const { owned, page } = await launchProduction(profilePath, ownedApps);
        const application = owned.application;
        const initialWindowCount = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
        await application.evaluate(({ BrowserWindow, dialog }, { stateKey, targets }) => {
            const originalLoadFile = BrowserWindow.prototype.loadFile;
            const originalDialog = dialog.showSaveDialog;
            const paths: string[] = [];
            const releases: (() => void)[] = [];
            const windows: { id: number; visible: boolean }[] = [];
            let dialogIndex = 0;
            Reflect.set(process, stateKey, { paths, releases, windows, originalLoadFile, originalDialog });
            Reflect.set(dialog, 'showSaveDialog', async () => {
                const filePath = targets[dialogIndex++];
                if (!filePath) throw new Error('Unexpected extra PDF save dialog');
                return { canceled: false, filePath };
            });
            BrowserWindow.prototype.loadFile = async function (filePath, options) {
                if (/(?:^|[\\/])minddiary_export_[^\\/]+\.html$/i.test(filePath)) {
                    let release!: () => void;
                    const gate = new Promise<void>(resolve => { release = resolve; });
                    paths.push(filePath);
                    releases.push(release);
                    windows.push({ id: this.id, visible: this.isVisible() });
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        await Promise.race([
                            gate,
                            new Promise<void>((_resolve, reject) => {
                                timer = setTimeout(() => reject(new Error('PDF load gate was not released within 30 seconds')), 30_000);
                            }),
                        ]);
                    } finally {
                        if (timer) clearTimeout(timer);
                    }
                }
                return originalLoadFile.call(this, filePath, options);
            };
        }, { stateKey: pdfMainStateKey, targets: [...savePaths] });
        restorePending = true;
        exportCompletion = page.evaluate(async ({ targets, texts, stateKey }) => {
            const outcomes: ({ status: string; reason?: string } | null)[] = [null, null];
            Reflect.set(globalThis, stateKey, outcomes);
            for (const target of targets) {
                const selected = await window.api.export.showSaveDialog({ title: 'Stabilization PDF E2E' });
                if (selected !== target) throw new Error('Unexpected authorized PDF path');
            }
            await Promise.all(texts.map(async (sentinel, index) => {
                try {
                    const target = targets[index];
                    if (!target) throw new Error('Missing PDF target');
                    await window.api.export.toPDF(`<!doctype html><html><head><meta charset="utf-8"></head><body>${sentinel}</body></html>`, target);
                    outcomes[index] = { status: 'fulfilled' };
                } catch (error) {
                    outcomes[index] = { status: 'rejected', reason: String(error) };
                }
            }));
            return outcomes.map(outcome => {
                if (!outcome) throw new Error('PDF export did not settle');
                return outcome;
            });
        }, { targets: [...savePaths], texts: [...sentinels], stateKey: pdfRendererStateKey })
            .then(outcomes => ({ outcomes }), error => ({ error: String(error) }));

        await expect.poll(() => application.evaluate((_electron, key) => {
            const state = Reflect.get(process, key);
            return Array.isArray(state?.paths) ? state.paths.length : 0;
        }, pdfMainStateKey), { timeout: 10_000 }).toBe(2);
        const tempPaths: string[] = await application.evaluate((_electron, key) => {
            const state = Reflect.get(process, key);
            if (!Array.isArray(state?.paths)) throw new Error('PDF load gate state is unavailable');
            return state.paths.filter((entry: unknown): entry is string => typeof entry === 'string');
        }, pdfMainStateKey);
        expect(new Set(tempPaths).size).toBe(2);
        const printWindows: { id: number; visible: boolean }[] = await application.evaluate((_electron, key) => {
            const state = Reflect.get(process, key);
            if (!Array.isArray(state?.windows)) throw new Error('Print-window state is unavailable');
            return state.windows;
        }, pdfMainStateKey);
        expect(printWindows).toHaveLength(2);
        expect(new Set(printWindows.map(window => window.id)).size).toBe(2);
        expect(printWindows.every(window => !window.visible)).toBe(true);
        const tempA = tempPaths.find(filepath => readFileSync(filepath, 'utf8').includes(sentinels[0]));
        const tempB = tempPaths.find(filepath => readFileSync(filepath, 'utf8').includes(sentinels[1]));
        if (!tempA || !tempB) throw new Error('Both PDF source paths were not captured');
        expect(readFileSync(tempA, 'utf8')).toContain(sentinels[0]);
        expect(readFileSync(tempB, 'utf8')).toContain(sentinels[1]);
        await application.evaluate((_electron, { key, index }) => {
            const state = Reflect.get(process, key);
            const release = state?.releases?.[index];
            if (typeof release !== 'function') throw new Error('First PDF load gate is unavailable');
            release();
        }, { key: pdfMainStateKey, index: tempPaths.indexOf(tempA) });
        await expect.poll(() => page.evaluate(key => {
            const outcomes = Reflect.get(globalThis, key);
            return Array.isArray(outcomes) ? outcomes[0]?.status : undefined;
        }, pdfRendererStateKey), { timeout: 15_000 }).toBe('fulfilled');
        expect(existsSync(tempA)).toBe(false);
        expect(readFileSync(tempB, 'utf8')).toContain(sentinels[1]);
        await application.evaluate((_electron, { key, index }) => {
            const state = Reflect.get(process, key);
            const release = state?.releases?.[index];
            if (typeof release !== 'function') throw new Error('Second PDF load gate is unavailable');
            release();
        }, { key: pdfMainStateKey, index: tempPaths.indexOf(tempB) });
        const completion = await exportCompletion;
        expect(completion).toEqual({ outcomes: [{ status: 'fulfilled' }, { status: 'fulfilled' }] });
        expect(existsSync(tempB)).toBe(false);
        await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(initialWindowCount);

        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const extractedText: string[] = [];
        for (const index of [0, 1] as const) {
            const loadingTask = getDocument({ data: new Uint8Array(readFileSync(savePaths[index])) });
            const document = await loadingTask.promise;
            try {
                const pages: string[] = [];
                for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
                    const pdfPage = await document.getPage(pageNumber);
                    const content = await pdfPage.getTextContent();
                    pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
                }
                const normalized = pages.join(' ').normalize('NFKC').replace(/\s+/g, '');
                expect(normalized).toBe(sentinels[index]);
                expect(normalized).not.toContain(sentinels[index === 0 ? 1 : 0]);
                extractedText.push(normalized);
            } finally {
                await loadingTask.destroy();
            }
            await testInfo.attach(`PDF-${index === 0 ? 'A' : 'B'}`, { path: savePaths[index], contentType: 'application/pdf' });
        }
        await attachJson(testInfo, 'concurrent-pdf-exports.json', {
            profilePath, savePaths, sentinels, tempPaths, printWindows, completion, extractedText, initialWindowCount,
        });
        bodyFailed = false;
    } finally {
        const current = ownedApps[0];
        let restoreError: unknown;
        if (restorePending && current && !hasExited(current.process)) {
            try {
                await current.application.evaluate(({ BrowserWindow, dialog }, key) => {
                    const state = Reflect.get(process, key);
                    if (state) {
                        for (const release of state.releases || []) if (typeof release === 'function') release();
                        if (typeof state.originalLoadFile === 'function') BrowserWindow.prototype.loadFile = state.originalLoadFile;
                        if (typeof state.originalDialog === 'function') Reflect.set(dialog, 'showSaveDialog', state.originalDialog);
                    }
                    Reflect.deleteProperty(process, key);
                }, pdfMainStateKey);
            } catch (error) {
                console.error('Failed to restore PDF E2E test seams', error);
                restoreError = error;
            }
        }
        // Gates are released before shutdown; a failed renderer evaluation is already observed.
        if (exportCompletion) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    exportCompletion,
                    new Promise<void>(resolve => { timer = setTimeout(resolve, 5_000); }),
                ]);
            } finally {
                if (timer) clearTimeout(timer);
            }
        }
        await cleanup(ownedApps, profilePath, bodyFailed || restoreError !== undefined);
        if (restoreError && !bodyFailed) throw restoreError;
    }
});
