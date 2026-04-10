// ─── Mood ───────────────────────────────────────────────────────────────────
export type MoodId = 'motivated' | 'happy' | 'calm' | 'tired' | 'anxious' | 'sad'

export interface MoodOption {
  id: MoodId
  emoji: string
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
export interface Tag {
  id: number
  name: string
  color: string
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
  mastered: boolean | number
  subject_name?: string
  subject_color?: string
  created_at: string
  updated_at?: string
}

export interface MistakeFilters {
  subject_id?: number
  mastered?: boolean | number
  search?: string
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

// ─── Settings ───────────────────────────────────────────────────────────────
export interface AppSettings {
  theme: string
  examDate: string
  dailyGoal: number
  autoSave: boolean
  notifications: boolean
  aiEndpoint: string
  aiApiKey: string
  aiModel: string
  pomodoroMinutes: number
  autoBackup: boolean
  backupPath: string
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

// ─── Storage Keys ───────────────────────────────────────────────────────────
export interface StorageKeys {
  ENTRIES: string
  TAGS: string
  SETTINGS: string
  MISTAKES: string
  SUBJECTS: string
}
