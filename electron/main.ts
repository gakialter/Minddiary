const { app, BrowserWindow, ipcMain, Notification, dialog, session, protocol, net } = require('electron');
let autoUpdater: any = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) {}
const path = require('path');
const fs = require('fs');
const db = require('./database');
const fileManager = require('./fileManager');
const aiService = require('./aiService');

import type {
    NewEntry, EntryFilters, Tag, Subject,
    PomodoroSession, Mistake, MistakeFilters,
    DiaryTemplate, AIMessage, AttachmentData
} from '../src/types/index';

interface FileFilter {
    name: string
    extensions: string[]
}

// Keys that must never appear in exported/backup files (mirrors src/utils/sanitize.js)
const SENSITIVE_SETTINGS_KEYS = ['aiApiKey'];

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
        icon: path.join(__dirname, '..', 'build', 'icon.png')
    });

    // Push maximize state changes to renderer for titlebar icon sync
    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized-change', true);
    });
    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window:maximized-change', false);
    });

    // Dev or production (E2E tests set NODE_ENV=production)
    const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
}

// ==================== Auto Updater ====================
function initAutoUpdater() {
    if (!autoUpdater) return;
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-available', () => {
        dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: '发现新版本，正在后台下载。',
        });
    });
    autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox({
            type: 'info',
            title: '更新准备就绪',
            message: '新版本已下载完毕。是否现在重启应用安装更新？',
            buttons: ['是', '稍后']
        }).then((result: { response: number }) => {
            if (result.response === 0) autoUpdater.quitAndInstall();
        });
    });
}

ipcMain.handle('updater:check', async () => {
    if (!autoUpdater) return { success: false, message: '环境不支持自动更新' };
    
    try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, info: result?.updateInfo };
    } catch (e: unknown) {
        console.error('Update check failed:', e instanceof Error ? e.message : String(e));
        return { success: false, message: '检查更新失败: ' + (e instanceof Error ? e.message : String(e)) };
    }
});

app.whenReady().then(() => {
    protocol.handle('local', (request: { url: string }) => {
        const url = request.url.replace('local://', '');
        try {
            const filePath = decodeURIComponent(url);
            const resolved = path.resolve(filePath);
            // P0-1: restrict local:// to userData directory (attachments & mistake_images)
            const allowedBase = path.resolve(app.getPath('userData'));
            if (!resolved.startsWith(allowedBase + path.sep)) {
                console.warn('[local://] Blocked access outside userData:', resolved);
                return new Response('Forbidden', { status: 403 });
            }
            return net.fetch('file://' + resolved);
        } catch (error) {
            console.error('File protocol parse error:', error);
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
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());

// ==================== Entries ====================
ipcMain.handle('entries:create', (_: unknown, entry: NewEntry) => db.createEntry(entry));
ipcMain.handle('entries:update', (_: unknown, id: number, entry: Partial<NewEntry>) => db.updateEntry(id, entry));
ipcMain.handle('entries:delete', (_: unknown, id: number) => {
    // Phase 11.1 fix: physically remove attachment files BEFORE the SQL DELETE,
    // because ON DELETE CASCADE will kill the attachment *records* but NOT the disk files.
    fileManager.deleteAttachmentsForEntry(id);
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
ipcMain.handle('settings:get', (_: unknown, key: string) => db.getSetting(key));
ipcMain.handle('settings:set', (_: unknown, key: string, value: unknown) => db.setSetting(key, value));
ipcMain.handle('settings:getAll', () => db.getAllSettings());
ipcMain.handle('settings:setAll', (_: unknown, partial: Record<string, string>) => {
    const transaction = db.getDb().transaction(() => {
        for (const [key, value] of Object.entries(partial)) {
            db.setSetting(key, value);
        }
    });
    transaction();
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
        console.error('todayDashboard:getData failed:', e instanceof Error ? e.message : String(e));
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

/** Show a native Save-As dialog and return the chosen path (or null). */
ipcMain.handle('export:showSaveDialog', async (_: unknown, options: { title: string; defaultPath?: string; filters?: FileFilter[] }) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : result.filePath;
});

/** Write a UTF-8 text file (Markdown / JSON export). */
ipcMain.handle('export:writeFile', async (_: unknown, { filepath, content }: { filepath: string; content: string }) => {
    await fs.promises.writeFile(filepath, content, 'utf-8');
});

/**
 * PDF export via Electron's native printToPDF.
 * A temporary hidden BrowserWindow loads the self-contained HTML generated
 * by the renderer, then Chromium paginates and rasterises it to PDF.
 * Chinese text renders perfectly because the system fonts are used directly —
 * no font embedding or subsetting required.
 */
ipcMain.handle('export:toPDF', async (_: unknown, { htmlContent, savePath }: { htmlContent: string; savePath: string }) => {
    const tmpPath = path.join(app.getPath('temp'), 'minddiary_export_tmp.html');
    await fs.promises.writeFile(tmpPath, htmlContent, 'utf-8');

    const win = new BrowserWindow({
        show: false,
        width: 1000,
        height: 1400,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    await win.loadFile(tmpPath);

    const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
    });

    win.close();
    await fs.promises.writeFile(savePath, pdfBuffer);
    await fs.promises.unlink(tmpPath).catch(() => { }); // best-effort cleanup
});

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
        console.error('Auto backup failed:', e instanceof Error ? e.message : String(e));
    }
};

setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
setTimeout(runAutoBackup, 10000);

ipcMain.handle('settings:selectBackupFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择自动备份目录',
        buttonLabel: '选择',
    });
    return result.canceled ? null : result.filePaths[0];
});
