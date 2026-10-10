import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createDisposableElectronProfile,
    removeDisposableElectronProfile,
} from './disposableElectronProfile';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
// Playwright's automatic error prompt includes password input values in its
// accessibility snapshot. Credential evidence must remain boolean-only.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

const projectRoot = path.resolve(__dirname, '..', '..');
const profilePrefix = 'minddiary-settings-key-persistence-e2e-';
const fixtureReply = 'Local synthetic fixture response.';

interface OwnedElectron {
    application: ElectronApplication;
    process: ChildProcess;
}

interface LocalFixture {
    server: Server;
    endpoint: string;
    authMatches: boolean[];
    expectedCredential: string;
}

function hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

async function closeOwnedApplication(owned: OwnedElectron): Promise<void> {
    await owned.application.close();
    await expect.poll(() => hasExited(owned.process), { timeout: 10_000 }).toBe(true);
}

async function closeFixture(fixture: LocalFixture): Promise<void> {
    if (!fixture.server.listening) return;
    await new Promise<void>((resolve, reject) => {
        fixture.server.close(error => error ? reject(error) : resolve());
    });
}

async function cleanup(
    ownedApps: OwnedElectron[],
    profilePath: string,
    fixture: LocalFixture,
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
    try {
        await closeFixture(fixture);
    } catch (error) {
        errors.push(error);
    }
    if (errors.length) {
        console.error('Settings key persistence E2E cleanup failed', errors);
        if (!bodyFailed) throw errors[0];
    }
}

async function createLocalFixture(initialCredential: string): Promise<LocalFixture> {
    const fixture: LocalFixture = {
        server: createServer((request, response) => {
            fixture.authMatches.push(request.headers.authorization === `Bearer ${fixture.expectedCredential}`);
            request.resume();
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: fixtureReply }, finish_reason: 'stop' }],
            }));
        }),
        endpoint: '',
        authMatches: [],
        expectedCredential: initialCredential,
    };
    await new Promise<void>((resolve, reject) => {
        fixture.server.once('error', reject);
        fixture.server.listen(0, '127.0.0.1', () => {
            fixture.server.removeListener('error', reject);
            resolve();
        });
    });
    const address = fixture.server.address();
    if (!address || typeof address === 'string') throw new Error('Local AI fixture did not bind a TCP port');
    fixture.endpoint = `http://127.0.0.1:${address.port}/v1`;
    return fixture;
}

async function launchProduction(profilePath: string, ownedApps: OwnedElectron[]): Promise<{ owned: OwnedElectron; page: Page }> {
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

async function navigate(page: Page, view: '设置' | '学习助手'): Promise<void> {
    await page.getByRole('navigation', { name: '主要导航' })
        .getByRole('button', { name: view, exact: true }).click();
    if (view === '设置') {
        await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
        await expect(page.getByLabel('API Key', { exact: true })
            .or(page.getByRole('button', { name: '修改', exact: true }))
            .or(page.getByRole('button', { name: '清除 Key', exact: true })).first()).toBeVisible();
    } else {
        await expect(page.locator('#ai-composer-input')).toBeVisible();
    }
}

async function openKeyEditor(page: Page): Promise<Locator> {
    const modify = page.getByRole('button', { name: '修改', exact: true });
    if (await modify.isVisible().catch(() => false)) await modify.click();
    const keyInput = page.getByLabel('API Key', { exact: true });
    await expect(keyInput).toBeVisible();
    return keyInput;
}

async function sendLocalAIRequest(page: Page, promptId: string): Promise<void> {
    const composer = page.locator('#ai-composer-input');
    await composer.fill(`Synthetic credential persistence check ${promptId}`);
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await expect(page.getByText(fixtureReply, { exact: true }).last()).toBeVisible({ timeout: 15_000 });
}

async function expectLatestAuthMatch(fixture: LocalFixture, previousCount: number): Promise<void> {
    await expect.poll(() => fixture.authMatches.length, { timeout: 10_000 }).toBe(previousCount + 1);
    expect(fixture.authMatches[previousCount]).toBe(true);
}

test('saves rotated API keys through Settings and uses the current credential after navigation and reload', async ({}, testInfo) => {
    test.setTimeout(180_000);
    const baselineCredential = `synthetic-${randomUUID()}`;
    const fixture = await createLocalFixture(baselineCredential);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const ownedApps: OwnedElectron[] = [];
    let nativeClipboardPasteApplied = false;
    let bodyFailed = true;
    try {
        const { owned, page } = await launchProduction(profilePath, ownedApps);
        await page.evaluate(async config => {
            await window.api.settings.updateAI({
                aiEndpoint: config.endpoint,
                aiModel: 'minddiary-local-e2e-model',
                aiApiKey: config.credential,
            });
        }, { endpoint: fixture.endpoint, credential: baselineCredential });

        await navigate(page, '设置');
        let keyInput = await openKeyEditor(page);
        // Reproduce the 16 ms edit path after opening the credential editor.
        const fastCredential = `fast-${randomUUID()}`;
        await page.waitForTimeout(16);
        await keyInput.click();
        await page.keyboard.insertText(fastCredential);
        fixture.expectedCredential = fastCredential;
        await expect(page.getByRole('status').filter({ hasText: 'API Key 已保存；可继续修改。' })).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(750);
        await expect(keyInput).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'API Key 已保存；可继续修改。' })).toBeVisible();

        await navigate(page, '学习助手');
        let requestCount = fixture.authMatches.length;
        await sendLocalAIRequest(page, randomUUID());
        await expectLatestAuthMatch(fixture, requestCount);

        // Reproduce the independent 316 ms reviewer path from a fresh editor.
        await navigate(page, '设置');
        keyInput = await openKeyEditor(page);
        const reviewerCredential = `review-${randomUUID()}`;
        await page.waitForTimeout(316);
        await keyInput.click();
        await page.keyboard.insertText(reviewerCredential);
        fixture.expectedCredential = reviewerCredential;
        await expect(page.getByRole('status').filter({ hasText: 'API Key 已保存；可继续修改。' })).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(750);
        await expect(keyInput).toBeVisible();

        // An empty edit is informational and must leave the active stored credential intact.
        await keyInput.fill('');
        await expect(page.getByRole('status').filter({ hasText: '留空保持现有 Key' })).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(750);
        await expect(keyInput).toBeVisible();
        await navigate(page, '学习助手');
        requestCount = fixture.authMatches.length;
        await sendLocalAIRequest(page, randomUUID());
        await expectLatestAuthMatch(fixture, requestCount);

        // Leaving the newly opened editor idle beyond the debounce must keep it open for later entry.
        await navigate(page, '设置');
        keyInput = await openKeyEditor(page);
        await page.waitForTimeout(750);
        await expect(keyInput).toBeVisible();

        // Pause beyond the debounce after the first few characters, then continue with slow key entry.
        const slowCredential = `slow-${randomUUID().slice(0, 8)}`;
        await keyInput.click();
        await page.keyboard.type(slowCredential.slice(0, 4));
        await page.waitForTimeout(650);
        await expect(page.getByRole('status').filter({ hasText: 'API Key 已保存；可继续修改。' })).toBeVisible({ timeout: 10_000 });
        await expect(keyInput).toBeVisible();
        await page.keyboard.type(slowCredential.slice(4), { delay: 300 });
        fixture.expectedCredential = slowCredential;
        await expect(page.getByRole('status').filter({ hasText: 'API Key 已保存；可继续修改。' })).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(750);
        await expect(keyInput).toBeVisible();
        await navigate(page, '学习助手');
        requestCount = fixture.authMatches.length;
        await sendLocalAIRequest(page, randomUUID());
        await expectLatestAuthMatch(fixture, requestCount);

        // Exercise native Ctrl+V when the OS clipboard is empty, and remove
        // only our owned synthetic text. A user's existing clipboard is left alone.
        await navigate(page, '设置');
        keyInput = await openKeyEditor(page);
        const pastedCredential = `paste-${randomUUID()}`;
        await keyInput.click();
        nativeClipboardPasteApplied = await owned.application.evaluate(({ clipboard }, credential) => {
            if (clipboard.availableFormats().length) return false;
            clipboard.writeText(credential);
            return true;
        }, pastedCredential);
        try {
            if (nativeClipboardPasteApplied) await page.keyboard.press('ControlOrMeta+V');
            else await page.keyboard.insertText(pastedCredential);
        } finally {
            if (nativeClipboardPasteApplied) await owned.application.evaluate(({ clipboard }, credential) => {
                if (clipboard.readText() === credential) clipboard.clear();
            }, pastedCredential);
        }
        fixture.expectedCredential = pastedCredential;
        await expect(page.getByRole('status').filter({ hasText: 'API Key 已保存；可继续修改。' })).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(750);
        await expect(keyInput).toBeVisible();
        await navigate(page, '学习助手');
        requestCount = fixture.authMatches.length;
        await sendLocalAIRequest(page, randomUUID());
        await expectLatestAuthMatch(fixture, requestCount);

        // Explicit save completes editing and is verified by the next actual provider request.
        await navigate(page, '设置');
        keyInput = await openKeyEditor(page);
        const explicitlySavedCredential = `explicit-${randomUUID()}`;
        await keyInput.fill(explicitlySavedCredential);
        fixture.expectedCredential = explicitlySavedCredential;
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await expect(page.getByText(/已配置（/)).toBeVisible({ timeout: 10_000 });
        await expect(keyInput).toBeHidden();
        await navigate(page, '学习助手');
        requestCount = fixture.authMatches.length;
        await sendLocalAIRequest(page, randomUUID());
        await expectLatestAuthMatch(fixture, requestCount);

        // A renderer reload must retain the explicitly saved key for a fresh real request.
        await page.reload();
        await page.waitForLoadState('load');
        await navigate(page, '学习助手');
        requestCount = fixture.authMatches.length;
        await sendLocalAIRequest(page, randomUUID());
        await expectLatestAuthMatch(fixture, requestCount);

        // The dedicated clear action removes the key; a later send must not reach the fixture.
        await navigate(page, '设置');
        await page.getByRole('button', { name: '清除 Key', exact: true }).click();
        await expect(page.getByRole('button', { name: '取消清除', exact: true })).toBeHidden({ timeout: 10_000 });
        await expect(page.getByLabel('API Key', { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/已配置（/)).toBeHidden();
        await navigate(page, '学习助手');
        requestCount = fixture.authMatches.length;
        await page.locator('#ai-composer-input').fill(`Synthetic credential persistence check ${randomUUID()}`);
        await page.getByRole('button', { name: '发送问题', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: '请求未发出' })).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => fixture.authMatches.length, { timeout: 3_000 }).toBe(requestCount);
        const authenticationEvidencePath = testInfo.outputPath('credential-authentication-categories.json');
        writeFileSync(authenticationEvidencePath, JSON.stringify({
                authenticationMatches: fixture.authMatches,
                requestsAfterClear: fixture.authMatches.length - requestCount,
                nativeClipboardPasteApplied,
                evidence: 'production Settings UI → SQLite/preload → AIPanel → local HTTP Authorization comparison',
                inputScenarios: ['16ms', '316ms', 'delayed input', 'slow typing and pause', 'text insertion', 'explicit save', 'empty input', 'clear', 'navigation', 'reload'],
            }, null, 2));
        await testInfo.attach('credential-authentication-categories.json', {
            path: authenticationEvidencePath,
            contentType: 'application/json',
        });
        bodyFailed = false;
    } finally {
        await cleanup(ownedApps, profilePath, fixture, bodyFailed);
    }
});
