const { app, BrowserWindow, ipcMain, Notification, dialog, session, protocol, net } = require('electron');
const { logger } = require('./logger');
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) {}
const path = require('path');
const fs = require('fs');
const db = require('./database');
const fileManager = require('./fileManager');
const aiService = require('./aiService');
const { createExportHandlers } = require('./exportHandlers');

import type {
    NewEntry, EntryFilters, Tag, Subject,
    PomodoroSession, Mistake, MistakeFilters,
    DiaryTemplate, AIMessage, AttachmentData, CountdownEvent, CountdownEventType
} from '../src/types/index';

// Keys that must never appear in exported/backup files (mirrors src/utils/sanitize.js)
const SENSITIVE_SETTINGS_KEYS = ['aiApiKey'];

// ── API Key safety ──────────────────────────────────────────────────────────
function maskApiKey(key: string | null | undefined): string | null {
    if (!key) return null;
    if (key.length <= 8) return '********';
    return key.slice(0, 3) + '***' + key.slice(-4);
}

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;

function createWindow() {
    const isMac = process.platform === 'darwin';

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        // Windows: frameless with custom titlebar; macOS: native hidden inset
        frame: isMac,
        ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
        backgroundColor: '#0f0f14',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '..', '..', 'build', 'icon.png')
    });

    // Push maximize state changes to renderer for titlebar icon sync
    mainWindow.on('maximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:maximized-change', true);
    });
    mainWindow.on('unmaximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:maximized-change', false);
    });

    // Dev or production (E2E tests set NODE_ENV=production)
    const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
    }
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

function initAutoUpdater() {
    if (!autoUpdater) return;

    autoUpdater.on('checking-for-update', () => {
        pushUpdaterStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: { version: string; releaseNotes?: unknown }) => {
        pushUpdaterStatus({
            status: 'available',
            version: info.version,
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        });
    });

    autoUpdater.on('update-not-available', () => {
        pushUpdaterStatus({ status: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
        pushUpdaterStatus({
            status: 'downloading',
            percent: Math.round(progress.percent),
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total,
        });
    });

    autoUpdater.on('update-downloaded', (info: { version: string }) => {
        pushUpdaterStatus({ status: 'downloaded', version: info.version });
    });

    autoUpdater.on('error', (err: Error) => {
        pushUpdaterStatus({ status: 'error', message: err.message || String(err) });
    });

    // Silent check on startup (errors are pushed via the 'error' event)
    autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('updater:check', async () => {
    if (!autoUpdater) return { success: false, message: '环境不支持自动更新' };

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

app.whenReady().then(() => {
    protocol.handle('local', (request: { url: string }) => {
        const url = request.url.replace('local://', '');
        try {
            const decoded = decodeURIComponent(url);
            // Reject null bytes and non-printable control chars (except space)
            if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) {
                logger.warn('[local://] Rejected path with control characters');
                return new Response('Forbidden', { status: 403 });
            }
            const resolved = path.resolve(decoded);
            // Restrict local:// to userData directory (attachments & mistake_images)
            const allowedBase = path.resolve(app.getPath('userData'));
            const relative = path.relative(allowedBase, resolved);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                logger.warn('[local://] Blocked access outside userData:', resolved);
                return new Response('Forbidden', { status: 403 });
            }
            return net.fetch('file://' + resolved);
        } catch (error) {
            logger.error('File protocol parse error:', error);
            return new Response('Not Found', { status: 404 });
        }
    });

    // Add Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details: { responseHeaders?: Record<string, string[]> }, callback: (headers: { responseHeaders?: Record<string, string[]> }) => void) => {
        const isDev = !app.isPackaged;
        // In development, Vite injects inline scripts; allow 'unsafe-inline'
        // only for script-src in dev mode.  In production, lock down everything.
        const scriptSrc = isDev
            ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
            : "script-src 'self'";
        // P0-2: AI requests go through main-process IPC — renderer never needs
        // direct external fetch. Keep dev loose for HMR; lock production to self.
        const connectSrc = isDev
            ? "connect-src 'self' https://*"
            : "connect-src 'self'";
        const csp = [
            "default-src 'self'",
            scriptSrc,
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",   // CSS-in-JS components need this
            "img-src 'self' data: file: local: blob:",
            connectSrc,
            "font-src 'self' data: https://fonts.gstatic.com",
            "object-src 'none'",
            "base-uri 'self'",
        ].join('; ');
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [csp]
            }
        });
    });

    db.initialize();
    fileManager.initialize();
    createWindow();
    initAutoUpdater();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ==================== Window Controls ====================
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

// ==================== Entries ====================
ipcMain.handle('entries:create', (_: unknown, entry: NewEntry) => db.createEntry(entry));
ipcMain.handle('entries:update', (_: unknown, id: number, entry: Partial<NewEntry>) => db.updateEntry(id, entry));
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

// ==================== Settings ====================

// ── IPC Parameter Whitelist (P3 Security Hardening) ──────────────────────────
// Only these keys may be read via settings:get. Unknown keys are rejected.
const SETTINGS_READ_WHITELIST: ReadonlySet<string> = new Set([
    'theme', 'examDate', 'dailyGoal', 'autoSave', 'notifications',
    'aiEndpoint', 'aiModel', 'pomodoroMinutes',
    'autoBackup', 'backupPath', 'pomodoroSound', 'pomodoroAlert',
    'countdownEvents',
]);

// Per-handler allowed patch keys and their expected JS types
const GENERAL_PATCH_SCHEMA: Record<string, string> = {
    examDate: 'string', theme: 'string', pomodoroMinutes: 'number',
    autoSave: 'boolean', pomodoroSound: 'boolean', pomodoroAlert: 'boolean',
    countdownEvents: 'object',
};
const AI_PATCH_SCHEMA: Record<string, string> = {
    aiEndpoint: 'string', aiModel: 'string',
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
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(all)) {
        if (SENSITIVE_SETTINGS_KEYS.includes(k)) continue;
        safe[k] = k === 'countdownEvents' ? parseStoredCountdownEvents(v) : v;
    }
    const storedKey = db.getAiApiKey();
    safe['aiApiKeyMasked'] = maskApiKey(storedKey);
    safe['aiApiKeyPresent'] = !!storedKey;
    return safe;
});

// Patch-based setters — whitelist-sanitized, never accept a full-settings overwrite
ipcMain.handle('settings:updateGeneral', (_: unknown, rawPatch: unknown) => {
    const patch = sanitizePatch<{
        examDate?: string; theme?: string; pomodoroMinutes?: number;
        autoSave?: boolean; pomodoroSound?: boolean; pomodoroAlert?: boolean;
        countdownEvents?: CountdownEvent[];
    }>(rawPatch, GENERAL_PATCH_SCHEMA);
    const countdownEvents = patch.countdownEvents === undefined
        ? undefined
        : sanitizeCountdownEvents(patch.countdownEvents);
    const txn = db.getDb().transaction(() => {
        if (patch.examDate !== undefined) db.setSetting('examDate', patch.examDate);
        if (patch.theme !== undefined) db.setSetting('theme', patch.theme);
        if (patch.pomodoroMinutes !== undefined) db.setSetting('pomodoroMinutes', String(patch.pomodoroMinutes));
        if (patch.autoSave !== undefined) db.setSetting('autoSave', String(patch.autoSave));
        if (patch.pomodoroSound !== undefined) db.setSetting('pomodoroSound', String(patch.pomodoroSound));
        if (patch.pomodoroAlert !== undefined) db.setSetting('pomodoroAlert', String(patch.pomodoroAlert));
        if (countdownEvents !== undefined) db.setSetting('countdownEvents', JSON.stringify(countdownEvents));
    });
    txn();
    return { success: true };
});

ipcMain.handle('settings:updateAI', (_: unknown, rawPatch: unknown) => {
    const patch = sanitizePatch<{
        aiEndpoint?: string; aiModel?: string;
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
ipcMain.handle('attachments:save', (_: unknown, entryId: number, fileData: AttachmentData) => fileManager.saveAttachment(entryId, fileData));
ipcMain.handle('attachments:getByEntry', (_: unknown, entryId: number) => db.getAttachmentsByEntry(entryId));
ipcMain.handle('attachments:delete', (_: unknown, id: number) => fileManager.deleteAttachment(id));
ipcMain.handle('attachments:getPath', (_: unknown, filepath: string) => fileManager.getAttachmentPath(filepath));

// ==================== Subjects ====================
ipcMain.handle('subjects:getAll', () => db.getAllSubjects());
ipcMain.handle('subjects:create', (_: unknown, subject: Partial<Subject>) => db.createSubject(subject));
ipcMain.handle('subjects:update', (_: unknown, id: number, subject: Partial<Subject>) => db.updateSubject(id, subject));
ipcMain.handle('subjects:delete', (_: unknown, id: number) => db.deleteSubject(id));

// ==================== Pomodoro ====================
ipcMain.handle('pomodoro:addSession', (_: unknown, session: PomodoroSession) => db.addPomodoroSession(session));
ipcMain.handle('pomodoro:getStats', (_: unknown, date: string) => db.getPomodoroStats(date));
ipcMain.handle('pomodoro:getDailyTotal', (_: unknown, date: string) => db.getDailyStudyMinutes(date));
ipcMain.handle('pomodoro:getRange', (_: unknown, start: string, end: string) => db.getPomodoroRange(start, end));

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
ipcMain.handle('mistakes:create', (_: unknown, mistake: Partial<Mistake>) => db.createMistake(mistake));
ipcMain.handle('mistakes:update', (_: unknown, id: number, mistake: Partial<Mistake>) => db.updateMistake(id, mistake));
ipcMain.handle('mistakes:delete', (_: unknown, id: number) => db.deleteMistake(id));
ipcMain.handle('mistakes:toggleMastered', (_: unknown, id: number) => db.toggleMistakeMastered(id));
ipcMain.handle('mistakes:review', (_: unknown, id: number, data: Partial<Mistake>) => db.reviewMistake(id, data));
ipcMain.handle('mistakes:getDueCount', (_: unknown, date: string) => db.getDueForReviewCount(date));
ipcMain.handle('mistakes:getRandomDue', (_: unknown, date: string, subjectId?: number) => db.getRandomDueMistake(date, subjectId));
ipcMain.handle('mistakes:saveImage', (_: unknown, data: AttachmentData) => fileManager.saveMistakeImage(data));
ipcMain.handle('mistakes:getImagePath', (_: unknown, filename: string) => fileManager.getMistakeImagePath(filename));

// ==================== AI ====================
ipcMain.handle('ai:chat', (_: unknown, messages: AIMessage[]) => aiService.chat(messages));
ipcMain.handle('ai:summarize', (_: unknown, content: string) => aiService.summarize(content));

// ==================== Notifications ====================
ipcMain.handle('notification:show', (_: unknown, title: string, body: string) => {
    new Notification({ title, body }).show();
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

const runAutoBackup = async () => {
    try {
        const autoBackup = db.getSetting('autoBackup');
        const backupPath = db.getSetting('backupPath');
        if (String(autoBackup) !== 'true' || !backupPath) return;

        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }

        const entries = db.getAllEntries({ includeContent: true });
        const tags = db.getAllTags();
        const subjects = db.getAllSubjects();
        const mistakes = db.getAllMistakes({});
        const pomodoro = db.getPomodoroRange('1970-01-01', '2099-12-31');
        const allSettings = db.getAllSettings();

        // Strip sensitive keys (e.g. AI API key) before writing to disk
        const safeSettings = Object.fromEntries(
            Object.entries(allSettings || {}).filter(([key]) => !SENSITIVE_SETTINGS_KEYS.includes(key))
        );

        const payload = {
            version: app.getVersion(),
            timestamp: new Date().toISOString(),
            data: {
                entries,
                tags,
                subjects,
                mistakes,
                pomodoro,
                settings: safeSettings,
            }
        };

        const today = new Date().toISOString().split('T')[0];
        const filename = `MindDiary_AutoBackup_${today}.json`;
        const fullPath = path.join(backupPath, filename);

        await fs.promises.writeFile(fullPath, JSON.stringify(payload, null, 2), 'utf8');

        const files = await fs.promises.readdir(backupPath);
        const backupFiles = [];
        for (const file of files) {
            if (file.startsWith('MindDiary_AutoBackup_') && file.endsWith('.json')) {
                const stat = await fs.promises.stat(path.join(backupPath, file));
                backupFiles.push({ name: file, time: stat.mtimeMs });
            }
        }

        backupFiles.sort((a, b) => b.time - a.time);

        if (backupFiles.length > 7) {
            const toDelete = backupFiles.slice(7);
            for (const file of toDelete) {
                await fs.promises.unlink(path.join(backupPath, file.name)).catch(() => {});
            }
        }
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
