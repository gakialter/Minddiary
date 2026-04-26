import type {
  DiaryEntry, NewEntry, EntryFilters, DateMood,
  Tag, Subject, Mistake, MistakeFilters,
  Attachment, AttachmentData,
  PomodoroSession, PomodoroStat, PomodoroRangeEntry,
  AppSettings, AIMessage, AISettings, AIResponse,
  TodayDashboardData, DiaryTemplate,
} from '.'

// ─── Electron Preload API (window.api) ──────────────────────────────────────

export interface ElectronWindowAPI {
  platform: string
  titlebarMode: 'native' | 'custom'
  minimize: () => Promise<void>
  maximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizedChange?: (callback: (maximized: boolean) => void) => void
}

export interface ElectronEntriesAPI {
  create: (entry: NewEntry) => Promise<DiaryEntry>
  update: (id: number, entry: Partial<DiaryEntry>) => Promise<DiaryEntry>
  delete: (id: number) => Promise<void>
  getByDate: (date: string) => Promise<DiaryEntry | null>
  getById: (id: number) => Promise<DiaryEntry | null>
  getAll: (filters: EntryFilters) => Promise<DiaryEntry[]>
  search: (query: string) => Promise<DiaryEntry[]>
  getDatesWithEntries: (yearMonth: string) => Promise<DateMood[]>
}

export interface ElectronTagsAPI {
  getAll: () => Promise<Tag[]>
  create: (tag: Partial<Tag>) => Promise<Tag>
  update: (id: number, tag: Partial<Tag>) => Promise<Tag>
  delete: (id: number) => Promise<void>
  setEntryTags: (entryId: number, tagIds: number[]) => Promise<void>
  getEntryTags: (entryId: number) => Promise<Tag[]>
}

export interface ElectronSettingsAPI {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  getAll: () => Promise<Record<string, string>>
  setAll: (partial: Record<string, string>) => Promise<{ success: boolean }>
  selectBackupFolder: () => Promise<string | null>
}

export interface ElectronAttachmentsAPI {
  save: (entryId: number, fileData: AttachmentData) => Promise<Attachment>
  getByEntry: (entryId: number) => Promise<Attachment[]>
  delete: (id: number) => Promise<void>
  getPath: (filepath: string) => Promise<string>
}

export interface ElectronSubjectsAPI {
  getAll: () => Promise<Subject[]>
  create: (subject: Partial<Subject>) => Promise<Subject>
  update: (id: number, subject: Partial<Subject>) => Promise<Subject>
  delete: (id: number) => Promise<void>
}

export interface ElectronPomodoroAPI {
  addSession: (session: Pick<PomodoroSession, 'subject_id' | 'duration'>) => Promise<{ id: number }>
  getStats: (date: string) => Promise<PomodoroStat[]>
  getDailyTotal: (date: string) => Promise<number>
  getRange: (start: string, end: string) => Promise<PomodoroRangeEntry[]>
}

export interface ElectronDashboardAPI {
  entryDatesRange: (start: string, end: string) => Promise<DateMood[]>
  streak: () => Promise<number>
}

export interface ElectronTodayDashboardAPI {
  getData: (date: string) => Promise<TodayDashboardData>
}

export interface ElectronMistakesAPI {
  getAll: (filters: MistakeFilters) => Promise<Mistake[]>
  create: (mistake: Partial<Mistake>) => Promise<{ id: number }>
  update: (id: number, mistake: Partial<Mistake>) => Promise<void>
  delete: (id: number) => Promise<void>
  toggleMastered: (id: number) => Promise<{ mastered: number }>
  review: (id: number, data: { ease_factor: number; review_interval: number; next_review_date: string; review_count: number }) => Promise<{ success: boolean }>
  getDueCount: (date: string) => Promise<number>
  getRandomDue: (date: string, subjectId?: number) => Promise<Mistake | null>
  saveImage?: (data: { data: string, ext?: string }) => Promise<string>
  getImagePath?: (filename: string) => Promise<string>
}

export interface ElectronAIAPI {
  chat: (messages: AIMessage[]) => Promise<AIResponse>
  summarize: (content: string) => Promise<AIResponse>
}

export interface ElectronNotificationAPI {
  show: (title: string, body: string) => Promise<void>
}

export interface ElectronExportAPI {
  showSaveDialog: (options: Record<string, unknown>) => Promise<string | null>
  writeFile: (filepath: string, content: string) => Promise<void>
  toPDF: (htmlContent: string, savePath: string) => Promise<void>
}

export interface ElectronUpdaterAPI {
  check: () => Promise<{ success: boolean; message?: string; info?: unknown }>
}

export interface ElectronTemplatesAPI {
  getAll: () => Promise<DiaryTemplate[]>
  create: (template: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  update: (id: number, template: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  delete: (id: number) => Promise<{ success: boolean; message?: string }>
}

export interface ElectronAPI {
  window: ElectronWindowAPI
  updater: ElectronUpdaterAPI
  entries: ElectronEntriesAPI
  tags: ElectronTagsAPI
  settings: ElectronSettingsAPI
  attachments: ElectronAttachmentsAPI
  subjects: ElectronSubjectsAPI
  pomodoro: ElectronPomodoroAPI
  dashboard: ElectronDashboardAPI
  todayDashboard: ElectronTodayDashboardAPI
  mistakes: ElectronMistakesAPI
  ai: ElectronAIAPI
  notification: ElectronNotificationAPI
  export: ElectronExportAPI
  templates: ElectronTemplatesAPI
}

// ─── Context API shapes (consumed by components via useDiary) ────────────────

export interface EntriesContextAPI {
  getAll: (filters?: EntryFilters) => Promise<DiaryEntry[]>
  getByDate: (date: string) => Promise<DiaryEntry | null>
  getById: (id: number) => Promise<DiaryEntry | null>
  getDatesWithEntries: (yearMonth: string) => Promise<DateMood[]>
  search: (query: string) => Promise<DiaryEntry[]>
  create: (data: NewEntry) => Promise<DiaryEntry>
  update: (id: number, data: Partial<DiaryEntry>) => Promise<DiaryEntry>
  delete: (id: number) => Promise<boolean>
}

export interface TagsContextAPI {
  getAll: () => Promise<Tag[]>
  create: (data: Partial<Tag>) => Promise<Tag>
  update: (id: number, data: Partial<Tag>) => Promise<Partial<Tag>>
  delete: (id: number) => Promise<boolean>
}

export interface MistakesContextAPI {
  getAll: (filters?: MistakeFilters) => Promise<Mistake[]>
  create: (data: Partial<Mistake>) => Promise<Mistake>
  update: (id: number, data: Partial<Mistake>) => Promise<Partial<Mistake>>
  delete: (id: number) => Promise<boolean>
  toggleMastered: (id: number) => Promise<{ mastered: boolean }>
  review: (id: number, data: { ease_factor: number; review_interval: number; next_review_date: string; review_count: number }) => Promise<{ success: boolean }>
  getDueCount: (date: string) => Promise<number>
  getRandomDue: (date: string, subjectId?: number) => Promise<Mistake | null>
  saveImage?: (data: { data: string, ext?: string }) => Promise<string>
  getImagePath?: (filename: string) => Promise<string>
}

export interface SubjectsContextAPI {
  getAll: () => Promise<Subject[]>
  create: (data: Partial<Subject>) => Promise<Subject>
  update: (id: number, data: Partial<Subject>) => Promise<Partial<Subject>>
  delete: (id: number) => Promise<boolean>
}

export interface PomodoroContextAPI {
  getStats: (date: string) => Promise<PomodoroStat[]>
  getRange: (start: string, end: string) => Promise<PomodoroRangeEntry[]>
  addSession: (session: Pick<PomodoroSession, 'subject_id' | 'duration'>) => Promise<unknown>
  getDailyTotal: (date: string) => Promise<number>
}

export interface DashboardContextAPI {
  streak: () => Promise<number>
  entryDatesRange: (start: string, end: string) => Promise<DateMood[]>
}

export interface TodayDashboardContextAPI {
  getData: (date: string) => Promise<TodayDashboardData>
}

export interface ExportContextAPI {
  showSaveDialog: (options: Record<string, unknown>) => Promise<string | null>
  writeFile: (path: string, content: string) => Promise<boolean | void>
  toPDF: (html: string, path: string) => Promise<boolean | void>
}

export interface NotificationContextAPI {
  show: (title: string, body: string) => Promise<void>
}

export interface AIContextAPI {
  chat: (messages: AIMessage[]) => Promise<AIResponse>
}

export interface AttachmentsContextAPI {
  getByEntry: (entryId: number) => Promise<Attachment[]>
  save: (entryId: number, data: AttachmentData) => Promise<unknown>
  delete: (id: number) => Promise<boolean | void>
}

export interface TemplatesContextAPI {
  getAll: () => Promise<DiaryTemplate[]>
  create: (data: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  update: (id: number, data: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  delete: (id: number) => Promise<{ success: boolean; message?: string }>
}

export interface SettingsContextAPI {
  getAll: () => Promise<AppSettings | Record<string, string>>
  update: (key: string, value: unknown) => Promise<unknown>
  setAll: (partial: Record<string, string>) => Promise<unknown>
}

export interface DiaryContextValue {
  isReady: boolean
  initErrors: string[]

  // Settings surface
  settingsData: AppSettings
  theme: string
  isDarkMode: boolean
  changeTheme: (theme: string) => Promise<unknown>
  settings: SettingsContextAPI

  // Data surface
  entries: EntriesContextAPI
  tags: TagsContextAPI
  mistakes: MistakesContextAPI
  subjects: SubjectsContextAPI
  pomodoro: PomodoroContextAPI
  dashboard: DashboardContextAPI
  todayDashboard: TodayDashboardContextAPI
  exportUtil: ExportContextAPI
  notification: NotificationContextAPI
  ai: AIContextAPI
  attachments: AttachmentsContextAPI
  templates: TemplatesContextAPI
}
