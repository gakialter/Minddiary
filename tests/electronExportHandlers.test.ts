// @vitest-environment node

import path from 'path';
import { pathToFileURL } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createExportHandlers } from '../electron/exportHandlers';

const EXPORT_PATH = 'C:\\Users\\tester\\MindDiary.md';
const PDF_PATH = 'C:\\Users\\tester\\MindDiary.pdf';
const TEMP_DIR = 'C:\\Users\\tester\\AppData\\Local\\Temp';

function missingFileError(): NodeJS.ErrnoException {
    return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

function makeExistingFileStat() {
    return { isDirectory: () => false };
}

function makeDirectoryStat() {
    return { isDirectory: () => true };
}

function createTestHandlers() {
    const stat = vi.fn(async (_filepath: string): Promise<ReturnType<typeof makeExistingFileStat>> => {
        throw missingFileError();
    });
    const writeFile = vi.fn(async (_filepath: string, _data: string | Buffer, _encoding?: BufferEncoding) => undefined);
    const unlink = vi.fn(async (_filepath: string) => undefined);
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: EXPORT_PATH }));
    const registrationOrder: string[] = [];
    let windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    const navigationHandlers = new Map<string, (event: { preventDefault: () => void }, target: string) => void>();
    const setWindowOpenHandler = vi.fn((handler: typeof windowOpenHandler) => {
        registrationOrder.push('window-open');
        windowOpenHandler = handler;
    });
    const on = vi.fn((event: string, handler: (event: { preventDefault: () => void }, target: string) => void) => {
        registrationOrder.push(event);
        navigationHandlers.set(event, handler);
    });
    const loadFile = vi.fn(async () => {
        registrationOrder.push('loadFile');
    });
    const printToPDF = vi.fn(async () => Buffer.from('pdf'));
    const close = vi.fn();
    const isDestroyed = vi.fn(() => false);
    const BrowserWindow = vi.fn(function MockBrowserWindow() {
        return {
            loadFile,
            close,
            isDestroyed,
            webContents: { on, printToPDF, setWindowOpenHandler },
        };
    });

    const handlers = createExportHandlers({
        app: { getPath: vi.fn(() => TEMP_DIR) },
        BrowserWindow,
        dialog: { showSaveDialog },
        fs: { promises: { stat, writeFile, unlink } },
        path: path.win32,
        getMainWindow: vi.fn(() => ({ id: 1 })),
        platform: 'win32',
    });

    return {
        handlers,
        stat,
        writeFile,
        unlink,
        showSaveDialog,
        BrowserWindow,
        loadFile,
        printToPDF,
        close,
        navigationHandlers,
        registrationOrder,
        getWindowOpenHandler: () => windowOpenHandler,
    };
}

describe('Electron export path authorization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows writeFile after showSaveDialog authorizes the returned path', async () => {
        const { handlers, writeFile } = createTestHandlers();

        await expect(handlers.showSaveDialog(null, { title: 'Export' })).resolves.toBe(EXPORT_PATH);
        await expect(handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# diary' })).resolves.toBeUndefined();

        expect(writeFile).toHaveBeenCalledWith(path.win32.resolve(EXPORT_PATH), '# diary', 'utf-8');
    });

    it('rejects writeFile for an absolute path that did not come from showSaveDialog', async () => {
        const { handlers, writeFile } = createTestHandlers();

        await expect(
            handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# diary' }),
        ).rejects.toThrow(/not authorized/);

        expect(writeFile).not.toHaveBeenCalled();
    });

    it('rejects relative paths before they can be resolved into absolute paths', async () => {
        const { handlers, writeFile } = createTestHandlers();

        await expect(
            handlers.writeFile(null, { filepath: 'exports\\diary.md', content: '# diary' }),
        ).rejects.toThrow(/absolute path/);

        expect(writeFile).not.toHaveBeenCalled();
    });

    it.each([
        ['empty string', ''],
        ['whitespace string', '   '],
        ['null', null],
        ['number', 42],
        ['null byte', 'C:\\Users\\tester\\bad\0.md'],
        ['newline', 'C:\\Users\\tester\\bad\n.md'],
        ['DEL character', 'C:\\Users\\tester\\bad\x7F.md'],
    ])('rejects invalid path values: %s', async (_label, filepath) => {
        const { handlers, writeFile } = createTestHandlers();

        await expect(
            handlers.writeFile(null, { filepath, content: '# diary' }),
        ).rejects.toThrow(/Invalid export path/);

        expect(writeFile).not.toHaveBeenCalled();
    });

    it('rejects toPDF for an unauthorized savePath before temp file or window side effects', async () => {
        const { handlers, writeFile, BrowserWindow } = createTestHandlers();

        await expect(
            handlers.toPDF(null, { htmlContent: '<html></html>', savePath: PDF_PATH }),
        ).rejects.toThrow(/not authorized/);

        expect(writeFile).not.toHaveBeenCalled();
        expect(BrowserWindow).not.toHaveBeenCalled();
    });

    it('consumes an authorized path after a successful writeFile call', async () => {
        const { handlers, writeFile } = createTestHandlers();

        await handlers.showSaveDialog(null, { title: 'Export' });
        await handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# diary' });

        await expect(
            handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# diary again' }),
        ).rejects.toThrow(/not authorized/);

        expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it('consumes an authorized path even when writeFile fails', async () => {
        const { handlers, writeFile } = createTestHandlers();
        writeFile.mockRejectedValueOnce(new Error('disk full'));

        await handlers.showSaveDialog(null, { title: 'Export' });
        await expect(
            handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# diary' }),
        ).rejects.toThrow(/disk full/);

        await expect(
            handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# retry' }),
        ).rejects.toThrow(/not authorized/);

        expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it('rejects existing directory targets returned by showSaveDialog', async () => {
        const directoryPath = 'C:\\Users\\tester\\Exports';
        const { handlers, stat, showSaveDialog } = createTestHandlers();
        showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: directoryPath });
        stat.mockResolvedValueOnce(makeDirectoryStat());

        await expect(handlers.showSaveDialog(null, { title: 'Export' })).rejects.toThrow(/directory/);
    });

    it('allows PDF export only after showSaveDialog authorizes the savePath', async () => {
        const { handlers, showSaveDialog, writeFile, unlink, BrowserWindow, loadFile, printToPDF, close } = createTestHandlers();
        showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: PDF_PATH });

        await handlers.showSaveDialog(null, { title: 'Export PDF' });
        await handlers.toPDF(null, { htmlContent: '<html></html>', savePath: PDF_PATH });

        const tmpPath = path.win32.join(TEMP_DIR, 'minddiary_export_tmp.html');
        expect(writeFile).toHaveBeenNthCalledWith(1, tmpPath, '<html></html>', 'utf-8');
        expect(writeFile).toHaveBeenNthCalledWith(2, path.win32.resolve(PDF_PATH), Buffer.from('pdf'));
        expect(BrowserWindow).toHaveBeenCalledTimes(1);
        expect(loadFile).toHaveBeenCalledWith(tmpPath);
        expect(printToPDF).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
        expect(unlink).toHaveBeenCalledWith(tmpPath);
    });

    it('registers a fully isolated print-window policy before loading the temporary document', async () => {
        const fixture = createTestHandlers();
        fixture.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: PDF_PATH });

        await fixture.handlers.showSaveDialog(null, { title: 'Export PDF' });
        await fixture.handlers.toPDF(null, { htmlContent: '<html></html>', savePath: PDF_PATH });

        expect(fixture.BrowserWindow).toHaveBeenCalledWith({
            show: false,
            width: 1000,
            height: 1400,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                webSecurity: true,
                allowRunningInsecureContent: false,
                webviewTag: false,
                sandbox: true,
                javascript: false,
            },
        });
        expect(fixture.registrationOrder).toEqual(['window-open', 'will-navigate', 'will-redirect', 'loadFile']);

        const openHandler = fixture.getWindowOpenHandler();
        const navigate = fixture.navigationHandlers.get('will-navigate');
        const redirect = fixture.navigationHandlers.get('will-redirect');
        if (!openHandler || !navigate || !redirect) throw new Error('Print-window handlers were not registered');
        expect(openHandler({ url: 'https://external.test/' })).toEqual({ action: 'deny' });

        const documentUrl = pathToFileURL(path.win32.join(TEMP_DIR, 'minddiary_export_tmp.html')).href;
        for (const handler of [navigate, redirect]) {
            const allowed = { preventDefault: vi.fn() };
            handler(allowed, `${documentUrl}#page-2`);
            expect(allowed.preventDefault).not.toHaveBeenCalled();
            for (const target of ['file:///C:/other.html', 'https://external.test/', 'local://asset', 'javascript:alert(1)', 'data:text/html,x', 'blob:null/id', 'not a url']) {
                const blocked = { preventDefault: vi.fn() };
                handler(blocked, target);
                expect(blocked.preventDefault).toHaveBeenCalledOnce();
            }
        }
    });

    it('allows an existing non-directory save target', async () => {
        const { handlers, stat, writeFile } = createTestHandlers();
        stat.mockResolvedValue(makeExistingFileStat());

        await handlers.showSaveDialog(null, { title: 'Export' });
        await handlers.writeFile(null, { filepath: EXPORT_PATH, content: '# diary' });

        expect(writeFile).toHaveBeenCalledWith(path.win32.resolve(EXPORT_PATH), '# diary', 'utf-8');
    });
});
