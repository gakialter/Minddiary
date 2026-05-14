const { contextBridge, ipcRenderer } = require('electron');

import type { 
    NewEntry, EntryFilters, Tag, Subject, 
    PomodoroSession, Mistake, MistakeFilters, 
    DiaryTemplate, AIMessage, AttachmentData, CountdownEvent
} from '../src/types/index';

contextBridge.exposeInMainWorld('api', {
    // Window controls
    window: {
        platform: process.platform,
        titlebarMode: process.platform === 'darwin' ? 'native' : 'custom',
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        onMaximizedChange: (callback: (maximized: boolean) => void) => {
            const listener = (_: unknown, maximized: boolean) => callback(maximized);
            ipcRenderer.on('window:maximized-change', listener);
            return () => ipcRenderer.removeListener('window:maximized-change', listener);
        },
    },

    // Updater
    updater: {
        check: () => ipcRenderer.invoke('updater:check'),
        install: () => ipcRenderer.invoke('updater:install'),
        onStatusChange: (callback: (status: unknown) => void) => {
            const listener = (_: unknown, status: unknown) => callback(status as never);
            ipcRenderer.on('updater:status', listener);
            return () => ipcRenderer.removeListener('updater:status', listener);
        },
    },

    // Entries
    entries: {
        create: (entry: NewEntry) => ipcRenderer.invoke('entries:create', entry),
        update: (id: number, entry: Partial<NewEntry>) => ipcRenderer.invoke('entries:update', id, entry),
        delete: (id: number) => ipcRenderer.invoke('entries:delete', id),
        getByDate: (date: string) => ipcRenderer.invoke('entries:getByDate', date),
        getById: (id: number) => ipcRenderer.invoke('entries:getById', id),
        getAll: (filters: EntryFilters) => ipcRenderer.invoke('entries:getAll', filters),
        search: (query: string) => ipcRenderer.invoke('entries:search', query),
        getDatesWithEntries: (yearMonth: string) => ipcRenderer.invoke('entries:getDatesWithEntries', yearMonth),
    },

    // Tags
    tags: {
        getAll: () => ipcRenderer.invoke('tags:getAll'),
        create: (tag: Partial<Tag>) => ipcRenderer.invoke('tags:create', tag),
        update: (id: number, tag: Partial<Tag>) => ipcRenderer.invoke('tags:update', id, tag),
        delete: (id: number) => ipcRenderer.invoke('tags:delete', id),
        setEntryTags: (entryId: number, tagIds: number[]) => ipcRenderer.invoke('tags:setEntryTags', entryId, tagIds),
        getEntryTags: (entryId: number) => ipcRenderer.invoke('tags:getEntryTags', entryId),
    },

    // Settings — narrow API per ADR-002: no plaintext key exposure, patch-only writes
    settings: {
        getAll: () => ipcRenderer.invoke('settings:getAll'),
        updateGeneral: (patch: {
            examDate?: string; theme?: string; pomodoroMinutes?: number;
            autoSave?: boolean; pomodoroSound?: boolean; pomodoroAlert?: boolean;
            countdownEvents?: CountdownEvent[];
        }) => ipcRenderer.invoke('settings:updateGeneral', patch),
        updateAI: (patch: {
            aiEndpoint?: string; aiModel?: string;
            aiApiKey?: string; clearAiApiKey?: boolean;
        }) => ipcRenderer.invoke('settings:updateAI', patch),
        updateBackup: (patch: {
            autoBackup?: boolean; backupPath?: string;
        }) => ipcRenderer.invoke('settings:updateBackup', patch),
        selectBackupFolder: () => ipcRenderer.invoke('settings:selectBackupFolder'),
    },

    // Templates
    templates: {
        getAll: () => ipcRenderer.invoke('templates:getAll'),
        create: (template: Partial<DiaryTemplate>) => ipcRenderer.invoke('templates:create', template),
        update: (id: number, template: Partial<DiaryTemplate>) => ipcRenderer.invoke('templates:update', id, template),
        delete: (id: number) => ipcRenderer.invoke('templates:delete', id),
    },

    // Attachments
    attachments: {
        save: (entryId: number, fileData: AttachmentData) => ipcRenderer.invoke('attachments:save', entryId, fileData),
        getByEntry: (entryId: number) => ipcRenderer.invoke('attachments:getByEntry', entryId),
        delete: (id: number) => ipcRenderer.invoke('attachments:delete', id),
        getPath: (filepath: string) => ipcRenderer.invoke('attachments:getPath', filepath),
    },

    // Subjects
    subjects: {
        getAll: () => ipcRenderer.invoke('subjects:getAll'),
        create: (subject: Partial<Subject>) => ipcRenderer.invoke('subjects:create', subject),
        update: (id: number, subject: Partial<Subject>) => ipcRenderer.invoke('subjects:update', id, subject),
        delete: (id: number) => ipcRenderer.invoke('subjects:delete', id),
    },

    // Pomodoro
    pomodoro: {
        addSession: (session: PomodoroSession) => ipcRenderer.invoke('pomodoro:addSession', session),
        getStats: (date: string) => ipcRenderer.invoke('pomodoro:getStats', date),
        getDailyTotal: (date: string) => ipcRenderer.invoke('pomodoro:getDailyTotal', date),
        getRange: (start: string, end: string) => ipcRenderer.invoke('pomodoro:getRange', start, end),
    },

    // Dashboard
    dashboard: {
        entryDatesRange: (start: string, end: string) => ipcRenderer.invoke('dashboard:entryDatesRange', start, end),
        streak: () => ipcRenderer.invoke('dashboard:streak'),
    },

    // Today Dashboard (V3.0)
    todayDashboard: {
        getData: (date: string) => ipcRenderer.invoke('todayDashboard:getData', date),
    },

    // Mistakes
    mistakes: {
        getAll: (filters: MistakeFilters) => ipcRenderer.invoke('mistakes:getAll', filters),
        create: (mistake: Partial<Mistake>) => ipcRenderer.invoke('mistakes:create', mistake),
        update: (id: number, mistake: Partial<Mistake>) => ipcRenderer.invoke('mistakes:update', id, mistake),
        delete: (id: number) => ipcRenderer.invoke('mistakes:delete', id),
        toggleMastered: (id: number) => ipcRenderer.invoke('mistakes:toggleMastered', id),
        review: (id: number, data: Partial<Mistake>) => ipcRenderer.invoke('mistakes:review', id, data),
        getDueCount: (date: string) => ipcRenderer.invoke('mistakes:getDueCount', date),
        getRandomDue: (date: string, subjectId?: number) => ipcRenderer.invoke('mistakes:getRandomDue', date, subjectId),
        saveImage: (data: { name: string; data: string; mimetype: string }) => ipcRenderer.invoke('mistakes:saveImage', data),
        getImagePath: (filename: string) => ipcRenderer.invoke('mistakes:getImagePath', filename),
    },

    // AI
    ai: {
        chat: (messages: AIMessage[]) => ipcRenderer.invoke('ai:chat', messages),
        summarize: (content: string) => ipcRenderer.invoke('ai:summarize', content),
    },

    // Notifications
    notification: {
        show: (title: string, body: string) => ipcRenderer.invoke('notification:show', title, body),
    },

    // Export
    export: {
        showSaveDialog: (options: { title: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => ipcRenderer.invoke('export:showSaveDialog', options),
        writeFile: (filepath: string, content: string) => ipcRenderer.invoke('export:writeFile', { filepath, content }),
        toPDF: (htmlContent: string, savePath: string) => ipcRenderer.invoke('export:toPDF', { htmlContent, savePath }),
    },
});
