const { app, BrowserWindow, clipboard, ipcMain, Notification, dialog, session, protocol, net, shell } = require('electron');
const { logger } = require('./logger');
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) {}
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const db = require('./database');
const fileManager = require('./fileManager');
const aiService = require('./aiService');
const { createExportHandlers } = require('./exportHandlers');
const { getActiveAppInfo } = require('./focusGuard');
import { createAutoBackup } from './backup';
import { restoreAutoBackupFromZip } from './backupRestore';
import { resolveLocalProtocolPath } from './pathSecurity';
import {
    buildContentSecurityPolicy,
    describeUrlForLog,
    resolveRendererRuntimeMode,
    type NavigationPolicy,
    type RendererRuntimeMode,
} from './navigationSecurity';
import {
    createClipboardWriteHandler,
    createMainWindowWebPreferences,
    createNavigationHandler,
    createWindowOpenHandler,
    denyPermissionCheck,
    denyPermissionRequest,
} from './electronSecurity';
import { buildSafeSettingsPayload } from './settingsSecurity';
import { getAutoUpdateNotConfiguredStatus, isAutoUpdateConfigured } from './updaterConfig';
import { normalizeUpdaterReleaseNotes, preserveUpdaterReleaseDetails } from './updaterReleaseNotes';
import { runDateRolloverDiagnostic } from './dateRolloverDiagnostic';
import { createStudyTaskForCurrentDate } from './dateBoundTaskCreation';
import { getLocalDateKey } from '../src/utils/dateKey';
import {
    createFailedSmokeDiagnosticResult,
    parseSmokeDiagnosticRequest,
    prepareSmokeDiagnosticDatabase,
    runSmokeDiagnostic,
    validateSmokeRuntimeProfile,
    writeSmokeDiagnosticResult,
    type SmokeDiagnosticRequest,
} from './smokeDiagnostics';
import {
    validateAiMessagesPayload,
    validateAiSummaryPayload,
    validateBulkSubjectChaptersPayload,
    validateConvertSubjectChaptersPayload,
    validateCreateSubjectChapterPayload,
    validateDateKeyPayload,
    validateEntryCreatePayload,
    validateEntryUpdatePayload,
    validateMistakeReviewPayload,
    validateMistakeId,
    validateMistakeWritePayload,
    validatePomodoroSessionPayload,
    validatePositiveIdPayload,
    validateSubjectChapterCompletedPayload,
    validateSubjectChapterPatchPayload,
    validateSubjectChapterReorderPayload,
    validateStudyTaskCreatePayload,
    validateStudyTaskQueryPayload,
    validateStudyTaskUpdatePayload,
} from './ipcValidation';

import type {
    EntryFilters, Tag, Subject,
    Mistake, MistakeFilters,
    DiaryTemplate, AttachmentData, CountdownEvent, CountdownEventType,
    FocusWhitelistItem
} from '../src/types/index';

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
const APP_USER_MODEL_ID = 'com.minddiary.app';
let smokeDiagnosticRequest: SmokeDiagnosticRequest | null = null;
let smokeDiagnosticConfigurationFailed = false;
let smokeDiagnosticCurrentDateKey: string | null = null;

try {
    smokeDiagnosticRequest = parseSmokeDiagnosticRequest({ argv: process.argv, env: process.env });
} catch {
    smokeDiagnosticConfigurationFailed = true;
    process.stderr.write('[smoke-diagnostic] Invalid diagnostic configuration\n');
}

function getRendererRuntimeMode(): RendererRuntimeMode {
    return resolveRendererRuntimeMode(app.isPackaged, process.env.NODE_ENV);
}

function getAppDocumentPath(): string {
    return path.join(__dirname, '..', '..', 'dist', 'index.html');
}

function getMainNavigationPolicy(runtimeMode: RendererRuntimeMode): NavigationPolicy {
    return runtimeMode === 'development'
        ? { kind: 'development' }
        : { kind: 'production', appDocumentUrl: pathToFileURL(getAppDocumentPath()).href };
}

function configureWindowsAppUserModelId() {
    if (process.platform !== 'win32') return;
    app.setAppUserModelId(APP_USER_MODEL_ID);
}

function createWindow(runtimeMode: RendererRuntimeMode, options: { show?: boolean } = {}) {
    const isMac = process.platform === 'darwin';
    const preloadPath = path.join(__dirname, 'preload.js');
    const appDocumentPath = getAppDocumentPath();

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        // Windows: frameless with custom titlebar; macOS: native hidden inset
        frame: isMac,
        ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
        backgroundColor: '#0f0f14',
        show: options.show ?? true,
        webPreferences: createMainWindowWebPreferences(preloadPath),
        icon: path.join(__dirname, '..', '..', 'build', 'icon.png')
    });

    // Push maximize state changes to renderer for titlebar icon sync
    mainWindow.on('maximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:maximized-change', true);
    });
    mainWindow.on('unmaximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:maximized-change', false);
    });
    mainWindow.on('enter-full-screen', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:fullscreen-change', true);
    });
    mainWindow.on('leave-full-screen', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:fullscreen-change', false);
    });

    // Dev or production (E2E tests set NODE_ENV=production)
    const isDev = runtimeMode === 'development';
    const navigationPolicy = getMainNavigationPolicy(runtimeMode);
    const openExternal = (url: string) => shell.openExternal(url);
    const navigationHandler = createNavigationHandler({ policy: navigationPolicy, openExternal, logger });
    mainWindow.webContents.setWindowOpenHandler(createWindowOpenHandler({ openExternal, logger }));
    mainWindow.webContents.on('will-navigate', navigationHandler);
    mainWindow.webContents.on('will-redirect', navigationHandler);
    mainWindow.webContents.session.setPermissionRequestHandler(denyPermissionRequest);
    mainWindow.webContents.session.setPermissionCheckHandler(denyPermissionCheck);

    let rendererLoad: Promise<void>;
    if (isDev) {
        rendererLoad = mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        rendererLoad = mainWindow.loadFile(appDocumentPath);
    }
    return { window: mainWindow, rendererLoad };
}

function getCurrentTaskCreationDateKey(): string {
    if (smokeDiagnosticRequest?.scenario === 'date-rollover' && smokeDiagnosticCurrentDateKey) {
        return smokeDiagnosticCurrentDateKey;
    }
    return getLocalDateKey();
}

// ==================== Auto Updater ====================

let lastUpdaterStatus: Record<string, unknown> = { status: 'idle' }

/** Push updater status to renderer via webContents.send (matches window:maximized-change pattern). */
function pushUpdaterStatus(status: Record<string, unknown>) {
    lastUpdaterStatus = status
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:status', status);
    }
}

function getAppUpdateConfigPath(): string {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'app-update.yml')
        : path.join(app.getAppPath(), 'dev-app-update.yml');
}

function canUseAutoUpdater(): boolean {
    return !!autoUpdater && isAutoUpdateConfigured({
        isPackaged: app.isPackaged,
        appUpdateConfigPath: getAppUpdateConfigPath(),
        fsExists: fs.existsSync,
    });
}

function pushAutoUpdateNotConfigured(): { success: false; message: string; status: string } {
    const status = getAutoUpdateNotConfiguredStatus();
    logger.warn('[updater] Auto update source is not configured');
    pushUpdaterStatus(status);
    return { success: false, message: status.message, status: status.status };
}

function initAutoUpdater() {
    if (!autoUpdater) return;
    if (!canUseAutoUpdater()) {
        pushAutoUpdateNotConfigured();
        return;
    }

    autoUpdater.on('checking-for-update', () => {
        pushUpdaterStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: { version: string; releaseNotes?: unknown; releaseDate?: unknown }) => {
        pushUpdaterStatus({
            status: 'available',
            version: info.version,
            releaseNotes: normalizeUpdaterReleaseNotes(info.releaseNotes),
            releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined,
        });
    });

    autoUpdater.on('update-not-available', () => {
        pushUpdaterStatus({ status: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
        pushUpdaterStatus(preserveUpdaterReleaseDetails(lastUpdaterStatus, {
            status: 'downloading',
            percent: Math.round(progress.percent),
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total,
        }));
    });

    autoUpdater.on('update-downloaded', (info: { version: string }) => {
        pushUpdaterStatus(preserveUpdaterReleaseDetails(lastUpdaterStatus, {
            status: 'downloaded',
            version: info.version,
        }));
    });

    autoUpdater.on('error', (err: Error) => {
        pushUpdaterStatus({ status: 'error', message: err.message || String(err) });
    });

    // Silent check on startup (errors are pushed via the 'error' event)
    autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('updater:check', async () => {
    if (!autoUpdater) return { success: false, message: '环境不支持自动更新' };
    if (!canUseAutoUpdater()) return pushAutoUpdateNotConfigured();

    try {
        await autoUpdater.checkForUpdates();
        // Status transitions are pushed to renderer via autoUpdater events
        return { success: true };
    } catch (e: unknown) {
        logger.error('Update check failed:', e instanceof Error ? e.message : String(e));
        return { success: false, message: '检查更新失败: ' + (e instanceof Error ? e.message : String(e)) };
    }
});

ipcMain.handle('updater:install', () => {
    if (!autoUpdater) return;
    autoUpdater.quitAndInstall(false, true); // 强制重启应用，避免闪退感
});

ipcMain.handle('updater:getStatus', () => {
    return lastUpdaterStatus;
});

function configureRuntimeSecurity(runtimeMode: RendererRuntimeMode): void {
    protocol.handle('local', (request: { url: string }) => {
        try {
            const resolved = resolveLocalProtocolPath(request.url, app.getPath('userData'));
            return net.fetch(pathToFileURL(resolved).href);
        } catch (error) {
            logger.warn(
                '[local://] Blocked local asset request',
                describeUrlForLog(request.url),
                { errorType: error instanceof Error ? error.name : 'UnknownError' },
            );
            return new Response('Forbidden', { status: 403 });
        }
    });

    // Add Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details: { responseHeaders?: Record<string, string[]> }, callback: (headers: { responseHeaders?: Record<string, string[]> }) => void) => {
        const csp = buildContentSecurityPolicy(runtimeMode);
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [csp]
            }
        });
    });
}

function waitForWindowLoad(rendererLoad: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Diagnostic renderer load timed out')), 30_000);
        rendererLoad.then(() => {
            clearTimeout(timer);
            resolve();
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function verifyPortableWrapper(): boolean {
    if (process.platform !== 'win32') return false;
    const wrapperFile = process.env.PORTABLE_EXECUTABLE_FILE;
    const wrapperDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
    if (!wrapperFile || !wrapperDirectory || !path.isAbsolute(wrapperFile) || !path.isAbsolute(wrapperDirectory)) {
        return false;
    }
    if (path.resolve(path.dirname(wrapperFile)) !== path.resolve(wrapperDirectory)) return false;
    if (path.basename(wrapperFile) !== `MindDiary-Portable-${app.getVersion()}.exe`) return false;
    if (path.basename(process.execPath).toLowerCase() !== 'minddiary.exe') return false;
    try {
        const stat = fs.lstatSync(wrapperFile);
        return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
    } catch {
        return false;
    }
}

async function runPortableProfileRoundTrip(
    window: InstanceType<typeof BrowserWindow>,
): Promise<{ created: boolean; readBack: boolean; localProtocol: boolean; cleaned: boolean }> {
    return window.webContents.executeJavaScript(`(async () => {
        const probe = { created: false, readBack: false, localProtocol: false, cleaned: false };
        let entryId = 0;
        let attachmentId = 0;
        try {
            const entry = await globalThis.api.entries.create({
                date: '2099-12-31',
                title: 'MindDiary portable smoke',
                content: 'Disposable packaged profile probe',
                mood: null,
            });
            entryId = entry.id;
            probe.created = Number.isInteger(entryId) && entryId > 0;
            const attachment = await globalThis.api.attachments.save(entryId, {
                name: 'portable-smoke.png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                mimetype: 'image/png',
            });
            attachmentId = attachment.id;
            const readEntry = await globalThis.api.entries.getById(entryId);
            const attachments = await globalThis.api.attachments.getByEntry(entryId);
            probe.readBack = readEntry?.title === 'MindDiary portable smoke'
                && attachments.length === 1
                && attachments[0]?.id === attachmentId
                && attachments[0]?.filepath === attachment.filepath;
            const dimensions = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
                image.onerror = () => reject(new Error('local protocol probe failed'));
                image.src = 'local://attachments/' + encodeURIComponent(attachment.filepath);
            });
            probe.localProtocol = dimensions.width === 1 && dimensions.height === 1;
        } finally {
            if (attachmentId > 0) await globalThis.api.attachments.delete(attachmentId);
            if (entryId > 0) await globalThis.api.entries.delete(entryId);
            if (entryId > 0) {
                const remainingEntry = await globalThis.api.entries.getById(entryId);
                const remainingAttachments = await globalThis.api.attachments.getByEntry(entryId);
                probe.cleaned = remainingEntry == null && remainingAttachments.length === 0;
            }
        }
        return probe;
    })()`, true) as Promise<{ created: boolean; readBack: boolean; localProtocol: boolean; cleaned: boolean }>;
}

async function runInstallProfileRoundTrip(
    window: InstanceType<typeof BrowserWindow>,
): Promise<{
    phase: 'seeded' | 'reopened';
    created: boolean;
    retained: boolean;
    readBack: boolean;
    localProtocol: boolean;
    cleaned: boolean;
}> {
    return window.webContents.executeJavaScript(`(async () => {
        const probe = {
            phase: 'seeded',
            created: false,
            retained: false,
            readBack: false,
            localProtocol: false,
            cleaned: false,
        };
        const matches = (await globalThis.api.entries.getAll()).filter(entry =>
            entry.date === '2099-12-30' && entry.title === 'MindDiary install smoke');
        if (matches.length > 1) throw new Error('install profile contains duplicate probes');
        let entryId = 0;
        let attachmentId = 0;
        try {
            if (matches.length === 0) {
                const entry = await globalThis.api.entries.create({
                    date: '2099-12-30',
                    title: 'MindDiary install smoke',
                    content: 'Disposable installed profile retention probe',
                    mood: null,
                });
                entryId = entry.id;
                probe.created = Number.isInteger(entryId) && entryId > 0;
                const attachment = await globalThis.api.attachments.save(entryId, {
                    name: 'install-smoke.png',
                    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                    mimetype: 'image/png',
                });
                attachmentId = attachment.id;
            } else {
                probe.phase = 'reopened';
                entryId = matches[0].id;
                const existingAttachments = await globalThis.api.attachments.getByEntry(entryId);
                if (existingAttachments.length !== 1 || existingAttachments[0]?.filename !== 'install-smoke.png') {
                    throw new Error('install profile attachment probe is invalid');
                }
                attachmentId = existingAttachments[0].id;
            }

            const readEntry = await globalThis.api.entries.getById(entryId);
            const attachments = await globalThis.api.attachments.getByEntry(entryId);
            probe.readBack = readEntry?.content === 'Disposable installed profile retention probe'
                && attachments.length === 1
                && attachments[0]?.id === attachmentId
                && attachments[0]?.filename === 'install-smoke.png';
            probe.retained = probe.readBack;
            const attachment = attachments[0];
            if (!attachment) throw new Error('install profile attachment is unavailable');
            const dimensions = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
                image.onerror = () => reject(new Error('install profile local protocol probe failed'));
                image.src = 'local://attachments/' + encodeURIComponent(attachment.filepath);
            });
            probe.localProtocol = dimensions.width === 1 && dimensions.height === 1;

            if (probe.phase === 'reopened') {
                await globalThis.api.attachments.delete(attachmentId);
                await globalThis.api.entries.delete(entryId);
                const remainingEntry = await globalThis.api.entries.getById(entryId);
                const remainingAttachments = await globalThis.api.attachments.getByEntry(entryId);
                probe.cleaned = remainingEntry == null && remainingAttachments.length === 0;
            }
            return probe;
        } catch (error) {
            if (probe.phase === 'seeded') {
                if (attachmentId > 0) await globalThis.api.attachments.delete(attachmentId).catch(() => undefined);
                if (entryId > 0) await globalThis.api.entries.delete(entryId).catch(() => undefined);
            }
            throw error;
        }
    })()`, true) as Promise<{
        phase: 'seeded' | 'reopened';
        created: boolean;
        retained: boolean;
        readBack: boolean;
        localProtocol: boolean;
        cleaned: boolean;
    }>;
}

async function runConfiguredSmokeDiagnostic(
    request: SmokeDiagnosticRequest,
    runtimeMode: RendererRuntimeMode,
): Promise<void> {
    let window: InstanceType<typeof BrowserWindow> | null = null;
    const baseDependencies = {
        applicationVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? '',
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
    };
    try {
        const allowInitializedProfile = request.scenario === 'install-profile';
        validateSmokeRuntimeProfile(request, app.getPath('userData'), { allowInitializedProfile });
        prepareSmokeDiagnosticDatabase(request, { allowExisting: allowInitializedProfile });
        db.initialize();
        if (request.scenario === 'portable-profile' || request.scenario === 'install-profile') {
            fileManager.initialize();
        }
        const createdWindow = createWindow(runtimeMode, { show: false });
        window = createdWindow.window;
        await waitForWindowLoad(createdWindow.rendererLoad);
        const result = await runSmokeDiagnostic(request, {
            ...baseDependencies,
            actualUserDataPath: app.getPath('userData'),
            queryNativeSqlite: () => {
                const row = db.getDb().prepare('SELECT 1 AS query, sqlite_version() AS sqliteVersion').get() as {
                    query: number;
                    sqliteVersion: string;
                };
                return row;
            },
            getRendererSecurityState: async () => {
                const preferences = window.webContents.getLastWebPreferences();
                const preloadAvailable = await window.webContents.executeJavaScript(
                    "Boolean(globalThis.api?.entries && typeof globalThis.api.entries.getAll === 'function')",
                    true,
                ) as boolean;
                return {
                    sandbox: preferences.sandbox === true,
                    contextIsolation: preferences.contextIsolation === true,
                    preloadAvailable,
                    productionDocument: runtimeMode === 'production'
                        && window.webContents.getURL().startsWith('file:'),
                };
            },
            roundTripSetting: (key, value) => db.getDb().transaction(() => {
                const existing = db.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
                if (existing) throw new Error('Diagnostic setting key already exists');
                const write = db.getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
                const read = db.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as {
                    value?: unknown;
                } | undefined;
                db.getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
                const after = db.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
                return {
                    written: write.changes === 1,
                    readBack: read?.value === value,
                    cleaned: after === undefined,
                };
            })(),
            verifyPortableWrapper,
            runProfileRoundTrip: () => runPortableProfileRoundTrip(window),
            runInstallProfileRoundTrip: () => runInstallProfileRoundTrip(window),
            runDateRollover: () => runDateRolloverDiagnostic(
                window,
                db,
                dateKey => { smokeDiagnosticCurrentDateKey = dateKey; },
            ),
        });
        writeSmokeDiagnosticResult(request, result);
        window.destroy();
        app.exit(result.result === 'passed' ? 0 : 1);
    } catch {
        try {
            writeSmokeDiagnosticResult(request, createFailedSmokeDiagnosticResult(request, baseDependencies));
        } catch {
        }
        if (window && !window.isDestroyed()) window.destroy();
        process.stderr.write('[smoke-diagnostic] Diagnostic run failed\n');
        app.exit(1);
    }
}

app.whenReady().then(async () => {
    if (smokeDiagnosticConfigurationFailed) {
        app.exit(2);
        return;
    }

    const runtimeMode: RendererRuntimeMode = smokeDiagnosticRequest ? 'production' : getRendererRuntimeMode();

    if (process.platform === 'win32') {
        configureWindowsAppUserModelId();
    }

    configureRuntimeSecurity(runtimeMode);

    if (smokeDiagnosticRequest) {
        await runConfiguredSmokeDiagnostic(smokeDiagnosticRequest, runtimeMode);
        return;
    }
    db.initialize();
    fileManager.initialize();
    createWindow(runtimeMode);
    initAutoUpdater();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (smokeDiagnosticRequest || smokeDiagnosticConfigurationFailed) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow(getRendererRuntimeMode());
});

// ==================== Window Controls ====================
ipcMain.handle('clipboard:writeText', createClipboardWriteHandler({
    getMainWindow: () => mainWindow,
    getNavigationPolicy: () => getMainNavigationPolicy(getRendererRuntimeMode()),
    writeText: (text: string) => clipboard.writeText(text),
}));

ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.handle('window:isMaximized', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isMaximized();
});
ipcMain.handle('window:setFullScreen', (_event: unknown, fullScreen: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.setFullScreen(Boolean(fullScreen));
    return mainWindow.isFullScreen();
});
ipcMain.handle('window:isFullScreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isFullScreen();
});

// ==================== Entries ====================
ipcMain.handle('entries:create', (_: unknown, entry: unknown) => db.createEntry(validateEntryCreatePayload(entry)));
ipcMain.handle('entries:update', (_: unknown, id: unknown, entry: unknown) => {
    return db.updateEntry(
        validatePositiveIdPayload(id, 'entry id'),
        validateEntryUpdatePayload(entry),
    );
});
ipcMain.handle('entries:delete', async (_: unknown, id: number) => {
    // Phase 11.1 fix: physically remove attachment files BEFORE the SQL DELETE,
    // because ON DELETE CASCADE will kill the attachment *records* but NOT the disk files.
    await fileManager.deleteAttachmentsForEntry(id);
    return db.deleteEntry(id);
});

ipcMain.handle('entries:getByDate', (_: unknown, date: string) => db.getEntryByDate(date));
ipcMain.handle('entries:getById', (_: unknown, id: number) => db.getEntryById(id));
ipcMain.handle('entries:getAll', (_: unknown, filters: EntryFilters) => db.getAllEntries(filters));
ipcMain.handle('entries:search', (_: unknown, query: string) => db.searchEntries(query));
ipcMain.handle('entries:getDatesWithEntries', (_: unknown, yearMonth: string) => db.getDatesWithEntries(yearMonth));

// ==================== Tags ====================
ipcMain.handle('tags:getAll', () => db.getAllTags());
ipcMain.handle('tags:create', (_: unknown, tag: Partial<Tag>) => db.createTag(tag));
ipcMain.handle('tags:update', (_: unknown, id: number, tag: Partial<Tag>) => db.updateTag(id, tag));
ipcMain.handle('tags:delete', (_: unknown, id: number) => db.deleteTag(id));
ipcMain.handle('tags:setEntryTags', (_: unknown, entryId: number, tagIds: number[]) => db.setEntryTags(entryId, tagIds));
ipcMain.handle('tags:getEntryTags', (_: unknown, entryId: number) => db.getEntryTags(entryId));
ipcMain.handle('tags:getEntryTagsBatch', (_: unknown, entryIds: number[]) => db.getEntryTagsBatch(entryIds));

// ==================== Settings ====================

// ── IPC Parameter Whitelist (P3 Security Hardening) ──────────────────────────
// Only these keys may be read via settings:get. Unknown keys are rejected.
const SETTINGS_READ_WHITELIST: ReadonlySet<string> = new Set([
    'theme', 'examDate', 'dailyGoal', 'autoSave', 'notifications',
    'aiEndpoint', 'aiModel', 'aiVisionEnabled', 'pomodoroMinutes',
    'autoBackup', 'backupPath', 'pomodoroSound', 'pomodoroAlert',
    'countdownEvents', 'focusGuardEnabled', 'focusGuardIntervalSec', 'focusWhitelist',
]);

// Per-handler allowed patch keys and their expected JS types
const GENERAL_PATCH_SCHEMA: Record<string, string> = {
    examDate: 'string', theme: 'string', pomodoroMinutes: 'number',
    autoSave: 'boolean', pomodoroSound: 'boolean', pomodoroAlert: 'boolean',
    countdownEvents: 'object',
    focusGuardEnabled: 'boolean', focusGuardIntervalSec: 'number', focusWhitelist: 'object',
};
const AI_PATCH_SCHEMA: Record<string, string> = {
    aiEndpoint: 'string', aiModel: 'string', aiVisionEnabled: 'boolean',
    aiApiKey: 'string', clearAiApiKey: 'boolean',
};
const BACKUP_PATCH_SCHEMA: Record<string, string> = {
    autoBackup: 'boolean', backupPath: 'string',
};

/** Strip any keys not in `schema`; reject values whose typeof mismatches. */
function sanitizePatch<T extends Record<string, unknown>>(
    raw: unknown,
    schema: Record<string, string>,
): T {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid patch: expected an object');
    }
    const out: Record<string, unknown> = {};
    for (const [key, expectedType] of Object.entries(schema)) {
        if (key in (raw as Record<string, unknown>)) {
            const val = (raw as Record<string, unknown>)[key];
            if (val !== undefined && typeof val !== expectedType) {
                throw new Error(`Invalid type for "${key}": expected ${expectedType}, got ${typeof val}`);
            }
            out[key] = val;
        }
    }
    return out as T;
}

const COUNTDOWN_EVENT_TYPES: ReadonlySet<string> = new Set(['exam', 'holiday', 'deadline', 'custom']);

function isCountdownEventType(value: unknown): value is CountdownEventType {
    return typeof value === 'string' && COUNTDOWN_EVENT_TYPES.has(value);
}

function isCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function sanitizeCountdownEvents(rawEvents: unknown): CountdownEvent[] {
    if (!Array.isArray(rawEvents)) {
        throw new Error('Invalid countdownEvents: expected an array');
    }

    return rawEvents.map((rawEvent, index) => {
        if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
            throw new Error(`Invalid countdownEvents[${index}]: expected an object`);
        }

        const event = rawEvent as Record<string, unknown>;
        const id = typeof event.id === 'string' ? event.id.trim() : '';
        const title = typeof event.title === 'string' ? event.title.trim() : '';
        const date = typeof event.date === 'string' ? event.date.trim() : '';
        if (!id || !title || !isCalendarDate(date)) {
            throw new Error(`Invalid countdownEvents[${index}]: id, title, and YYYY-MM-DD date are required`);
        }

        return {
            id,
            title,
            date,
            ...(isCountdownEventType(event.type) ? { type: event.type } : { type: 'custom' as const }),
            ...(typeof event.pinned === 'boolean' ? { pinned: event.pinned } : {}),
            ...(typeof event.archived === 'boolean' ? { archived: event.archived } : {}),
        };
    });
}

function parseStoredCountdownEvents(value: unknown): CountdownEvent[] | undefined {
    if (Array.isArray(value)) return sanitizeCountdownEvents(value);
    if (typeof value !== 'string' || !value.trim()) return undefined;

    try {
        const parsed: unknown = JSON.parse(value);
        return sanitizeCountdownEvents(parsed);
    } catch {
        logger.warn('[settings:getAll] Ignored invalid countdownEvents payload');
        return undefined;
    }
}

const FOCUS_WHITELIST_MAX_ITEMS = 100;
const FOCUS_WHITELIST_MAX_TEXT = 160;

function sanitizeFocusGuardIntervalSec(value: number): number {
    if (!Number.isFinite(value)) {
        throw new Error('Invalid focusGuardIntervalSec: expected a finite number');
    }
    return Math.max(3, Math.min(30, Math.round(value)));
}

function sanitizeText(value: unknown, field: string, required = false): string | undefined {
    if (value === undefined || value === null) {
        if (required) throw new Error(`Invalid focusWhitelist item: ${field} is required`);
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`Invalid focusWhitelist item: ${field} must be a string`);
    }
    const trimmed = value.trim().slice(0, FOCUS_WHITELIST_MAX_TEXT);
    if (!trimmed && required) throw new Error(`Invalid focusWhitelist item: ${field} is required`);
    return trimmed || undefined;
}

function basenameOnly(value: string): string {
    const normalized = value.replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).pop() || value;
}

function sanitizeFocusWhitelist(raw: unknown): FocusWhitelistItem[] {
    if (!Array.isArray(raw)) {
        throw new Error('Invalid focusWhitelist: expected an array');
    }
    if (raw.length > FOCUS_WHITELIST_MAX_ITEMS) {
        throw new Error(`Invalid focusWhitelist: maximum ${FOCUS_WHITELIST_MAX_ITEMS} items`);
    }

    return raw.map((rawItem, index) => {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
            throw new Error(`Invalid focusWhitelist[${index}]: expected an object`);
        }
        const item = rawItem as Record<string, unknown>;
        if (typeof item.enabled !== 'boolean') {
            throw new Error(`Invalid focusWhitelist[${index}].enabled: expected boolean`);
        }

        const id = sanitizeText(item.id, 'id', true)!;
        const name = sanitizeText(item.name, 'name', true)!;
        const processName = sanitizeText(item.processName, 'processName');
        const executable = sanitizeText(item.executable, 'executable');
        const createdAt = sanitizeText(item.createdAt, 'createdAt', true)!;

        return {
            id,
            name,
            ...(processName ? { processName } : {}),
            ...(executable ? { executable: basenameOnly(executable) } : {}),
            enabled: item.enabled,
            createdAt,
        };
    });
}

function parseStoredFocusWhitelist(value: unknown): FocusWhitelistItem[] | undefined {
    if (Array.isArray(value)) return sanitizeFocusWhitelist(value);
    if (typeof value !== 'string' || !value.trim()) return undefined;

    try {
        const parsed: unknown = JSON.parse(value);
        return sanitizeFocusWhitelist(parsed);
    } catch {
        logger.warn('[settings:getAll] Ignored invalid focusWhitelist payload');
        return undefined;
    }
}

// Single-key getter — refuses sensitive keys AND unknown keys
ipcMain.handle('settings:get', (_: unknown, key: string) => {
    if (typeof key !== 'string' || !SETTINGS_READ_WHITELIST.has(key)) {
        logger.warn('[settings:get] Rejected non-whitelisted key:', key);
        return null;
    }
    return db.getSetting(key);
});

// Returns all settings but replaces aiApiKey with masked status
ipcMain.handle('settings:getAll', () => {
    const all = db.getAllSettings();
    const safe = buildSafeSettingsPayload(all, db.getAiApiKey());
    for (const [k, v] of Object.entries(safe)) {
        if (k === 'countdownEvents') {
            safe[k] = parseStoredCountdownEvents(v);
        } else if (k === 'focusWhitelist') {
            safe[k] = parseStoredFocusWhitelist(v) || [];
        }
    }
    return safe;
});

// Patch-based setters — whitelist-sanitized, never accept a full-settings overwrite
ipcMain.handle('settings:updateGeneral', (_: unknown, rawPatch: unknown) => {
    const patch = sanitizePatch<{
        examDate?: string; theme?: string; pomodoroMinutes?: number;
        autoSave?: boolean; pomodoroSound?: boolean; pomodoroAlert?: boolean;
        countdownEvents?: CountdownEvent[];
        focusGuardEnabled?: boolean; focusGuardIntervalSec?: number; focusWhitelist?: FocusWhitelistItem[];
    }>(rawPatch, GENERAL_PATCH_SCHEMA);
    const countdownEvents = patch.countdownEvents === undefined
        ? undefined
        : sanitizeCountdownEvents(patch.countdownEvents);
    const focusWhitelist = patch.focusWhitelist === undefined
        ? undefined
        : sanitizeFocusWhitelist(patch.focusWhitelist);
    const focusGuardIntervalSec = patch.focusGuardIntervalSec === undefined
        ? undefined
        : sanitizeFocusGuardIntervalSec(patch.focusGuardIntervalSec);
    const txn = db.getDb().transaction(() => {
        if (patch.examDate !== undefined) db.setSetting('examDate', patch.examDate);
        if (patch.theme !== undefined) db.setSetting('theme', patch.theme);
        if (patch.pomodoroMinutes !== undefined) db.setSetting('pomodoroMinutes', String(patch.pomodoroMinutes));
        if (patch.autoSave !== undefined) db.setSetting('autoSave', String(patch.autoSave));
        if (patch.pomodoroSound !== undefined) db.setSetting('pomodoroSound', String(patch.pomodoroSound));
        if (patch.pomodoroAlert !== undefined) db.setSetting('pomodoroAlert', String(patch.pomodoroAlert));
        if (countdownEvents !== undefined) db.setSetting('countdownEvents', JSON.stringify(countdownEvents));
        if (patch.focusGuardEnabled !== undefined) db.setSetting('focusGuardEnabled', String(patch.focusGuardEnabled));
        if (focusGuardIntervalSec !== undefined) db.setSetting('focusGuardIntervalSec', String(focusGuardIntervalSec));
        if (focusWhitelist !== undefined) db.setSetting('focusWhitelist', JSON.stringify(focusWhitelist));
    });
    txn();
    return { success: true };
});

ipcMain.handle('settings:updateAI', (_: unknown, rawPatch: unknown) => {
    const patch = sanitizePatch<{
        aiEndpoint?: string; aiModel?: string;
        aiVisionEnabled?: boolean;
        aiApiKey?: string; clearAiApiKey?: boolean;
    }>(rawPatch, AI_PATCH_SCHEMA);
    if (patch.aiApiKey !== undefined && patch.clearAiApiKey) {
        throw new Error('Cannot set and clear AI key simultaneously');
    }
    if (patch.aiApiKey === '') {
        throw new Error('Empty string is not a valid API key');
    }
    const txn = db.getDb().transaction(() => {
        if (patch.clearAiApiKey) {
            db.setAiApiKey('');
        } else if (patch.aiApiKey !== undefined) {
            db.setAiApiKey(patch.aiApiKey);
        }
        if (patch.aiEndpoint !== undefined) db.setSetting('aiEndpoint', patch.aiEndpoint);
        if (patch.aiModel !== undefined) db.setSetting('aiModel', patch.aiModel);
        if (patch.aiVisionEnabled !== undefined) db.setSetting('aiVisionEnabled', String(patch.aiVisionEnabled));
    });
    txn();
    return { success: true };
});

ipcMain.handle('settings:updateBackup', (_: unknown, rawPatch: unknown) => {
    const patch = sanitizePatch<{
        autoBackup?: boolean; backupPath?: string;
    }>(rawPatch, BACKUP_PATCH_SCHEMA);
    const txn = db.getDb().transaction(() => {
        if (patch.autoBackup !== undefined) db.setSetting('autoBackup', String(patch.autoBackup));
        if (patch.backupPath !== undefined) db.setSetting('backupPath', patch.backupPath);
    });
    txn();
    return { success: true };
});

// ==================== Attachments ====================
ipcMain.handle('attachments:save', (_: unknown, entryId: number, fileData: AttachmentData) => {
    return fileManager.saveAttachment(entryId, fileData);
});
ipcMain.handle('attachments:getByEntry', (_: unknown, entryId: number) => db.getAttachmentsByEntry(entryId));
ipcMain.handle('attachments:getByEntries', (_: unknown, entryIds: number[]) => db.getAttachmentsByEntries(entryIds));
ipcMain.handle('attachments:delete', (_: unknown, id: number) => fileManager.deleteAttachment(id));
ipcMain.handle('attachments:getPath', (_: unknown, filepath: string) => fileManager.getAttachmentPath(filepath));

// ==================== Subjects ====================
ipcMain.handle('subjects:getAll', () => db.getAllSubjects());
ipcMain.handle('subjects:create', (_: unknown, subject: Partial<Subject>) => db.createSubject(subject));
ipcMain.handle('subjects:update', (_: unknown, id: number, subject: Partial<Subject>) => db.updateSubject(id, subject));
ipcMain.handle('subjects:delete', (_: unknown, id: number) => db.deleteSubject(id));

// ==================== Subject Chapters ====================
ipcMain.handle('subjectChapters:getBySubject', (_: unknown, subjectId: unknown) => {
    return db.getSubjectChapters(validatePositiveIdPayload(subjectId, 'subject id'));
});
ipcMain.handle('subjectChapters:create', (_: unknown, chapter: unknown) => {
    return db.createSubjectChapter(validateCreateSubjectChapterPayload(chapter));
});
ipcMain.handle('subjectChapters:bulkCreate', (_: unknown, input: unknown) => {
    return db.bulkCreateSubjectChapters(validateBulkSubjectChaptersPayload(input));
});
ipcMain.handle('subjectChapters:convertFromSummary', (_: unknown, input: unknown) => {
    return db.convertSubjectToDetailedChapters(validateConvertSubjectChaptersPayload(input));
});
ipcMain.handle('subjectChapters:patch', (_: unknown, id: unknown, patch: unknown) => {
    return db.patchSubjectChapter(
        validatePositiveIdPayload(id, 'chapter id'),
        validateSubjectChapterPatchPayload(patch),
    );
});
ipcMain.handle('subjectChapters:toggleCompleted', (_: unknown, id: unknown, completed: unknown) => {
    return db.toggleSubjectChapterCompleted(
        validatePositiveIdPayload(id, 'chapter id'),
        validateSubjectChapterCompletedPayload(completed),
    );
});
ipcMain.handle('subjectChapters:reorder', (_: unknown, subjectId: unknown, chapterIds: unknown) => {
    return db.reorderSubjectChapters(
        validatePositiveIdPayload(subjectId, 'subject id'),
        validateSubjectChapterReorderPayload(chapterIds),
    );
});
ipcMain.handle('subjectChapters:delete', (_: unknown, id: unknown) => {
    return db.deleteSubjectChapter(validatePositiveIdPayload(id, 'chapter id'));
});
ipcMain.handle('subjectChapters:clearDetailed', (_: unknown, subjectId: unknown) => {
    return db.clearDetailedSubjectChapters(validatePositiveIdPayload(subjectId, 'subject id'));
});

// ==================== Pomodoro ====================
ipcMain.handle('pomodoro:addSession', (_: unknown, session: unknown) => {
    return db.addPomodoroSession(validatePomodoroSessionPayload(session));
});
ipcMain.handle('pomodoro:getStats', (_: unknown, date: string) => db.getPomodoroStats(date));
ipcMain.handle('pomodoro:getStatsRange', (_: unknown, start: string, end: string) => db.getPomodoroStatsRange(start, end));
ipcMain.handle('pomodoro:getDailyTotal', (_: unknown, date: string) => db.getDailyStudyMinutes(date));
ipcMain.handle('pomodoro:getRange', (_: unknown, start: string, end: string) => db.getPomodoroRange(start, end));

// ==================== Study Tasks ====================
ipcMain.handle('tasks:getByDate', (_: unknown, date: string) => db.getStudyTasksByDate(date));
ipcMain.handle('tasks:find', (_: unknown, query: unknown) => db.findStudyTasks(validateStudyTaskQueryPayload(query)));
ipcMain.handle('tasks:create', (_: unknown, task: unknown) => db.createStudyTask(validateStudyTaskCreatePayload(task)));
ipcMain.handle('tasks:createForCurrentDate', (_: unknown, task: unknown, expectedCurrentDate: unknown) => (
    createStudyTaskForCurrentDate(task, expectedCurrentDate, {
        getCurrentDateKey: getCurrentTaskCreationDateKey,
        createTask: db.createStudyTask,
        runInTransaction: operation => db.getDb().transaction(operation)(),
    })
));
ipcMain.handle('tasks:update', (_: unknown, id: unknown, patch: unknown) => {
    return db.updateStudyTask(
        validatePositiveIdPayload(id, 'task id'),
        validateStudyTaskUpdatePayload(patch),
    );
});
ipcMain.handle('tasks:delete', (_: unknown, id: unknown) => db.deleteStudyTask(validatePositiveIdPayload(id, 'task id')));
ipcMain.handle('tasks:complete', (_: unknown, id: unknown) => db.completeStudyTask(validatePositiveIdPayload(id, 'task id')));
ipcMain.handle('tasks:skip', (_: unknown, id: unknown) => db.skipStudyTask(validatePositiveIdPayload(id, 'task id')));
ipcMain.handle('tasks:startFocus', (_: unknown, id: unknown, date: unknown) => {
    return db.startStudyTaskFocus(
        validatePositiveIdPayload(id, 'task id'),
        validateDateKeyPayload(date, 'task planned_date'),
    );
});

// ==================== Focus Guard ====================
ipcMain.handle('focusGuard:getActiveApp', async () => {
    try {
        return await getActiveAppInfo();
    } catch (error) {
        console.error('[focusGuard][ipc] getActiveApp failed', {
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
});

// ==================== Dashboard ====================
ipcMain.handle('dashboard:entryDatesRange', (_: unknown, start: string, end: string) => db.getEntryDatesRange(start, end));
ipcMain.handle('dashboard:streak', () => db.getStudyStreak());

// ==================== Today Dashboard (V3.0) ====================
ipcMain.handle('todayDashboard:getData', (_: unknown, date: string) => {
    try {
        return db.getTodayDashboard(date);
    } catch (e: unknown) {
        logger.error('todayDashboard:getData failed:', e instanceof Error ? e.message : String(e));
        throw e;
    }
});

// ==================== Mistakes ====================
ipcMain.handle('mistakes:getAll', (_: unknown, filters: MistakeFilters) => db.getAllMistakes(filters));
ipcMain.handle('mistakes:create', (_: unknown, mistake: unknown) => db.createMistake(validateMistakeWritePayload(mistake)));
ipcMain.handle('mistakes:update', (_: unknown, id: unknown, mistake: unknown) => (
    db.updateMistake(validateMistakeId(id), validateMistakeWritePayload(mistake))
));
ipcMain.handle('mistakes:delete', (_: unknown, id: unknown) => db.deleteMistake(validateMistakeId(id)));
ipcMain.handle('mistakes:toggleMastered', (_: unknown, id: unknown) => db.toggleMistakeMastered(validateMistakeId(id)));
ipcMain.handle('mistakes:review', (_: unknown, id: unknown, data: unknown) => {
    const validated = validateMistakeReviewPayload(id, data);
    return db.reviewMistake(validated.id, validated.data);
});
ipcMain.handle('mistakes:getDueCount', (_: unknown, date: string) => db.getDueForReviewCount(date));
ipcMain.handle('mistakes:getRandomDue', (_: unknown, date: string, subjectId?: number) => db.getRandomDueMistake(date, subjectId));
ipcMain.handle('mistakes:saveImage', (_: unknown, data: AttachmentData & { ext?: string }) => {
    return fileManager.saveMistakeImage(data);
});
ipcMain.handle('mistakes:deleteImage', async (_: unknown, filename: string) => {
    await db.discardUnreferencedMistakeImage(filename);
});
ipcMain.handle('mistakes:getImagePath', (_: unknown, filename: string) => fileManager.getMistakeImagePath(filename));

// ==================== AI ====================
ipcMain.handle('ai:chat', (_: unknown, messages: unknown) => aiService.chat(validateAiMessagesPayload(messages)));
ipcMain.handle('ai:summarize', (_: unknown, content: unknown) => aiService.summarize(validateAiSummaryPayload(content)));

// ==================== Notifications ====================
ipcMain.handle('notification:show', (_: unknown, title: string, body: string) => {
    const supported = Notification.isSupported();
    if (!supported) {
        throw new Error('System notifications are not supported on this device');
    }
    const notification = new Notification({ title, body });
    notification.on('show', () => {
        console.info('[notification][ipc] show event', {
            title,
            body,
            timestamp: new Date().toISOString(),
        });
    });
    notification.on('failed', (_event: unknown, error: unknown) => {
        console.error('[notification][ipc] failed event', {
            title,
            body,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
        });
    });
    notification.show();
});

// ==================== Templates ====================
ipcMain.handle('templates:getAll', () => db.getAllTemplates());
ipcMain.handle('templates:create', (_: unknown, template: Partial<DiaryTemplate>) => db.createTemplate(template));
ipcMain.handle('templates:update', (_: unknown, id: number, template: Partial<DiaryTemplate>) => db.updateTemplate(id, template));
ipcMain.handle('templates:delete', (_: unknown, id: number) => db.deleteTemplate(id));

// ==================== Export ====================

const exportHandlers = createExportHandlers({
    app,
    BrowserWindow,
    dialog,
    fs,
    path,
    getMainWindow: () => mainWindow,
});

/** Export paths must be authorized by showSaveDialog and consumed on first write. */
ipcMain.handle('export:showSaveDialog', exportHandlers.showSaveDialog);
ipcMain.handle('export:writeFile', exportHandlers.writeFile);
ipcMain.handle('export:toPDF', exportHandlers.toPDF);

// ==================== Auto Backup ====================

const allowedBackupRestorePaths = new Set<string>();

function normalizeBackupZipPath(filepath: unknown): string {
    if (typeof filepath !== 'string' || filepath.trim().length === 0) {
        throw new Error('Invalid backup path');
    }
    if (filepath.includes('\0')) {
        throw new Error('Invalid backup path');
    }
    const resolved = path.resolve(filepath);
    if (!path.isAbsolute(resolved)) {
        throw new Error('Backup path must be absolute');
    }
    if (path.extname(resolved).toLowerCase() !== '.zip') {
        throw new Error('Backup path must be a .zip file');
    }
    return resolved;
}

const runAutoBackup = async () => {
    try {
        const autoBackup = db.getSetting('autoBackup');
        const backupPath = db.getSetting('backupPath');
        if (String(autoBackup) !== 'true' || !backupPath) return;

        await createAutoBackup({
            backupPath,
            userDataPath: app.getPath('userData'),
            appVersion: app.getVersion(),
            schemaVersion: db.CURRENT_SCHEMA_VERSION,
            keep: 7,
            logger,
            data: db.exportBackupData(),
        });
    } catch (e: unknown) {
        logger.error('Auto backup failed:', e instanceof Error ? e.message : String(e));
    }
};

const scheduleNextBackup = () => {
	    const now = Date.now();
	    const next = new Date();
	    next.setHours(24, 0, 0, 0); // next midnight
	    const msUntilMidnight = next.getTime() - now;
	    // If we just missed midnight by a few seconds, push to next day
	    const delay = msUntilMidnight > 1000 ? msUntilMidnight : msUntilMidnight + 24 * 60 * 60 * 1000;
	    setTimeout(() => { runAutoBackup(); scheduleNextBackup(); }, delay);
	};
	setTimeout(() => { runAutoBackup(); scheduleNextBackup(); }, 10000);

ipcMain.handle('settings:selectBackupFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择自动备份目录',
        buttonLabel: '选择',
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('settings:selectBackupFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: 'Select automatic backup ZIP',
        buttonLabel: 'Select',
        filters: [{ name: 'MindDiary automatic backup', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = normalizeBackupZipPath(result.filePaths[0]);
    allowedBackupRestorePaths.add(selected);
    return selected;
});

ipcMain.handle('settings:restoreBackupFromZip', async (_event: unknown, filepath: unknown) => {
    try {
        const zipPath = normalizeBackupZipPath(filepath);
        if (!allowedBackupRestorePaths.has(zipPath)) {
            throw new Error('Backup ZIP must be selected before restore');
        }
        allowedBackupRestorePaths.delete(zipPath);
        const result = await restoreAutoBackupFromZip({
            zipPath,
            userDataPath: app.getPath('userData'),
            currentSchemaVersion: db.CURRENT_SCHEMA_VERSION,
            restoreDatabase: (data) => db.restoreBackupData(data),
            logger,
        });
        return { success: true, manifest: result.manifest };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[backup-restore] Restore failed:', message);
        return { success: false, message };
    }
});
