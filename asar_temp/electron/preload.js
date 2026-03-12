const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Window controls
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    },

    // Entries
    entries: {
        create: (entry) => ipcRenderer.invoke('entries:create', entry),
        update: (id, entry) => ipcRenderer.invoke('entries:update', id, entry),
        delete: (id) => ipcRenderer.invoke('entries:delete', id),
        getByDate: (date) => ipcRenderer.invoke('entries:getByDate', date),
        getAll: (filters) => ipcRenderer.invoke('entries:getAll', filters),
        search: (query) => ipcRenderer.invoke('entries:search', query),
        getDatesWithEntries: (yearMonth) => ipcRenderer.invoke('entries:getDatesWithEntries', yearMonth),
    },

    // Tags
    tags: {
        getAll: () => ipcRenderer.invoke('tags:getAll'),
        create: (tag) => ipcRenderer.invoke('tags:create', tag),
        update: (id, tag) => ipcRenderer.invoke('tags:update', id, tag),
        delete: (id) => ipcRenderer.invoke('tags:delete', id),
        setEntryTags: (entryId, tagIds) => ipcRenderer.invoke('tags:setEntryTags', entryId, tagIds),
        getEntryTags: (entryId) => ipcRenderer.invoke('tags:getEntryTags', entryId),
    },

    // Settings
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
        getAll: () => ipcRenderer.invoke('settings:getAll'),
    },

    // Attachments
    attachments: {
        save: (entryId, fileData) => ipcRenderer.invoke('attachments:save', entryId, fileData),
        getByEntry: (entryId) => ipcRenderer.invoke('attachments:getByEntry', entryId),
        delete: (id) => ipcRenderer.invoke('attachments:delete', id),
        getPath: (filepath) => ipcRenderer.invoke('attachments:getPath', filepath),
    },

    // Subjects
    subjects: {
        getAll: () => ipcRenderer.invoke('subjects:getAll'),
        create: (subject) => ipcRenderer.invoke('subjects:create', subject),
        update: (id, subject) => ipcRenderer.invoke('subjects:update', id, subject),
        delete: (id) => ipcRenderer.invoke('subjects:delete', id),
    },

    // Pomodoro
    pomodoro: {
        addSession: (session) => ipcRenderer.invoke('pomodoro:addSession', session),
        getStats: (date) => ipcRenderer.invoke('pomodoro:getStats', date),
        getDailyTotal: (date) => ipcRenderer.invoke('pomodoro:getDailyTotal', date),
        getRange: (start, end) => ipcRenderer.invoke('pomodoro:getRange', start, end),
    },

    // Dashboard
    dashboard: {
        entryDatesRange: (start, end) => ipcRenderer.invoke('dashboard:entryDatesRange', start, end),
        streak: () => ipcRenderer.invoke('dashboard:streak'),
    },

    // Mistakes
    mistakes: {
        getAll: (filters) => ipcRenderer.invoke('mistakes:getAll', filters),
        create: (mistake) => ipcRenderer.invoke('mistakes:create', mistake),
        update: (id, mistake) => ipcRenderer.invoke('mistakes:update', id, mistake),
        delete: (id) => ipcRenderer.invoke('mistakes:delete', id),
        toggleMastered: (id) => ipcRenderer.invoke('mistakes:toggleMastered', id),
    },

    // AI
    ai: {
        chat: (messages, settings) => ipcRenderer.invoke('ai:chat', messages, settings),
        summarize: (content, settings) => ipcRenderer.invoke('ai:summarize', content, settings),
    },

    // Notifications
    notification: {
        show: (title, body) => ipcRenderer.invoke('notification:show', title, body),
    },

    // Export
    export: {
        showSaveDialog: (options) => ipcRenderer.invoke('export:showSaveDialog', options),
        writeFile: (filepath, content) => ipcRenderer.invoke('export:writeFile', { filepath, content }),
        toPDF: (htmlContent, savePath) => ipcRenderer.invoke('export:toPDF', { htmlContent, savePath }),
    },
});
