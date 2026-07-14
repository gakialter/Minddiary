import { pathToFileURL } from 'url';
import {
    createPrintWindowNavigationHandler,
    createPrintWindowOpenHandler,
    createPrintWindowWebPreferences,
} from './electronSecurity';

type PathModule = Pick<typeof import('path'), 'isAbsolute' | 'resolve' | 'join'>;

interface StatLike {
    isDirectory(): boolean;
}

interface FsModule {
    promises: {
        stat(filepath: string): Promise<StatLike>;
        writeFile(filepath: string, data: string | Buffer, encoding?: BufferEncoding): Promise<void>;
        unlink(filepath: string): Promise<void>;
    };
}

interface FileFilter {
    name: string;
    extensions: string[];
}

interface SaveDialogOptions {
    title?: string;
    defaultPath?: string;
    filters?: FileFilter[];
}

interface SaveDialogResult {
    canceled: boolean;
    filePath?: string;
}

interface BrowserWindowLike {
    loadFile(filepath: string): Promise<unknown>;
    close(): void;
    isDestroyed?: () => boolean;
    webContents: {
        on(event: 'will-navigate' | 'will-redirect', handler: (event: { preventDefault: () => void }, target: string) => void): void;
        printToPDF(options: Record<string, unknown>): Promise<Buffer>;
        setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
    };
}

interface ExportHandlersDeps {
    app: {
        getPath(name: string): string;
    };
    BrowserWindow: new (options: Record<string, unknown>) => BrowserWindowLike;
    dialog: {
        showSaveDialog(browserWindow: unknown, options: SaveDialogOptions): Promise<SaveDialogResult>;
    };
    fs: FsModule;
    path: PathModule;
    getMainWindow: () => unknown;
    platform?: NodeJS.Platform;
}

interface WriteFilePayload {
    filepath: unknown;
    content: unknown;
}

interface ToPdfPayload {
    htmlContent: unknown;
    savePath: unknown;
}

const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;

function isMissingPathError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

export function createExportHandlers({
    app,
    BrowserWindow,
    dialog,
    fs,
    path,
    getMainWindow,
    platform = process.platform,
}: ExportHandlersDeps) {
    const allowedSavePaths = new Set<string>();

    const pathKey = (resolvedPath: string): string => (
        platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
    );

    const validateSavePath = async (rawPath: unknown): Promise<string> => {
        if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
            throw new Error('Invalid export path: expected a non-empty string');
        }
        if (CONTROL_CHARS_RE.test(rawPath)) {
            throw new Error('Invalid export path: control characters are not allowed');
        }
        if (!path.isAbsolute(rawPath)) {
            throw new Error('Invalid export path: expected an absolute path');
        }

        const resolvedPath = path.resolve(rawPath);
        try {
            const stat = await fs.promises.stat(resolvedPath);
            if (stat.isDirectory()) {
                throw new Error('Invalid export path: target is a directory');
            }
        } catch (error: unknown) {
            if (!isMissingPathError(error)) {
                throw error;
            }
        }

        return resolvedPath;
    };

    const authorizeSavePath = async (rawPath: unknown): Promise<string> => {
        const resolvedPath = await validateSavePath(rawPath);
        allowedSavePaths.add(pathKey(resolvedPath));
        return resolvedPath;
    };

    const consumeSavePath = async (rawPath: unknown): Promise<string> => {
        const resolvedPath = await validateSavePath(rawPath);
        const key = pathKey(resolvedPath);
        if (!allowedSavePaths.has(key)) {
            throw new Error('Export path was not authorized by showSaveDialog');
        }
        allowedSavePaths.delete(key);
        return resolvedPath;
    };

    return {
        showSaveDialog: async (_event: unknown, options: SaveDialogOptions): Promise<string | null> => {
            const result = await dialog.showSaveDialog(getMainWindow(), options);
            if (result.canceled || !result.filePath) return null;
            await authorizeSavePath(result.filePath);
            return result.filePath;
        },

        writeFile: async (_event: unknown, payload: WriteFilePayload): Promise<void> => {
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid export payload');
            }
            const { filepath, content } = payload;
            if (typeof content !== 'string') {
                throw new Error('Invalid export content: expected a string');
            }
            const resolvedPath = await consumeSavePath(filepath);
            await fs.promises.writeFile(resolvedPath, content, 'utf-8');
        },

        toPDF: async (_event: unknown, payload: ToPdfPayload): Promise<void> => {
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid PDF export payload');
            }
            const { htmlContent, savePath } = payload;
            if (typeof htmlContent !== 'string') {
                throw new Error('Invalid PDF export content: expected a string');
            }

            const resolvedSavePath = await consumeSavePath(savePath);
            const tmpPath = path.join(app.getPath('temp'), 'minddiary_export_tmp.html');
            let win: BrowserWindowLike | null = null;

            try {
                await fs.promises.writeFile(tmpPath, htmlContent, 'utf-8');

                win = new BrowserWindow({
                    show: false,
                    width: 1000,
                    height: 1400,
                    webPreferences: createPrintWindowWebPreferences(),
                });

                const navigationHandler = createPrintWindowNavigationHandler(pathToFileURL(tmpPath).href);
                win.webContents.setWindowOpenHandler(createPrintWindowOpenHandler());
                win.webContents.on('will-navigate', navigationHandler);
                win.webContents.on('will-redirect', navigationHandler);

                await win.loadFile(tmpPath);

                const pdfBuffer = await win.webContents.printToPDF({
                    pageSize: 'A4',
                    printBackground: true,
                    margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
                });

                await fs.promises.writeFile(resolvedSavePath, pdfBuffer);
            } finally {
                if (win && !win.isDestroyed?.()) {
                    win.close();
                }
                await fs.promises.unlink(tmpPath).catch(() => { });
            }
        },
    };
}
