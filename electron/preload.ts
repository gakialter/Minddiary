const { contextBridge, ipcRenderer } = require('electron');

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
            ipcRenderer.on('window:maximized-change', (_: any, maximized: boolean) => callback(maximized));
        },
    },

    // Updater
    updater: {
        check: () => ipcRenderer.invoke('updater:check'),
    },

    // Entries
    entries: {
        create: (entry: any) => ipcRenderer.invoke('entries:create', entry),
        update: (id: number, entry: any) => ipcRenderer.invoke('entries:update', id, entry),
        delete: (id: number) => ipcRenderer.invoke('entries:delete', id),
        getByDate: (date: string) => ipcRenderer.invoke('entries:getByDate', date),
        getById: (id: number) => ipcRenderer.invoke('entries:getById', id),
        getAll: (filters: any) => ipcRenderer.invoke('entries:getAll', filters),
        search: (query: string) => ipcRenderer.invoke('entries:search', query),
        getDatesWithEntries: (yearMonth: string) => ipcRenderer.invoke('entries:getDatesWithEntries', yearMonth),
    },

    // Tags
    tags: {
        getAll: () => ipcRenderer.invoke('tags:getAll'),
        create: (tag: any) => ipcRenderer.invoke('tags:create', tag),
        update: (id: number, tag: any) => ipcRenderer.invoke('tags:update', id, tag),
        delete: (id: number) => ipcRenderer.invoke('tags:delete', id),
        setEntryTags: (entryId: number, tagIds: number[]) => ipcRenderer.invoke('tags:setEntryTags', entryId, tagIds),
        getEntryTags: (entryId: number) => ipcRenderer.invoke('tags:getEntryTags', entryId),
    },

    // Settings
    settings: {
        get: (key: string) => ipcRenderer.invoke('settings:get', key),
        set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
        getAll: () => ipcRenderer.invoke('settings:getAll'),
        selectBackupFolder: () => ipcRenderer.invoke('settings:selectBackupFolder'),
    },

    // Templates
    templates: {
        getAll: () => ipcRenderer.invoke('templates:getAll'),
        create: (template: any) => ipcRenderer.invoke('templates:create', template),
        update: (id: number, template: any) => ipcRenderer.invoke('templates:update', id, template),
        delete: (id: number) => ipcRenderer.invoke('templates:delete', id),
    },

    // Attachments
    attachments: {
        save: (entryId: number, fileData: any) => ipcRenderer.invoke('attachments:save', entryId, fileData),
        getByEntry: (entryId: number) => ipcRenderer.invoke('attachments:getByEntry', entryId),
        delete: (id: number) => ipcRenderer.invoke('attachments:delete', id),
        getPath: (filepath: string) => ipcRenderer.invoke('attachments:getPath', filepath),
    },

    // Subjects
    subjects: {
        getAll: () => ipcRenderer.invoke('subjects:getAll'),
        create: (subject: any) => ipcRenderer.invoke('subjects:create', subject),
        update: (id: number, subject: any) => ipcRenderer.invoke('subjects:update', id, subject),
        delete: (id: number) => ipcRenderer.invoke('subjects:delete', id),
    },

    // Pomodoro
    pomodoro: {
        addSession: (session: any) => ipcRenderer.invoke('pomodoro:addSession', session),
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
        getAll: (filters: any) => ipcRenderer.invoke('mistakes:getAll', filters),
        create: (mistake: any) => ipcRenderer.invoke('mistakes:create', mistake),
        update: (id: number, mistake: any) => ipcRenderer.invoke('mistakes:update', id, mistake),
        delete: (id: number) => ipcRenderer.invoke('mistakes:delete', id),
        toggleMastered: (id: number) => ipcRenderer.invoke('mistakes:toggleMastered', id),
        review: (id: number, data: any) => ipcRenderer.invoke('mistakes:review', id, data),
        getDueCount: (date: string) => ipcRenderer.invoke('mistakes:getDueCount', date),
        getRandomDue: (date: string, subjectId?: number) => ipcRenderer.invoke('mistakes:getRandomDue', date, subjectId),
        saveImage: (data: any) => ipcRenderer.invoke('mistakes:saveImage', data),
        getImagePath: (filename: string) => ipcRenderer.invoke('mistakes:getImagePath', filename),
    },

    // AI
    ai: {
        chat: (messages: any[], settings: any) => ipcRenderer.invoke('ai:chat', messages, settings),
        summarize: (content: string, settings: any) => ipcRenderer.invoke('ai:summarize', content, settings),
    },

    // Notifications
    notification: {
        show: (title: string, body: string) => ipcRenderer.invoke('notification:show', title, body),
    },

    // Export
    export: {
        showSaveDialog: (options: any) => ipcRenderer.invoke('export:showSaveDialog', options),
        writeFile: (filepath: string, content: string) => ipcRenderer.invoke('export:writeFile', { filepath, content }),
        toPDF: (htmlContent: string, savePath: string) => ipcRenderer.invoke('export:toPDF', { htmlContent, savePath }),
    },
});
