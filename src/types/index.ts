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
  subject_name?: string
  subject_color?: string
  created_at: string
  updated_at?: string
}

export interface MistakeFilters {
  subject_id?: number
  mastered?: boolean | number
  search?: string
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
  duration: number
  date_key?: string
  started_at?: string
  completed_at?: string
}

export interface PomodoroStat {
  subject_name: string
  color: string
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
export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AISettings {
  endpoint?: string
  apiKey?: string
  model?: string
}

export interface AIResponse {
  content?: string
  error?: string
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
  streakDays: number
}

// ─── Storage Keys ───────────────────────────────────────────────────────────
export interface StorageKeys {
  ENTRIES: string
  TAGS: string
  SETTINGS: string
  MISTAKES: string
  SUBJECTS: string
}

// ─── Shared Callback Types ──────────────────────────────────────────────────
export type SaveToLocalFn = <T>(key: string, data: T) => void

export interface ReviewData {
  ease_factor: number
  review_interval: number
  next_review_date: string
  review_count: number
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
