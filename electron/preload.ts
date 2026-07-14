const { contextBridge, ipcRenderer } = require('electron');

import type { 
    NewEntry, EntryFilters, Tag, Subject, CreateSubjectChapterInput,
    BulkSubjectChaptersInput, ConvertSubjectChaptersInput, SubjectChapterPatch,
    PomodoroSession, StudyTask, StudyTaskQuery, NewStudyTask, Mistake, MistakeFilters,
    DiaryTemplate, AIMessage, AttachmentData, CountdownEvent, FocusWhitelistItem
} from '../src/types/index';

contextBridge.exposeInMainWorld('api', {
    clipboard: {
        writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    },

    // Window controls
    window: {
        platform: process.platform,
        titlebarMode: process.platform === 'darwin' ? 'native' : 'custom',
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        setFullScreen: (fullScreen: boolean) => ipcRenderer.invoke('window:setFullScreen', fullScreen),
        isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
        onMaximizedChange: (callback: (maximized: boolean) => void) => {
            const listener = (_: unknown, maximized: boolean) => callback(maximized);
            ipcRenderer.on('window:maximized-change', listener);
            return () => ipcRenderer.removeListener('window:maximized-change', listener);
        },
        onFullScreenChange: (callback: (fullScreen: boolean) => void) => {
            const listener = (_: unknown, fullScreen: boolean) => callback(fullScreen);
            ipcRenderer.on('window:fullscreen-change', listener);
            return () => ipcRenderer.removeListener('window:fullscreen-change', listener);
        },
    },

    // Updater
    updater: {
        check: () => ipcRenderer.invoke('updater:check'),
        install: () => ipcRenderer.invoke('updater:install'),
        getStatus: () => ipcRenderer.invoke('updater:getStatus'),
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
        getEntryTagsBatch: (entryIds: number[]) => ipcRenderer.invoke('tags:getEntryTagsBatch', entryIds),
    },

    // Settings — narrow API per ADR-002: no plaintext key exposure, patch-only writes
    settings: {
        getAll: () => ipcRenderer.invoke('settings:getAll'),
        updateGeneral: (patch: {
            examDate?: string; theme?: string; pomodoroMinutes?: number;
            autoSave?: boolean; pomodoroSound?: boolean; pomodoroAlert?: boolean;
            countdownEvents?: CountdownEvent[];
            focusGuardEnabled?: boolean; focusGuardIntervalSec?: number; focusWhitelist?: FocusWhitelistItem[];
        }) => ipcRenderer.invoke('settings:updateGeneral', patch),
        updateAI: (patch: {
            aiEndpoint?: string; aiModel?: string;
            aiVisionEnabled?: boolean;
            aiApiKey?: string; clearAiApiKey?: boolean;
        }) => ipcRenderer.invoke('settings:updateAI', patch),
        updateBackup: (patch: {
            autoBackup?: boolean; backupPath?: string;
        }) => ipcRenderer.invoke('settings:updateBackup', patch),
        selectBackupFolder: () => ipcRenderer.invoke('settings:selectBackupFolder'),
        selectBackupFile: () => ipcRenderer.invoke('settings:selectBackupFile'),
        restoreBackupFromZip: (filepath: string) => ipcRenderer.invoke('settings:restoreBackupFromZip', filepath),
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
        getByEntries: (entryIds: number[]) => ipcRenderer.invoke('attachments:getByEntries', entryIds),
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

    subjectChapters: {
        getBySubject: (subjectId: number) => ipcRenderer.invoke('subjectChapters:getBySubject', subjectId),
        create: (chapter: CreateSubjectChapterInput) => ipcRenderer.invoke('subjectChapters:create', chapter),
        bulkCreate: (input: BulkSubjectChaptersInput) => ipcRenderer.invoke('subjectChapters:bulkCreate', input),
        convertFromSummary: (input: ConvertSubjectChaptersInput) => ipcRenderer.invoke('subjectChapters:convertFromSummary', input),
        patch: (id: number, patch: SubjectChapterPatch) => ipcRenderer.invoke('subjectChapters:patch', id, patch),
        toggleCompleted: (id: number, completed?: boolean) => ipcRenderer.invoke('subjectChapters:toggleCompleted', id, completed),
        reorder: (subjectId: number, chapterIds: number[]) => ipcRenderer.invoke('subjectChapters:reorder', subjectId, chapterIds),
        delete: (id: number) => ipcRenderer.invoke('subjectChapters:delete', id),
        clearDetailedChapters: (subjectId: number) => ipcRenderer.invoke('subjectChapters:clearDetailed', subjectId),
    },

    // Pomodoro
    pomodoro: {
        addSession: (session: PomodoroSession) => ipcRenderer.invoke('pomodoro:addSession', session),
        getStats: (date: string) => ipcRenderer.invoke('pomodoro:getStats', date),
        getStatsRange: (start: string, end: string) => ipcRenderer.invoke('pomodoro:getStatsRange', start, end),
        getDailyTotal: (date: string) => ipcRenderer.invoke('pomodoro:getDailyTotal', date),
        getRange: (start: string, end: string) => ipcRenderer.invoke('pomodoro:getRange', start, end),
    },

    // Study tasks
    tasks: {
        getByDate: (date: string) => ipcRenderer.invoke('tasks:getByDate', date),
        find: (query: StudyTaskQuery) => ipcRenderer.invoke('tasks:find', query),
        create: (task: NewStudyTask) => ipcRenderer.invoke('tasks:create', task),
        update: (id: number, patch: Partial<StudyTask>) => ipcRenderer.invoke('tasks:update', id, patch),
        delete: (id: number) => ipcRenderer.invoke('tasks:delete', id),
        complete: (id: number) => ipcRenderer.invoke('tasks:complete', id),
        skip: (id: number) => ipcRenderer.invoke('tasks:skip', id),
        startFocus: (id: number, date: string) => ipcRenderer.invoke('tasks:startFocus', id, date),
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
        saveImage: (data: { data: string; ext?: string; name?: string; mimetype?: string }) => ipcRenderer.invoke('mistakes:saveImage', data),
        deleteImage: (filename: string) => ipcRenderer.invoke('mistakes:deleteImage', filename),
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

    // Focus guard
    focusGuard: {
        getActiveApp: () => ipcRenderer.invoke('focusGuard:getActiveApp'),
    },
});
