import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createDisposableElectronProfile,
    removeDisposableElectronProfile,
} from './disposableElectronProfile';

const projectRoot = path.resolve(__dirname, '..', '..');
const profilePrefix = 'minddiary-inline-formatting-e2e-';

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
            throw new Error('Refusing to remove the disposable profile while its Electron process is running');
        }
        await removeDisposableElectronProfile(profilePath, profilePrefix);
    } catch (error) {
        errors.push(error);
    }
    if (errors.length) {
        console.error('Inline-formatting E2E cleanup failed', errors);
        if (!bodyFailed) throw errors[0];
    }
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
    await navigation.getByRole('button', { name: '写日记', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '日记正文', exact: true })).toBeVisible();
    return { owned, page };
}

async function selectText(page: Page, text: string): Promise<void> {
    const body = page.getByRole('textbox', { name: '日记正文', exact: true });
    await body.evaluate((element, target) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const offset = node.textContent?.indexOf(target) ?? -1;
            if (offset < 0) continue;
            (element as HTMLElement).focus();
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + target.length);
            const selection = window.getSelection();
            if (!selection) throw new Error('Browser selection is unavailable');
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            return;
        }
        throw new Error(`Text not found in the rendered diary: ${target}`);
    }, text);
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

async function readCanonical(page: Page, date: string) {
    return page.evaluate(targetDate => window.api.entries.getByDate(targetDate), date);
}

async function saveCanonical(page: Page, date: string, expected: string): Promise<unknown> {
    await page.getByRole('textbox', { name: '日记正文', exact: true }).press('Control+s');
    await expect.poll(async () => (await readCanonical(page, date))?.content).toBe(expected);
    return readCanonical(page, date);
}

async function recordArtifact(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
    await writeFile(testInfo.outputPath(name), JSON.stringify(value, null, 2), 'utf8');
}

test('selection formatting keeps its logical range, writes canonical Markdown, and participates in native undo/redo', async ({}, testInfo) => {
    test.setTimeout(90_000);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const ownedApps: OwnedElectron[] = [];
    let bodyFailed = true;
    try {
        const { page } = await launchProduction(profilePath, ownedApps);
        const body = page.getByRole('textbox', { name: '日记正文', exact: true });
        const date = (await page.locator('.sidebar-today-date').innerText()).trim();
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const phrase = '今天很重要';
        const expected = '**++{color:blue}今天很重要{/color}++** 继续写';
        await body.click();
        await page.keyboard.insertText(phrase);
        await selectText(page, phrase);

        const floating = page.locator('.diary-selection-toolbar');
        await expect(floating).toBeVisible();
        await floating.getByRole('button', { name: '加粗', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(phrase);
        await expect(floating.getByRole('button', { name: '加粗', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await floating.getByRole('button', { name: '下划线', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(phrase);
        await expect(floating.getByRole('button', { name: '下划线', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await body.press('Control+z');
        await expect(body.locator('.diary-format-underline')).toHaveCount(0);
        await body.press('Control+y');
        await expect(body.locator('.diary-format-underline')).toHaveText(phrase);
        await floating.getByRole('button', { name: '文字颜色', exact: true }).click();
        const colors = floating.getByRole('group', { name: '选择颜色' });
        await expect(colors).toBeVisible();
        await colors.getByRole('button', { name: '蓝色', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(phrase);
        await expect(floating.getByRole('button', { name: '文字颜色', exact: true })).toHaveAttribute('aria-pressed', 'true');

        await body.press('Space');
        await expect(body).toHaveText(phrase + ' ');
        await body.press('Control+z');
        await expect(body).toHaveText(phrase);
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(phrase);
        await body.press('Control+y');
        await expect(body).toHaveText(phrase + ' ');
        await page.keyboard.insertText('继续写');
        await expect(body).toContainText('今天很重要 继续写');
        await expect(body).not.toContainText('**');
        await expect(body).not.toContainText('{color:blue}');
        const saved = await saveCanonical(page, date, expected);

        await body.press('Control+z');
        await expect(body).toHaveText('今天很重要 ');
        await body.press('Control+y');
        await expect(body).toContainText('今天很重要 继续写');
        await saveCanonical(page, date, expected);

        const visualEvidence: unknown[] = [];
        const viewportEvidence: unknown[] = [];
        for (const theme of ['light', 'dark'] as const) {
            await page.getByRole('navigation', { name: '主要导航' })
                .getByRole('button', { name: '设置', exact: true }).click();
            await page.locator('#settings-theme').selectOption(theme);
            if (theme === 'dark') {
                await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            } else {
                await expect(page.locator('html')).not.toHaveAttribute('data-theme');
            }
            await page.getByRole('navigation', { name: '主要导航' })
                .getByRole('button', { name: '写日记', exact: true }).click();
            await selectText(page, phrase);
            const themeToolbar = page.locator('.diary-selection-toolbar');
            await expect(themeToolbar).toBeVisible();
            await expect(themeToolbar.getByRole('button', { name: '加粗', exact: true }))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(themeToolbar.getByRole('button', { name: '下划线', exact: true }))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(themeToolbar.getByRole('button', { name: '文字颜色', exact: true }))
                .toHaveAttribute('aria-pressed', 'true');
            await themeToolbar.getByRole('button', { name: '高亮', exact: true }).hover();
            const style = await themeToolbar.getByRole('button', { name: '加粗', exact: true }).evaluate(button => {
                const selected = getComputedStyle(button);
                const hovered = getComputedStyle(button.parentElement!.querySelector('[aria-label="高亮"]')!);
                const marker = button.parentElement!.querySelector('.color-picker__current-color');
                return {
                    activeClass: button.classList.contains('format-toolbar__button--selected'),
                    selectedBackground: selected.backgroundColor,
                    selectedColor: selected.color,
                    selectedShadow: selected.boxShadow,
                    hoveredBackground: hovered.backgroundColor,
                    hoveredColor: hovered.color,
                    colorMarker: marker ? getComputedStyle(marker).backgroundColor : null,
                };
            });
            expect(style.activeClass).toBe(true);
            expect(style.selectedBackground).not.toBe(style.hoveredBackground);
            expect(style.selectedShadow).not.toBe('none');
            expect(style.colorMarker).not.toBeNull();
            expect(style.colorMarker).not.toBe('rgba(0, 0, 0, 0)');
            visualEvidence.push({ theme, ...style });

            for (const size of [{ width: 960, height: 600 }, { width: 1280, height: 720 }]) {
                await page.setViewportSize(size);
                const box = await themeToolbar.boundingBox();
                expect(box).not.toBeNull();
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
                viewportEvidence.push({ theme, ...size, box });
            }
        }

        await selectText(page, phrase);
        await floating.getByRole('button', { name: '清除格式', exact: true }).click();
        await expect(body.locator('.diary-format-bold, .diary-format-underline, .md-color-blue')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(phrase);
        const cleared = await saveCanonical(page, date, `${phrase} 继续写`);
        await body.press('Control+z');
        await expect(body.locator('.diary-format-bold')).toHaveText(phrase);
        await body.press('Control+y');
        await expect(body.locator('.diary-format-bold, .diary-format-underline, .md-color-blue')).toHaveCount(0);

        await recordArtifact(testInfo, 'inline-formatting.json', {
            profilePath, date, phrase, expected,
            canonicalAfterTyping: saved,
            canonicalAfterClear: cleared,
            selectionStyle: visualEvidence,
            floatingToolbar: viewportEvidence,
            validationLabel: 'real Electron current-source production renderer; synthetic keyboard input; no native IME composition claim',
        });
        await page.screenshot({ path: testInfo.outputPath('inline-formatting.png') });
        bodyFailed = false;
    } finally {
        await cleanup(ownedApps, profilePath, bodyFailed);
    }
});

test('ordinary selected text is replaced by Space and caret formatting continues across spaces', async ({}, testInfo) => {
    test.setTimeout(90_000);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const ownedApps: OwnedElectron[] = [];
    let bodyFailed = true;
    try {
        const { page } = await launchProduction(profilePath, ownedApps);
        const body = page.getByRole('textbox', { name: '日记正文', exact: true });
        const date = (await page.locator('.sidebar-today-date').innerText()).trim();
        await body.click();
        await page.keyboard.insertText('替换这段并继续');
        await selectText(page, '替换这段');
        await body.press('Space');
        await page.keyboard.insertText('普通文本');
        await expect(body).toContainText(' 普通文本并继续');

        await body.click();
        await body.press('Control+End');
        await body.press('Control+u');
        await page.keyboard.type('two words');
        await expect(body.locator('.diary-format-underline')).toHaveText('two words');
        await expect(body).not.toContainText('**');
        const expected = ' 普通文本并继续++two words++';
        const saved = await saveCanonical(page, date, expected);
        await recordArtifact(testInfo, 'inline-formatting-keyboard.json', {
            profilePath, date, expected, canonical: saved,
            validationLabel: 'real Electron; Playwright keyboard input only, not Windows IME composition',
        });
        await page.screenshot({ path: testInfo.outputPath('inline-formatting-keyboard.png') });
        bodyFailed = false;
    } finally {
        await cleanup(ownedApps, profilePath, bodyFailed);
    }
});

test('Chromium composition does not intercept Space', async ({}, testInfo) => {
    test.setTimeout(90_000);
    const profilePath = createDisposableElectronProfile(profilePrefix);
    const ownedApps: OwnedElectron[] = [];
    let bodyFailed = true;
    try {
        const { page } = await launchProduction(profilePath, ownedApps);
        const body = page.getByRole('textbox', { name: '日记正文', exact: true });
        const date = (await page.locator('.sidebar-today-date').innerText()).trim();
        await body.click();
        await page.keyboard.insertText('前置组合尾部');
        await selectText(page, '组合');
        const floating = page.locator('.diary-selection-toolbar');
        await expect(floating).toBeVisible();
        await floating.getByRole('button', { name: '下划线', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('组合');
        await floating.getByRole('button', { name: '文字颜色', exact: true }).click();
        await floating.getByRole('group', { name: '选择颜色' }).getByRole('button', { name: '蓝色', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('组合');

        await body.evaluate(element => {
            const log: string[] = [];
            for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
                element.addEventListener(type, () => log.push(type), true);
            }
            Reflect.set(window, '__inlineCompositionEvents', log);
        });
        const cdp = await page.context().newCDPSession(page);
        try {
            await cdp.send('Input.imeSetComposition', { text: '候选', selectionStart: 2, selectionEnd: 2 });
            await expect.poll(() => page.evaluate(() =>
                (Reflect.get(window, '__inlineCompositionEvents') as string[]).includes('compositionstart'))
            ).toBe(true);
            await expect(body).toContainText('候选');
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() =>
                (Reflect.get(window, '__inlineCompositionEvents') as string[]).filter(type => type === 'compositionend').length)
            ).toBe(0);
            await expect(body).toContainText('候选 ');
            await expect(body).not.toContainText('组合');
            await expect.poll(() => body.locator('.diary-format-underline').innerText()).toBe('候选 ');
            await expect.poll(() => body.locator('.md-color-blue').innerText()).toBe('候选 ');
            const compositionProbe = await page.evaluate(() => {
                const content = document.querySelector<HTMLElement>('[aria-label="日记正文"]');
                return {
                    textContent: content?.textContent,
                    innerText: content?.innerText,
                    html: content?.innerHTML,
                    events: Reflect.get(window, '__inlineCompositionEvents'),
                };
            });
            await recordArtifact(testInfo, 'inline-formatting-chromium-composition.json', {
                profilePath, date, composition: compositionProbe,
                validationLabel: 'real Electron renderer with Chromium CDP Input.imeSetComposition and synthetic Space key; Space guard only, not a commit/cancel test or Windows Microsoft Pinyin proof',
            });
            await page.screenshot({ path: testInfo.outputPath('inline-formatting-chromium-composition.png') });

            bodyFailed = false;
        } finally {
            await cdp.detach();
        }
    } finally {
        await cleanup(ownedApps, profilePath, bodyFailed);
    }
});
