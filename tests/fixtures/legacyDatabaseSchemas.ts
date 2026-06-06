import type Database from 'better-sqlite3'

export type LegacyDatabaseCapabilities = {
  tagStyles: boolean
  pomodoroDateKey: boolean
  pomodoroStartedAt: boolean
  mistakeReviewColumns: boolean
  mistakeImagePath: boolean
  diaryTemplates: boolean
  studyTasks: boolean
}

export type ExpectedLegacyData = {
  entry: {
    id: number
    date: string
    title: string
    content: string
    mood: string
    word_count: number
  }
  tag: {
    id: number
    name: string
    expectedColor: string
    expectedIcon: string
    expectedVariant: string
    expectedPattern: string
  }
  subject: {
    id: number
    name: string
    expectedColor: string
  }
  attachment?: {
    id: number
    filename: string
    filepath: string
    mimetype: string
  }
  pomodoro: {
    id: number
    duration: number
    completed_at: string
    expectedDateKey: string
    expectedStartedAt: string | null
  }
  mistake: {
    id: number
    question: string
    answer: string
    notes: string
    mastered: number
    expectedEaseFactor: number
    expectedReviewInterval: number
    expectedNextReviewDate: string | null
    expectedReviewCount: number
    expectedImagePath: string | null
  }
  setting: {
    key: string
    value: string
  }
  diaryTemplate?: {
    id: number
    name: string
    content: string
  }
  expectedDefaultTemplateCount: number
  studyTask?: {
    id: number
    title: string
    planned_date: string
    status: string
    source: string
  }
}

export type LegacyDatabaseFixture = {
  id: string
  sourceRef: string
  sourceCommit: string
  description: string
  ddlSource: string
  schemaDifferences: readonly string[]
  missingSchema: readonly string[]
  capabilities: LegacyDatabaseCapabilities
  createSchema: (database: Database.Database) => void
  seedData: (database: Database.Database) => ExpectedLegacyData
}

const CORE_V14_SCHEMA = `
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  mood TEXT,
  word_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_entries_date ON entries(date);
CREATE INDEX idx_entries_mood ON entries(mood);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#6366f1'
);

CREATE TABLE entry_tags (
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  mimetype TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  total_chapters INTEGER DEFAULT 0,
  completed_chapters INTEGER DEFAULT 0,
  color TEXT DEFAULT '#8b5cf6'
);

CREATE TABLE pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id),
  duration INTEGER NOT NULL,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pomodoro_completed ON pomodoro_sessions(completed_at);

CREATE TABLE mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id),
  question TEXT NOT NULL,
  answer TEXT,
  notes TEXT,
  mastered INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mistakes_subject ON mistakes(subject_id);

CREATE TABLE ai_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

const LEGACY_MISTAKE_REVIEW_MIGRATION = `
ALTER TABLE mistakes ADD COLUMN ease_factor REAL DEFAULT 2.5;
ALTER TABLE mistakes ADD COLUMN review_interval INTEGER DEFAULT 1;
ALTER TABLE mistakes ADD COLUMN next_review_date TEXT;
ALTER TABLE mistakes ADD COLUMN review_count INTEGER DEFAULT 0;
ALTER TABLE mistakes ADD COLUMN image_path TEXT;
CREATE INDEX idx_mistakes_next_review ON mistakes(next_review_date);
`

const DIARY_TEMPLATES_SCHEMA = `
CREATE TABLE diary_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const CORE_V19_SCHEMA = `
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  mood TEXT,
  word_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_entries_date ON entries(date);
CREATE INDEX idx_entries_mood ON entries(mood);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#0F766E'
);

CREATE TABLE entry_tags (
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag_id ON entry_tags(tag_id);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  mimetype TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  total_chapters INTEGER DEFAULT 0,
  completed_chapters INTEGER DEFAULT 0,
  color TEXT DEFAULT '#0F766E'
);

CREATE TABLE pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id),
  duration INTEGER NOT NULL,
  date_key TEXT,
  started_at DATETIME,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pomodoro_completed ON pomodoro_sessions(completed_at);
CREATE INDEX idx_pomodoro_date_key ON pomodoro_sessions(date_key);

CREATE TABLE mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id),
  question TEXT NOT NULL,
  answer TEXT,
  notes TEXT,
  mastered INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mistakes_subject ON mistakes(subject_id);

CREATE TABLE ai_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

const CORE_V193_SCHEMA = `
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  mood TEXT,
  word_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_entries_date ON entries(date);
CREATE INDEX idx_entries_mood ON entries(mood);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#0F766E',
  icon TEXT DEFAULT '',
  variant TEXT DEFAULT 'soft',
  pattern TEXT DEFAULT 'none'
);

CREATE TABLE entry_tags (
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag_id ON entry_tags(tag_id);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  mimetype TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  total_chapters INTEGER DEFAULT 0,
  completed_chapters INTEGER DEFAULT 0,
  color TEXT DEFAULT '#0F766E'
);

CREATE TABLE pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id),
  duration INTEGER NOT NULL,
  date_key TEXT,
  started_at DATETIME,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pomodoro_completed ON pomodoro_sessions(completed_at);
CREATE INDEX idx_pomodoro_date_key ON pomodoro_sessions(date_key);

CREATE TABLE mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id),
  question TEXT NOT NULL,
  answer TEXT,
  notes TEXT,
  mastered INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mistakes_subject ON mistakes(subject_id);

CREATE TABLE ai_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

const STUDY_TASKS_SCHEMA = `
CREATE TABLE study_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'custom',
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  related_mistake_id INTEGER REFERENCES mistakes(id) ON DELETE SET NULL,
  related_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  planned_date TEXT NOT NULL,
  estimate_minutes INTEGER DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'todo',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_study_tasks_planned_date ON study_tasks(planned_date);
CREATE INDEX idx_study_tasks_status ON study_tasks(status);
CREATE INDEX idx_study_tasks_subject_id ON study_tasks(subject_id);
`

function createV14Schema(database: Database.Database): void {
  database.exec(CORE_V14_SCHEMA)
  database.exec(LEGACY_MISTAKE_REVIEW_MIGRATION)
}

function createV16Schema(database: Database.Database): void {
  database.exec(CORE_V14_SCHEMA)
  database.exec(DIARY_TEMPLATES_SCHEMA)
  database.exec(LEGACY_MISTAKE_REVIEW_MIGRATION)
}

function createV190Schema(database: Database.Database): void {
  database.exec(CORE_V19_SCHEMA)
  database.exec(DIARY_TEMPLATES_SCHEMA)
  database.exec(LEGACY_MISTAKE_REVIEW_MIGRATION)
}

function createV193Schema(database: Database.Database): void {
  database.exec(CORE_V193_SCHEMA)
  database.exec(DIARY_TEMPLATES_SCHEMA)
  database.exec(LEGACY_MISTAKE_REVIEW_MIGRATION)
}

function createV197Schema(database: Database.Database): void {
  database.exec(CORE_V193_SCHEMA)
  database.exec(STUDY_TASKS_SCHEMA)
  database.exec(DIARY_TEMPLATES_SCHEMA)
  database.exec(LEGACY_MISTAKE_REVIEW_MIGRATION)
}

function seedCommonData(
  database: Database.Database,
  fixtureId: string,
  options: {
    sourceColor?: string
    expectedColor: string
    sourceSubjectColor?: string
    expectedSubjectColor: string
    expectedIcon?: string
    expectedVariant?: string
    expectedPattern?: string
    seedAttachment?: boolean
    seedTemplate?: boolean
    seedStudyTask?: boolean
    pomodoroHasDateColumns?: boolean
    pomodoroDateKey?: string | null
    pomodoroStartedAt?: string | null
    mistakeReviewValues?: {
      easeFactor: number
      reviewInterval: number
      nextReviewDate: string | null
      reviewCount: number
      imagePath: string | null
    }
  },
): ExpectedLegacyData {
  const entry = {
    id: 101,
    date: '2026-05-20',
    title: `${fixtureId} entry`,
    content: `${fixtureId} content kept`,
    mood: 'happy',
    word_count: 12,
  }
  database.prepare(`
    INSERT INTO entries (id, date, title, content, mood, word_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '2026-05-20 12:00:00', '2026-05-20 12:10:00')
  `).run(entry.id, entry.date, entry.title, entry.content, entry.mood, entry.word_count)

  const tag = {
    id: 201,
    name: `${fixtureId} tag`,
    expectedColor: options.expectedColor,
    expectedIcon: options.expectedIcon ?? '',
    expectedVariant: options.expectedVariant ?? 'soft',
    expectedPattern: options.expectedPattern ?? 'none',
  }
  const tagColumns = options.expectedIcon !== undefined
    ? '(id, name, color, icon, variant, pattern)'
    : '(id, name, color)'
  const tagValues = options.expectedIcon !== undefined
    ? [tag.id, tag.name, options.sourceColor ?? options.expectedColor, options.expectedIcon, options.expectedVariant ?? 'soft', options.expectedPattern ?? 'none']
    : [tag.id, tag.name, options.sourceColor ?? options.expectedColor]
  database.prepare(`INSERT INTO tags ${tagColumns} VALUES (${tagValues.map(() => '?').join(', ')})`).run(...tagValues)
  database.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(entry.id, tag.id)

  const subject = {
    id: 301,
    name: `${fixtureId} subject`,
    expectedColor: options.expectedSubjectColor,
  }
  database.prepare(`
    INSERT INTO subjects (id, name, total_chapters, completed_chapters, color)
    VALUES (?, ?, 10, 4, ?)
  `).run(subject.id, subject.name, options.sourceSubjectColor ?? options.expectedSubjectColor)

  const attachment = options.seedAttachment
    ? {
        id: 401,
        filename: `${fixtureId}.txt`,
        filepath: `attachments/${fixtureId}.txt`,
        mimetype: 'text/plain',
      }
    : undefined
  if (attachment) {
    database.prepare(`
      INSERT INTO attachments (id, entry_id, filename, filepath, mimetype, created_at)
      VALUES (?, ?, ?, ?, ?, '2026-05-20 12:20:00')
    `).run(attachment.id, entry.id, attachment.filename, attachment.filepath, attachment.mimetype)
  }

  const pomodoro = {
    id: 501,
    duration: 25,
    completed_at: '2026-05-20 12:30:00',
    expectedDateKey: options.pomodoroDateKey || '2026-05-20',
    expectedStartedAt: options.pomodoroStartedAt ?? null,
  }
  if (options.pomodoroHasDateColumns) {
    database.prepare(`
      INSERT INTO pomodoro_sessions (id, subject_id, duration, date_key, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      pomodoro.id,
      subject.id,
      pomodoro.duration,
      options.pomodoroDateKey,
      options.pomodoroStartedAt,
      pomodoro.completed_at,
    )
  } else {
    database.prepare(`
      INSERT INTO pomodoro_sessions (id, subject_id, duration, completed_at)
      VALUES (?, ?, ?, ?)
    `).run(pomodoro.id, subject.id, pomodoro.duration, pomodoro.completed_at)
  }

  const reviewValues = options.mistakeReviewValues ?? {
    easeFactor: 2.5,
    reviewInterval: 1,
    nextReviewDate: null,
    reviewCount: 0,
    imagePath: null,
  }
  const mistake = {
    id: 601,
    question: `${fixtureId} question`,
    answer: `${fixtureId} answer`,
    notes: `${fixtureId} notes`,
    mastered: 0,
    expectedEaseFactor: reviewValues.easeFactor,
    expectedReviewInterval: reviewValues.reviewInterval,
    expectedNextReviewDate: reviewValues.nextReviewDate,
    expectedReviewCount: reviewValues.reviewCount,
    expectedImagePath: reviewValues.imagePath,
  }
  database.prepare(`
    INSERT INTO mistakes (
      id,
      subject_id,
      question,
      answer,
      notes,
      mastered,
      created_at,
      updated_at,
      ease_factor,
      review_interval,
      next_review_date,
      review_count,
      image_path
    ) VALUES (?, ?, ?, ?, ?, ?, '2026-05-20 12:40:00', '2026-05-20 12:45:00', ?, ?, ?, ?, ?)
  `).run(
    mistake.id,
    subject.id,
    mistake.question,
    mistake.answer,
    mistake.notes,
    mistake.mastered,
    reviewValues.easeFactor,
    reviewValues.reviewInterval,
    reviewValues.nextReviewDate,
    reviewValues.reviewCount,
    reviewValues.imagePath,
  )

  const setting = { key: `${fixtureId}:setting`, value: 'enabled' }
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(setting.key, setting.value)

  const diaryTemplate = options.seedTemplate
    ? {
        id: 701,
        name: `${fixtureId} custom template`,
        content: `${fixtureId} template content`,
      }
    : undefined
  if (diaryTemplate) {
    database.prepare(`
      INSERT INTO diary_templates (id, name, content, is_default, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 0, 99, '2026-05-20 12:50:00', '2026-05-20 12:55:00')
    `).run(diaryTemplate.id, diaryTemplate.name, diaryTemplate.content)
  }

  const studyTask = options.seedStudyTask
    ? {
        id: 801,
        title: `${fixtureId} task`,
        planned_date: '2026-05-21',
        status: 'todo',
        source: 'manual',
      }
    : undefined
  if (studyTask) {
    database.prepare(`
      INSERT INTO study_tasks (
        id,
        title,
        description,
        type,
        subject_id,
        related_mistake_id,
        related_entry_id,
        planned_date,
        estimate_minutes,
        status,
        source,
        created_at,
        updated_at
      ) VALUES (?, ?, 'seeded relation', 'custom', ?, ?, ?, ?, 30, ?, ?, '2026-05-20 13:00:00', '2026-05-20 13:05:00')
    `).run(
      studyTask.id,
      studyTask.title,
      subject.id,
      mistake.id,
      entry.id,
      studyTask.planned_date,
      studyTask.status,
      studyTask.source,
    )
  }

  return {
    entry,
    tag,
    subject,
    attachment,
    pomodoro,
    mistake,
    setting,
    diaryTemplate,
    expectedDefaultTemplateCount: diaryTemplate ? 0 : 3,
    studyTask,
  }
}

export const legacyDatabaseFixtures: readonly LegacyDatabaseFixture[] = [
  {
    id: 'v1_4_0_initial_sqlite',
    sourceRef: 'v1.4.0',
    sourceCommit: 'f64b045c6795b33db824ce9a8294814a583a64eb',
    description: 'Earliest release tag in this repository with electron/database.ts.',
    ddlSource: 'git show v1.4.0:electron/database.ts initialize db.exec plus spaced-repetition ALTER block',
    schemaDifferences: [
      'legacy tag and subject color defaults',
      'no entry_tags tag-id index',
      'no pomodoro date_key or started_at columns',
      'no diary_templates table',
      'no study_tasks table',
      'mistake review columns added by the historical inline migration',
    ],
    missingSchema: ['idx_entry_tags_tag_id', 'pomodoro_sessions.date_key', 'pomodoro_sessions.started_at', 'diary_templates', 'study_tasks'],
    capabilities: {
      tagStyles: false,
      pomodoroDateKey: false,
      pomodoroStartedAt: false,
      mistakeReviewColumns: true,
      mistakeImagePath: true,
      diaryTemplates: false,
      studyTasks: false,
    },
    createSchema: createV14Schema,
    seedData: database => seedCommonData(database, 'v1_4_0', {
      sourceColor: '#6366f1',
      expectedColor: '#0E7490',
      sourceSubjectColor: '#8b5cf6',
      expectedSubjectColor: '#475569',
      seedAttachment: true,
    }),
  },
  {
    id: 'v1_6_0_diary_templates',
    sourceRef: 'v1.6.0',
    sourceCommit: 'df74da0209470c3f8138c5535c52cdeab7590a46',
    description: 'Release tag where diary_templates exists and default template seeding is inline.',
    ddlSource: 'git show v1.6.0:electron/database.ts initialize db.exec plus spaced-repetition ALTER block',
    schemaDifferences: [
      'diary_templates exists',
      'legacy tag and subject color defaults remain',
      'no entry_tags tag-id index',
      'no pomodoro date_key or started_at columns',
      'no tag style columns',
      'no study_tasks table',
    ],
    missingSchema: ['idx_entry_tags_tag_id', 'pomodoro_sessions.date_key', 'pomodoro_sessions.started_at', 'tags.icon', 'tags.variant', 'tags.pattern', 'study_tasks'],
    capabilities: {
      tagStyles: false,
      pomodoroDateKey: false,
      pomodoroStartedAt: false,
      mistakeReviewColumns: true,
      mistakeImagePath: true,
      diaryTemplates: true,
      studyTasks: false,
    },
    createSchema: createV16Schema,
    seedData: database => seedCommonData(database, 'v1_6_0', {
      sourceColor: '#6366f1',
      expectedColor: '#0E7490',
      sourceSubjectColor: '#8b5cf6',
      expectedSubjectColor: '#475569',
      seedAttachment: true,
      seedTemplate: true,
    }),
  },
  {
    id: 'v1_9_0_pomodoro_date_key',
    sourceRef: 'v1.9.0',
    sourceCommit: 'ea2a344335abf6207bd2b4450df6fdd5172ba550',
    description: 'Release tag after Pomodoro date_key/started_at adoption and before tag style columns.',
    ddlSource: 'git show v1.9.0:electron/database.ts initialize db.exec plus helper migrations',
    schemaDifferences: [
      'brand color defaults are present',
      'entry_tags tag-id index exists',
      'pomodoro date_key and started_at columns exist',
      'no tag style columns',
      'no study_tasks table',
    ],
    missingSchema: ['tags.icon', 'tags.variant', 'tags.pattern', 'study_tasks'],
    capabilities: {
      tagStyles: false,
      pomodoroDateKey: true,
      pomodoroStartedAt: true,
      mistakeReviewColumns: true,
      mistakeImagePath: true,
      diaryTemplates: true,
      studyTasks: false,
    },
    createSchema: createV190Schema,
    seedData: database => seedCommonData(database, 'v1_9_0', {
      expectedColor: '#0F766E',
      expectedSubjectColor: '#0F766E',
      seedTemplate: true,
      pomodoroHasDateColumns: true,
      pomodoroDateKey: null,
      pomodoroStartedAt: null,
    }),
  },
  {
    id: 'v1_9_3_tag_styles',
    sourceRef: 'v1.9.3',
    sourceCommit: '548dd1b45954acdcdd4e1fd6a03ec2acb739f3d4',
    description: 'Release tag with tag icon/variant/pattern columns and no study_tasks table.',
    ddlSource: 'git show v1.9.3:electron/database.ts initialize db.exec plus helper migrations',
    schemaDifferences: [
      'tag style columns exist',
      'pomodoro date_key and started_at columns exist',
      'diary_templates exists',
      'no study_tasks table',
    ],
    missingSchema: ['study_tasks'],
    capabilities: {
      tagStyles: true,
      pomodoroDateKey: true,
      pomodoroStartedAt: true,
      mistakeReviewColumns: true,
      mistakeImagePath: true,
      diaryTemplates: true,
      studyTasks: false,
    },
    createSchema: createV193Schema,
    seedData: (database) => {
      const expected = seedCommonData(database, 'v1_9_3', {
        expectedColor: '#0F766E',
        expectedSubjectColor: '#0F766E',
        expectedIcon: '',
        expectedVariant: 'soft',
        expectedPattern: 'none',
        seedTemplate: true,
        pomodoroHasDateColumns: true,
        pomodoroDateKey: '2026-05-20',
        pomodoroStartedAt: '2026-05-20 12:05:00',
      })
      database.prepare("UPDATE tags SET icon = NULL, variant = 'sparkle', pattern = 'zigzag' WHERE id = ?")
        .run(expected.tag.id)
      return expected
    },
  },
  {
    id: 'v1_9_7_study_tasks',
    sourceRef: 'v1.9.7',
    sourceCommit: 'c13031ba5d8456dc608518e3e26919cab232ee4b',
    description: 'Latest unversioned release schema before the V2-02 migration runner.',
    ddlSource: 'git show v1.9.7:electron/database.ts initialize db.exec plus helper migrations',
    schemaDifferences: [
      'study_tasks table and indexes exist',
      'tag style columns exist',
      'pomodoro date_key and started_at columns exist',
      'still no PRAGMA user_version adoption runner',
    ],
    missingSchema: [],
    capabilities: {
      tagStyles: true,
      pomodoroDateKey: true,
      pomodoroStartedAt: true,
      mistakeReviewColumns: true,
      mistakeImagePath: true,
      diaryTemplates: true,
      studyTasks: true,
    },
    createSchema: createV197Schema,
    seedData: database => seedCommonData(database, 'v1_9_7', {
      expectedColor: '#0F766E',
      expectedSubjectColor: '#0F766E',
      expectedIcon: 'ok',
      expectedVariant: 'solid',
      expectedPattern: 'grid',
      seedTemplate: true,
      seedStudyTask: true,
      pomodoroHasDateColumns: true,
      pomodoroDateKey: '2026-05-20',
      pomodoroStartedAt: '2026-05-20 12:05:00',
      mistakeReviewValues: {
        easeFactor: 2.8,
        reviewInterval: 3,
        nextReviewDate: '2026-05-23',
        reviewCount: 2,
        imagePath: 'mistake_images/v1_9_7.png',
      },
    }),
  },
] as const
