import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Electron window.api (from preload.js)
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    window: {
      minimize: vi.fn(),
      maximize: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
    },
    entries: {
      get: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      search: vi.fn().mockResolvedValue([]),
    },
    tags: {
      getAll: vi.fn().mockResolvedValue([]),
      addToEntry: vi.fn().mockResolvedValue(true),
      removeFromEntry: vi.fn().mockResolvedValue(true),
    },
    settings: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue(true),
      exportData: vi.fn().mockResolvedValue(true),
      importData: vi.fn().mockResolvedValue(true),
      requestDirectory: vi.fn().mockResolvedValue('C:\\Mock\\Path'),
    },
    attachments: {
      save: vi.fn().mockResolvedValue('mock-path.png'),
      delete: vi.fn().mockResolvedValue(true),
      getByEntry: vi.fn().mockResolvedValue([]),
    },
    subjects: {
      getAll: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      updateProgress: vi.fn().mockResolvedValue(true),
    },
    pomodoro: {
      getStats: vi.fn().mockResolvedValue({ todaySessions: 0, todayMinutes: 0 }),
      saveSession: vi.fn().mockResolvedValue(true),
      getDailyTotal: vi.fn().mockResolvedValue(0),
    },
    dashboard: {
      getStats: vi.fn().mockResolvedValue({ totalEntries: 0, totalWords: 0, streakDays: 0 }),
      getWeeklyActivity: vi.fn().mockResolvedValue([]),
      getSubjectDistribution: vi.fn().mockResolvedValue([]),
      getRecentActivity: vi.fn().mockResolvedValue([]),
      getMoodStats: vi.fn().mockResolvedValue([]),
    },
    mistakes: {
      getAll: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
    },
    ai: {
      chat: vi.fn().mockResolvedValue('Mock AI response'),
      summarize: vi.fn().mockResolvedValue('Mock summary'),
      generateReport: vi.fn().mockResolvedValue('Mock report'),
    },
    notifications: {
      schedule: vi.fn().mockResolvedValue(true),
      cancel: vi.fn().mockResolvedValue(true),
      permission: {
        request: vi.fn().mockResolvedValue(true),
        check: vi.fn().mockResolvedValue(true),
      }
    },
    focusGuard: {
      getActiveApp: vi.fn().mockResolvedValue(null),
    },
    export: {
      toMarkdown: vi.fn().mockResolvedValue(true),
      toPDF: vi.fn().mockResolvedValue(true),
    }
  }
}

// Mock IntersectionObserver for components that might use it (like virtual lists)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IntersectionObserver = class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock ResizeObserver
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).ResizeObserver = class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock HTML Dialog Element methods
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
}
