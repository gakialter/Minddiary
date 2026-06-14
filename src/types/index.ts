// ─── Mood ───────────────────────────────────────────────────────────────────
export type MoodId = 'motivated' | 'happy' | 'calm' | 'tired' | 'anxious' | 'sad'

export interface MoodOption {
  id: MoodId
  label: string
}

// ─── Diary Entries ──────────────────────────────────────────────────────────
export interface DiaryEntry {
  id: number
  date: string          // 'YYYY-MM-DD'
  title: string
  content: string
  mood: MoodId | null
  word_count: number
  tags?: number[]
  images?: string[]
  content_snippet?: string
  created_at: string
  updated_at: string
}

export type NewEntry = Pick<DiaryEntry, 'date' | 'title' | 'content' | 'mood'> & {
  tags?: number[]
  images?: string[]
}

export interface EntryFilters {
  mood?: MoodId
  tagId?: number
  startDate?: string
  endDate?: string
  limit?: number
  includeContent?: boolean
}

export interface DateMood {
  date: string
  mood: MoodId | null
}

// ─── Tags ───────────────────────────────────────────────────────────────────
export type TagVariant = 'solid' | 'soft' | 'outline' | 'ghost'
export type TagPattern = 'none' | 'dots' | 'stripes' | 'grid' | 'leaf'

export interface Tag {
  id: number
  name: string
  color: string
  icon?: string
  variant?: TagVariant
  pattern?: TagPattern
}

// ─── Subjects ───────────────────────────────────────────────────────────────
export interface Subject {
  id: number
  name: string
  color: string
  total_chapters?: number
  completed_chapters?: number
  order?: number
}

export interface SubjectChapter {
  id: number
  subject_id: number
  title: string
  notes: string
  completed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SubjectChapterDraft {
  title: string
  notes?: string
  completed?: boolean
}

export interface CreateSubjectChapterInput extends SubjectChapterDraft {
  subject_id: number
}

export interface BulkSubjectChaptersInput {
  subject_id: number
  chapters: SubjectChapterDraft[]
}

export interface ConvertSubjectChaptersInput extends BulkSubjectChaptersInput {
  markCompletedCount: number
}

export type SubjectChapterPatch = Partial<Pick<SubjectChapter, 'title' | 'notes' | 'completed'>>

// --- Study Tasks ------------------------------------------------------------
export type StudyTaskType = 'review' | 'focus' | 'diary' | 'mistake' | 'custom'
export type StudyTaskStatus = 'todo' | 'doing' | 'done' | 'skipped'
export type StudyTaskSource = 'manual' | 'dashboard' | 'ai' | 'pomodoro'

export interface StudyTask {
  id: number
  title: string
  description: string
  type: StudyTaskType
  subject_id: number | null
  related_mistake_id: number | null
  related_entry_id: number | null
  planned_date: string
  estimate_minutes: number
  status: StudyTaskStatus
  source: StudyTaskSource
  created_at: string
  updated_at: string
}

export interface StudyTaskQuery {
  planned_date?: string
  type?: StudyTaskType
  status?: StudyTaskStatus | StudyTaskStatus[]
  related_mistake_id?: number | null
  related_entry_id?: number | null
}

export type NewStudyTask = Pick<StudyTask, 'title' | 'planned_date'> & Partial<
  Pick<
    StudyTask,
    | 'description'
    | 'type'
    | 'subject_id'
    | 'related_mistake_id'
    | 'related_entry_id'
    | 'estimate_minutes'
    | 'status'
    | 'source'
  >
>

// ─── Mistakes ───────────────────────────────────────────────────────────────
export interface Mistake {
  id: number
  subject_id: number | null
  question: string
  answer: string
  notes: string
  mastered: boolean
  // Spaced repetition (SM-2) fields
  ease_factor: number
  review_interval: number       // days until next review
  next_review_date: string | null  // 'YYYY-MM-DD' or null if never reviewed
  review_count: number
  image_path?: string | null
  answer_image_path?: string | null
  subject_name?: string
  subject_color?: string
  created_at: string
  updated_at?: string
}

export interface MistakeFilters {
  subject_id?: number
  mastered?: boolean | number
  search?: string
  due?: boolean
  dueDate?: string
  limit?: number
  offset?: number
}

// ─── Attachments ────────────────────────────────────────────────────────────
export interface Attachment {
  id: number
  entry_id: number
  filename: string
  filepath: string
  mimetype: string
  created_at: string
}

export interface AttachmentData {
  name: string
  data: string    // base64
  mimetype: string
}

// ─── Pomodoro ───────────────────────────────────────────────────────────────
export interface PomodoroSession {
  id?: number
  subject_id: number | null
  task_id?: number | null
  duration: number
  date_key?: string
  started_at?: string
  completed_at?: string
}

export interface PomodoroStat {
  subject_name: string | null
  color: string | null
  total_minutes: number
  session_count: number
}

export interface PomodoroRangeEntry {
  date: string
  total_minutes: number
  session_count: number
}

export interface FocusWhitelistItem {
  id: string
  name: string
  processName?: string
  executable?: string
  enabled: boolean
  createdAt: string
}

export interface ActiveAppInfo {
  name: string
  processName?: string
  executable?: string
  title?: string
  platform: NodeJS.Platform | string
}

// ─── Settings ───────────────────────────────────────────────────────────────
export type CountdownEventType = 'exam' | 'holiday' | 'deadline' | 'custom'

export interface CountdownEvent {
  id: string
  title: string
  date: string
  type?: CountdownEventType
  pinned?: boolean
  archived?: boolean
}

export interface AppSettings {
  theme: string
  examDate: string
  countdownEvents?: CountdownEvent[]
  dailyGoal: number
  autoSave: boolean
  notifications: boolean
  aiEndpoint: string
  aiModel: string
  aiVisionEnabled?: boolean
  pomodoroMinutes: number
  focusGuardEnabled: boolean
  focusGuardIntervalSec: number
  focusWhitelist: FocusWhitelistItem[]
  autoBackup: boolean
  backupPath: string
  aiApiKeyMasked: string | null
  aiApiKeyPresent: boolean
  [key: string]: unknown
}

// ─── AI ─────────────────────────────────────────────────────────────────────
export interface AITextContentPart {
  type: 'text'
  text: string
}

export interface AIImageContentPart {
  type: 'image_url'
  image_url: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

export type AIContentPart = AITextContentPart | AIImageContentPart

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AIContentPart[]
}

export interface AISettings {
  endpoint?: string
  apiKey?: string
  model?: string
}

export interface AIResponse {
  content?: string
  error?: string
  unsupported?: boolean
}

// ─── Today Dashboard ────────────────────────────────────────────────────────
export interface TodayDashboardData {
  todayEntry: {
    id: number
    title: string
    wordCount: number
    mood: MoodId | null
  } | null
  pomodoroToday: {
    totalMinutes: number
    sessionCount: number
  }
  commanderMetrics: {
    riskPoolCount: number
    lockedKnowledgeGrowth: number
    focusConversionRate: number
  }
  taskFocusToday: {
    effectiveTaskCount: number
    completedTaskCount: number
    completionRate: number
    focusedTaskCount: number
    focusCoverageRate: number
    focusedMinutes: number
    skippedTaskCount: number
    openWithoutFocusCount: number
    focusedOpenTaskCount: number
    unclosedTaskTitles: string[]
  }
  streakDays: number
}

// ─── Storage Keys ───────────────────────────────────────────────────────────
export interface StorageKeys {
  ENTRIES: string
  TAGS: string
  SETTINGS: string
  MISTAKES: string
  SUBJECTS: string
  SUBJECT_CHAPTERS: string
  TASKS: string
  POMODORO_SESSIONS: string
}

// ─── Shared Callback Types ──────────────────────────────────────────────────
export type SaveToLocalFn = <T>(key: string, data: T) => void

export interface ReviewData {
  ease_factor: number
  review_interval: number
  next_review_date: string
  review_count: number
}

export interface MistakeReviewResult {
  success: boolean
  mistake: Mistake
}

// ─── Diary Templates ───────────────────────────────────────────────────────
export interface DiaryTemplate {
  id: number
  name: string
  content: string
  is_default: number   // 0 or 1 (SQLite boolean)
  sort_order: number
  created_at: string
  updated_at: string
}
