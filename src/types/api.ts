import type {
  DiaryEntry, NewEntry, EntryFilters, DateMood,
  Tag, Subject, SubjectChapter, CreateSubjectChapterInput, BulkSubjectChaptersInput,
  ConvertSubjectChaptersInput, SubjectChapterPatch, Mistake, MistakeFilters,
  Attachment, AttachmentData,
  PomodoroSession, PomodoroStat, PomodoroRangeEntry,
  StudyTask, NewStudyTask, StudyTaskQuery,
  AppSettings, AIMessage, AISettings, AIResponse,
  TodayDashboardData, DiaryTemplate, ReviewData, MistakeReviewResult, CountdownEvent,
  FocusWhitelistItem, ActiveAppInfo,
} from '.'

// ─── Electron Preload API (window.api) ──────────────────────────────────────

export interface ElectronWindowAPI {
  platform: string
  titlebarMode: 'native' | 'custom'
  minimize: () => Promise<void>
  maximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  setFullScreen: (fullScreen: boolean) => Promise<boolean>
  isFullScreen: () => Promise<boolean>
  onMaximizedChange?: (callback: (maximized: boolean) => void) => () => void
  onFullScreenChange?: (callback: (fullScreen: boolean) => void) => () => void
}

export interface ElectronClipboardAPI {
  writeText: (text: string) => Promise<void>
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
  getEntryTagsBatch: (entryIds: number[]) => Promise<Record<number, Tag[]>>
}

export interface UpdateGeneralPatch {
  examDate?: string; theme?: string; pomodoroMinutes?: number
  autoSave?: boolean; pomodoroSound?: boolean; pomodoroAlert?: boolean
  countdownEvents?: CountdownEvent[]
  focusGuardEnabled?: boolean
  focusGuardIntervalSec?: number
  focusWhitelist?: FocusWhitelistItem[]
}

export interface UpdateAIPatch {
  aiEndpoint?: string; aiModel?: string
  aiVisionEnabled?: boolean
  aiApiKey?: string; clearAiApiKey?: boolean
}

export interface UpdateBackupPatch {
  autoBackup?: boolean; backupPath?: string
}

export interface RestoreBackupResult {
  success: boolean
  message?: string
  manifest?: {
    appVersion: string
    createdAt: string
    schemaVersion: number
    backupFormatVersion: number
  }
}

export interface SanitizedSettings {
  theme?: string; examDate?: string; dailyGoal?: number
  countdownEvents?: CountdownEvent[]
  autoSave?: string; notifications?: string
  aiEndpoint?: string; aiModel?: string
  aiVisionEnabled?: boolean | string
  pomodoroMinutes?: string
  autoBackup?: string; backupPath?: string
  pomodoroSound?: string; pomodoroAlert?: string
  focusGuardEnabled?: string | boolean
  focusGuardIntervalSec?: string | number
  focusWhitelist?: FocusWhitelistItem[]
  aiApiKeyMasked: string | null
  aiApiKeyPresent: boolean
  [key: string]: unknown
}

export interface ElectronSettingsAPI {
  getAll: () => Promise<SanitizedSettings>
  updateGeneral: (patch: UpdateGeneralPatch) => Promise<{ success: boolean }>
  updateAI: (patch: UpdateAIPatch) => Promise<{ success: boolean }>
  updateBackup: (patch: UpdateBackupPatch) => Promise<{ success: boolean }>
  selectBackupFolder: () => Promise<string | null>
  selectBackupFile: () => Promise<string | null>
  restoreBackupFromZip: (filepath: string) => Promise<RestoreBackupResult>
}

export interface ElectronAttachmentsAPI {
  save: (entryId: number, fileData: AttachmentData) => Promise<Attachment>
  getByEntry: (entryId: number) => Promise<Attachment[]>
  getByEntries: (entryIds: number[]) => Promise<Record<number, Attachment[]>>
  delete: (id: number) => Promise<void>
  getPath: (filepath: string) => Promise<string>
}

export interface ElectronSubjectsAPI {
  getAll: () => Promise<Subject[]>
  create: (subject: Partial<Subject>) => Promise<Subject>
  update: (id: number, subject: Partial<Subject>) => Promise<Subject>
  delete: (id: number) => Promise<void>
}

export interface ElectronSubjectChaptersAPI {
  getBySubject: (subjectId: number) => Promise<SubjectChapter[]>
  create: (chapter: CreateSubjectChapterInput) => Promise<SubjectChapter>
  bulkCreate: (input: BulkSubjectChaptersInput) => Promise<SubjectChapter[]>
  convertFromSummary: (input: ConvertSubjectChaptersInput) => Promise<SubjectChapter[]>
  patch: (id: number, patch: SubjectChapterPatch) => Promise<SubjectChapter>
  toggleCompleted: (id: number, completed?: boolean) => Promise<SubjectChapter>
  reorder: (subjectId: number, chapterIds: number[]) => Promise<SubjectChapter[]>
  delete: (id: number) => Promise<{ success: boolean }>
  clearDetailedChapters: (subjectId: number) => Promise<Subject>
}

export interface ElectronPomodoroAPI {
  addSession: (session: Pick<PomodoroSession, 'subject_id' | 'task_id' | 'duration' | 'date_key' | 'started_at' | 'completed_at'>) => Promise<{ id: number; date_key?: string; started_at?: string | null; completed_at?: string }>
  getStats: (date: string) => Promise<PomodoroStat[]>
  getStatsRange: (start: string, end: string) => Promise<PomodoroStat[]>
  getDailyTotal: (date: string) => Promise<number>
  getRange: (start: string, end: string) => Promise<PomodoroRangeEntry[]>
}

export interface ElectronTasksAPI {
  getByDate: (date: string) => Promise<StudyTask[]>
  find: (query: StudyTaskQuery) => Promise<StudyTask[]>
  create: (data: NewStudyTask) => Promise<StudyTask>
  createForCurrentDate: (data: NewStudyTask, expectedCurrentDate: string) => Promise<StudyTask>
  update: (id: number, patch: Partial<StudyTask>) => Promise<StudyTask>
  delete: (id: number) => Promise<boolean>
  complete: (id: number) => Promise<StudyTask>
  skip: (id: number) => Promise<StudyTask>
  startFocus: (id: number, date: string) => Promise<StudyTask>
}

export interface ElectronDashboardAPI {
  entryDatesRange: (start: string, end: string) => Promise<DateMood[]>
  streak: () => Promise<number>
}

export interface ElectronTodayDashboardAPI {
  getData: (date: string) => Promise<TodayDashboardData>
}

export interface ElectronMistakesAPI {
  getAll: (filters: MistakeFilters) => Promise<{ data: Mistake[], total: number, masteredTotal: number }>
  create: (mistake: Partial<Mistake>) => Promise<{ id: number }>
  update: (id: number, mistake: Partial<Mistake>) => Promise<void>
  delete: (id: number) => Promise<void>
  toggleMastered: (id: number) => Promise<{ mastered: number }>
  review: (id: number, data: ReviewData) => Promise<MistakeReviewResult>
  getDueCount: (date: string) => Promise<number>
  getRandomDue: (date: string, subjectId?: number) => Promise<Mistake | null>
  saveImage?: (data: { data: string, ext?: string, name?: string, mimetype?: string }) => Promise<string>
  deleteImage?: (filename: string) => Promise<void>
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

export interface ElectronFocusGuardAPI {
  getActiveApp: () => Promise<ActiveAppInfo | null>
}

// ─── Auto-Updater status (pushed from main via webContents.send) ─────────────

export type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'auto-update-not-configured'

export interface UpdateStatus {
  status: UpdateStatusType
  /** Available / downloaded version string */
  version?: string
  /** Remote release notes, rendered as inert text in the UI */
  releaseNotes?: string
  /** ISO release timestamp (if provided by electron-updater) */
  releaseDate?: string
  /** Download percent 0–100 */
  percent?: number
  /** Current download speed in bytes/sec */
  bytesPerSecond?: number
  /** Bytes transferred so far */
  transferred?: number
  /** Total download size in bytes */
  total?: number
  /** Human-readable error message */
  message?: string
  errorCode?: 'invalid-metadata' | 'checksum-mismatch' | 'invalid-signature' | 'network' | 'invalid-transition' | 'update-failed'
}

export interface ElectronUpdaterAPI {
  check: () => Promise<{ success: boolean; message?: string; status?: UpdateStatusType; info?: unknown }>
  install: () => Promise<{ success: boolean; message?: string }>
  getStatus: () => Promise<UpdateStatus>
  onStatusChange: (callback: (status: UpdateStatus) => void) => () => void
}

export interface ElectronTemplatesAPI {
  getAll: () => Promise<DiaryTemplate[]>
  create: (template: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  update: (id: number, template: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  delete: (id: number) => Promise<{ success: boolean; message?: string }>
}

export interface ElectronAPI {
  clipboard?: ElectronClipboardAPI
  window: ElectronWindowAPI
  updater: ElectronUpdaterAPI
  entries: ElectronEntriesAPI
  tags: ElectronTagsAPI
  settings: ElectronSettingsAPI
  attachments: ElectronAttachmentsAPI
  subjects: ElectronSubjectsAPI
  subjectChapters: ElectronSubjectChaptersAPI
  pomodoro: ElectronPomodoroAPI
  tasks: ElectronTasksAPI
  dashboard: ElectronDashboardAPI
  todayDashboard: ElectronTodayDashboardAPI
  mistakes: ElectronMistakesAPI
  ai: ElectronAIAPI
  notification: ElectronNotificationAPI
  export: ElectronExportAPI
  focusGuard: ElectronFocusGuardAPI
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
  update: (id: number, data: Partial<Tag>) => Promise<Tag>
  delete: (id: number) => Promise<boolean>
  setEntryTags: (entryId: number, tagIds: number[]) => Promise<void>
  getEntryTags: (entryId: number) => Promise<Tag[]>
  getEntryTagsBatch: (entryIds: number[]) => Promise<Record<number, Tag[]>>
}

export interface MistakesContextAPI {
  getAll: (filters?: MistakeFilters) => Promise<{ data: Mistake[], total: number, masteredTotal: number }>
  create: (data: Partial<Mistake>) => Promise<Mistake>
  update: (id: number, data: Partial<Mistake>) => Promise<Partial<Mistake>>
  delete: (id: number) => Promise<boolean>
  toggleMastered: (id: number) => Promise<{ mastered: boolean }>
  review: (id: number, data: ReviewData) => Promise<MistakeReviewResult>
  getDueCount: (date: string) => Promise<number>
  getRandomDue: (date: string, subjectId?: number) => Promise<Mistake | null>
  saveImage?: (data: { data: string, ext?: string, name?: string, mimetype?: string }) => Promise<string>
  deleteImage?: (filename: string) => Promise<void>
  getImagePath?: (filename: string) => Promise<string>
}

export interface SubjectsContextAPI {
  getAll: () => Promise<Subject[]>
  create: (data: Partial<Subject>) => Promise<Subject>
  update: (id: number, data: Partial<Subject>) => Promise<Partial<Subject>>
  delete: (id: number) => Promise<boolean>
}

export interface SubjectChaptersContextAPI {
  getBySubject: (subjectId: number) => Promise<SubjectChapter[]>
  create: (data: CreateSubjectChapterInput) => Promise<SubjectChapter>
  bulkCreate: (input: BulkSubjectChaptersInput) => Promise<SubjectChapter[]>
  convertFromSummary: (input: ConvertSubjectChaptersInput) => Promise<SubjectChapter[]>
  patch: (id: number, patch: SubjectChapterPatch) => Promise<SubjectChapter>
  toggleCompleted: (id: number, completed?: boolean) => Promise<SubjectChapter>
  reorder: (subjectId: number, chapterIds: number[]) => Promise<SubjectChapter[]>
  delete: (id: number) => Promise<boolean>
  clearDetailedChapters: (subjectId: number) => Promise<Subject>
}

export interface PomodoroContextAPI {
  getStats: (date: string) => Promise<PomodoroStat[]>
  getStatsRange: (start: string, end: string) => Promise<PomodoroStat[]>
  getRange: (start: string, end: string) => Promise<PomodoroRangeEntry[]>
  addSession: (session: Pick<PomodoroSession, 'subject_id' | 'task_id' | 'duration' | 'date_key' | 'started_at' | 'completed_at'>) => Promise<unknown>
  getDailyTotal: (date: string) => Promise<number>
}

export interface TasksContextAPI {
  getByDate: (date: string) => Promise<StudyTask[]>
  find: (query: StudyTaskQuery) => Promise<StudyTask[]>
  create: (data: NewStudyTask) => Promise<StudyTask>
  createForCurrentDate: (data: NewStudyTask, expectedCurrentDate: string) => Promise<StudyTask>
  update: (id: number, patch: Partial<StudyTask>) => Promise<StudyTask>
  delete: (id: number) => Promise<boolean>
  complete: (id: number) => Promise<StudyTask>
  skip: (id: number) => Promise<StudyTask>
  startFocus: (id: number, date: string) => Promise<StudyTask>
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
  getByEntries: (entryIds: number[]) => Promise<Record<number, Attachment[]>>
  save: (entryId: number, data: AttachmentData) => Promise<Attachment>
  delete: (id: number) => Promise<void>
}

export interface TemplatesContextAPI {
  getAll: () => Promise<DiaryTemplate[]>
  create: (data: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  update: (id: number, data: Partial<DiaryTemplate>) => Promise<DiaryTemplate>
  delete: (id: number) => Promise<{ success: boolean; message?: string }>
}

export interface SettingsContextAPI {
  getAll: () => Promise<SanitizedSettings>
  updateGeneral: (patch: UpdateGeneralPatch) => Promise<unknown>
  updateAI: (patch: UpdateAIPatch) => Promise<unknown>
  updateBackup: (patch: UpdateBackupPatch) => Promise<unknown>
  selectBackupFolder?: () => Promise<string | null>
  selectBackupFile?: () => Promise<string | null>
  restoreBackupFromZip?: (filepath: string) => Promise<RestoreBackupResult>
}

export interface DiaryContextValue {
  isReady: boolean
  initErrors: string[]
  dataRefreshVersion: number
  requestDataRefresh: () => void

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
  subjectChapters: SubjectChaptersContextAPI
  pomodoro: PomodoroContextAPI
  tasks: TasksContextAPI
  dashboard: DashboardContextAPI
  todayDashboard: TodayDashboardContextAPI
  exportUtil: ExportContextAPI
  notification: NotificationContextAPI
  ai: AIContextAPI
  attachments: AttachmentsContextAPI
  templates: TemplatesContextAPI
}
