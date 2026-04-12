const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

let customDbPath = null;

function setCustomDbPath(p) {
    customDbPath = p;
}

function getDbPath() {
    if (customDbPath) return customDbPath;
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'minddiary.db');
}

function initialize() {
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      title TEXT,
      content TEXT NOT NULL DEFAULT '',
      mood TEXT,
      word_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entries_mood ON entries(mood);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mimetype TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      total_chapters INTEGER DEFAULT 0,
      completed_chapters INTEGER DEFAULT 0,
      color TEXT DEFAULT '#8b5cf6'
    );

    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id),
      duration INTEGER NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pomodoro_completed ON pomodoro_sessions(completed_at);

    CREATE TABLE IF NOT EXISTS mistakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id),
      question TEXT NOT NULL,
      answer TEXT,
      notes TEXT,
      mastered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject_id);

    CREATE TABLE IF NOT EXISTS ai_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

    // ── v2.0 Migration: Spaced Repetition columns on mistakes ──
    const srColumns = [
        { name: 'ease_factor',      sql: 'ALTER TABLE mistakes ADD COLUMN ease_factor REAL DEFAULT 2.5' },
        { name: 'review_interval',  sql: 'ALTER TABLE mistakes ADD COLUMN review_interval INTEGER DEFAULT 1' },
        { name: 'next_review_date', sql: 'ALTER TABLE mistakes ADD COLUMN next_review_date TEXT' },
        { name: 'review_count',     sql: 'ALTER TABLE mistakes ADD COLUMN review_count INTEGER DEFAULT 0' },
        { name: 'image_path',       sql: 'ALTER TABLE mistakes ADD COLUMN image_path TEXT' },
    ];
    for (const col of srColumns) {
        try { db.exec(col.sql); } catch { /* column already exists — safe to ignore */ }
    }
    // Index for due-review queries
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_mistakes_next_review ON mistakes(next_review_date)'); } catch { /* ignore */ }
}

// ==================== Entries ====================
function createEntry({ date, title, content, mood }) {
    const wordCount = (content || '').replace(/\s/g, '').length;
    const stmt = db.prepare(
        'INSERT INTO entries (date, title, content, mood, word_count) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(date, title || '', content || '', mood || null, wordCount);
    return { id: result.lastInsertRowid, date, title, content, mood, word_count: wordCount };
}

function updateEntry(id, { title, content, mood }) {
    const wordCount = (content || '').replace(/\s/g, '').length;
    const stmt = db.prepare(
        'UPDATE entries SET title=?, content=?, mood=?, word_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    );
    stmt.run(title || '', content || '', mood || null, wordCount, id);
    return getEntryById(id);
}

function deleteEntry(id) {
    db.prepare('DELETE FROM entries WHERE id=?').run(id);
    return { success: true };
}

function getEntryById(id) {
    return db.prepare('SELECT * FROM entries WHERE id=?').get(id);
}

function getEntryByDate(date) {
    return db.prepare('SELECT * FROM entries WHERE date=?').get(date);
}

function getAllEntries(filters = {}) {
    // Phase 11.2: By default, strip heavy `content` field from list queries.
    // Pass { includeContent: true } when full text is needed (e.g. export/backup).
    const columns = filters.includeContent
        ? '*'
        : 'id, date, title, mood, word_count, created_at, updated_at';
    let query = `SELECT ${columns} FROM entries`;
    const conditions = [];
    const params = [];

    if (filters.mood) {
        conditions.push('mood = ?');
        params.push(filters.mood);
    }
    if (filters.startDate) {
        conditions.push('date >= ?');
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        conditions.push('date <= ?');
        params.push(filters.endDate);
    }
    if (filters.tagId) {
        conditions.push('id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ?)');
        params.push(filters.tagId);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY date DESC';

    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
}

function searchEntries(query) {
    const searchTerm = `%${query}%`;
    // Return metadata + a content snippet indicator; full content loaded via getEntryById
    return db.prepare(
        'SELECT id, date, title, mood, word_count, created_at, updated_at, SUBSTR(content, 1, 200) AS content_snippet FROM entries WHERE content LIKE ? OR title LIKE ? ORDER BY date DESC'
    ).all(searchTerm, searchTerm);
}

function getDatesWithEntries(yearMonth) {
    const pattern = `${yearMonth}%`;
    return db.prepare(
        'SELECT date, mood FROM entries WHERE date LIKE ?'
    ).all(pattern);
}

// ==================== Tags ====================
function getAllTags() {
    return db.prepare('SELECT * FROM tags ORDER BY name').all();
}

function createTag({ name, color }) {
    const stmt = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)');
    const result = stmt.run(name, color || '#6366f1');
    return { id: result.lastInsertRowid, name, color: color || '#6366f1' };
}

function updateTag(id, { name, color }) {
    db.prepare('UPDATE tags SET name=?, color=? WHERE id=?').run(name, color, id);
    return { id, name, color };
}

function deleteTag(id) {
    db.prepare('DELETE FROM tags WHERE id=?').run(id);
    return { success: true };
}

function setEntryTags(entryId, tagIds) {
    const deleteStmt = db.prepare('DELETE FROM entry_tags WHERE entry_id=?');
    const insertStmt = db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
    const transaction = db.transaction(() => {
        deleteStmt.run(entryId);
        for (const tagId of tagIds) {
            insertStmt.run(entryId, tagId);
        }
    });
    transaction();
    return { success: true };
}

function getEntryTags(entryId) {
    return db.prepare(
        'SELECT t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?'
    ).all(entryId);
}

// ==================== Settings ====================
function getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? row.value : null;
}

function setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    return { success: true };
}

function getAllSettings() {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}

// ==================== Attachments ====================
function addAttachment(entryId, { filename, filepath, mimetype }) {
    const stmt = db.prepare(
        'INSERT INTO attachments (entry_id, filename, filepath, mimetype) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(entryId, filename, filepath, mimetype);
    return { id: result.lastInsertRowid, entry_id: entryId, filename, filepath, mimetype };
}

function getAttachmentsByEntry(entryId) {
    return db.prepare('SELECT * FROM attachments WHERE entry_id=?').all(entryId);
}

function getAttachmentById(id) {
    return db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
}

function removeAttachment(id) {
    db.prepare('DELETE FROM attachments WHERE id=?').run(id);
    return { success: true };
}

// ==================== Subjects ====================
function getAllSubjects() {
    return db.prepare('SELECT * FROM subjects ORDER BY name').all();
}

function createSubject({ name, total_chapters, color }) {
    const stmt = db.prepare(
        'INSERT INTO subjects (name, total_chapters, color) VALUES (?, ?, ?)'
    );
    const result = stmt.run(name, total_chapters || 0, color || '#8b5cf6');
    return { id: result.lastInsertRowid, name, total_chapters: total_chapters || 0, completed_chapters: 0, color: color || '#8b5cf6' };
}

function updateSubject(id, { name, total_chapters, completed_chapters, color }) {
    db.prepare(
        'UPDATE subjects SET name=?, total_chapters=?, completed_chapters=?, color=? WHERE id=?'
    ).run(name, total_chapters, completed_chapters, color, id);
    return { id, name, total_chapters, completed_chapters, color };
}

function deleteSubject(id) {
    db.prepare('DELETE FROM subjects WHERE id=?').run(id);
    return { success: true };
}

// ==================== Pomodoro ====================
function addPomodoroSession({ subject_id, duration }) {
    const stmt = db.prepare(
        'INSERT INTO pomodoro_sessions (subject_id, duration) VALUES (?, ?)'
    );
    const result = stmt.run(subject_id || null, duration);
    return { id: result.lastInsertRowid };
}

function getPomodoroStats(date) {
    return db.prepare(`
    SELECT s.name as subject_name, s.color, SUM(p.duration) as total_minutes, COUNT(p.id) as session_count
    FROM pomodoro_sessions p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE DATE(p.completed_at) = ?
    GROUP BY p.subject_id
  `).all(date);
}

function getDailyStudyMinutes(date) {
    const row = db.prepare(
        'SELECT COALESCE(SUM(duration), 0) as total FROM pomodoro_sessions WHERE DATE(completed_at) = ?'
    ).get(date);
    return row.total;
}

// Dashboard: daily totals over a date range
function getPomodoroRange(startDate, endDate) {
    return db.prepare(`
        SELECT DATE(completed_at) as date, 
               SUM(duration) as total_minutes, 
               COUNT(id) as session_count
        FROM pomodoro_sessions
        WHERE DATE(completed_at) BETWEEN ? AND ?
        GROUP BY DATE(completed_at)
        ORDER BY date ASC
    `).all(startDate, endDate);
}

// Dashboard: entry dates with mood for heatmap
function getEntryDatesRange(startDate, endDate) {
    return db.prepare(`
        SELECT date, mood FROM entries
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC
    `).all(startDate, endDate);
}

// Dashboard: consecutive study days streak (entries or pomodoro)
function getStudyStreak() {
    const rows = db.prepare(`
        SELECT DISTINCT date FROM (
            SELECT DATE(completed_at) as date FROM pomodoro_sessions
            UNION
            SELECT date FROM entries
        )
        ORDER BY date DESC
    `).all();

    if (rows.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if today or yesterday is in the list to start counting
    const firstDate = new Date(rows[0].date + 'T00:00:00');
    const diffFromToday = Math.round((today - firstDate) / 86400000);
    if (diffFromToday > 1) return 0; // Gap > 1 day, streak broken

    for (let i = 0; i < rows.length; i++) {
        const d = new Date(rows[i].date + 'T00:00:00');
        const expected = new Date(today);
        expected.setDate(expected.getDate() - streak - diffFromToday);
        expected.setHours(0, 0, 0, 0);

        if (d.getTime() === expected.getTime()) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// ==================== Today Dashboard (V3.0 Batch Query) ====================
/**
 * Aggregate all "today" stats in a single transaction.
 * This prevents the renderer from issuing 6+ individual IPC calls.
 * Keys are returned in camelCase to match TypeScript interfaces.
 *
 * @param {string} date - ISO date string 'YYYY-MM-DD'
 * @returns {object} TodayDashboardData shape
 */
function getTodayDashboard(date) {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const getTodayData = db.transaction(() => {
        // 1. Today's diary entry (lightweight — no full content)
        const todayEntry = db.prepare(
            'SELECT id, title, word_count, mood FROM entries WHERE date = ?'
        ).get(date) || null;

        // 2. Today's pomodoro summary
        const pomRow = db.prepare(`
            SELECT COALESCE(SUM(duration), 0) as total_minutes,
                   COUNT(id) as session_count
            FROM pomodoro_sessions
            WHERE DATE(completed_at) = ?
        `).get(date);

        // 3. Due review count
        const dueRow = db.prepare(`
            SELECT COUNT(*) as count FROM mistakes
            WHERE mastered = 0 AND (next_review_date IS NULL OR next_review_date <= ?)
        `).get(date);

        // 4. Mistake overview (total + mastered)
        const mistakeRow = db.prepare(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) as mastered
            FROM mistakes
        `).get();

        // 5. Consecutive study streak
        const streak = getStudyStreak();

        // 6. Weekly trend for sparkline (last 7 days)
        const weekAgo = new Date(date + 'T00:00:00');
        weekAgo.setDate(weekAgo.getDate() - 6);
        const weekStart = weekAgo.toISOString().split('T')[0];
        const weeklyRows = db.prepare(`
            SELECT DATE(completed_at) as date,
                   SUM(duration) as total_minutes
            FROM pomodoro_sessions
            WHERE DATE(completed_at) BETWEEN ? AND ?
            GROUP BY DATE(completed_at)
            ORDER BY date ASC
        `).all(weekStart, date);

        return {
            // snake_case → camelCase mapping
            todayEntry: todayEntry ? {
                id: todayEntry.id,
                title: todayEntry.title,
                wordCount: todayEntry.word_count,
                mood: todayEntry.mood,
            } : null,
            pomodoroToday: {
                totalMinutes: pomRow.total_minutes,
                sessionCount: pomRow.session_count,
            },
            dueReviewCount: dueRow.count,
            mistakeOverview: {
                total: mistakeRow.total,
                mastered: mistakeRow.mastered || 0,
            },
            streakDays: streak,
            weeklyTrend: weeklyRows.map(r => ({
                date: r.date,
                totalMinutes: r.total_minutes,
            })),
        };
    });

    return getTodayData();
}

// ==================== Mistakes ====================
function getAllMistakes(filters = {}) {
    let query = 'SELECT m.*, s.name as subject_name, s.color as subject_color FROM mistakes m LEFT JOIN subjects s ON m.subject_id = s.id';
    const conditions = [];
    const params = [];

    if (filters.subject_id) {
        conditions.push('m.subject_id = ?');
        params.push(filters.subject_id);
    }
    if (filters.mastered !== undefined) {
        conditions.push('m.mastered = ?');
        params.push(filters.mastered ? 1 : 0);
    }
    if (filters.search) {
        conditions.push('(m.question LIKE ? OR m.answer LIKE ? OR m.notes LIKE ?)');
        const term = `%${filters.search}%`;
        params.push(term, term, term);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY m.created_at DESC';
    return db.prepare(query).all(...params);
}

function createMistake({ subject_id, question, answer, notes, image_path }) {
    const stmt = db.prepare(
        'INSERT INTO mistakes (subject_id, question, answer, notes, image_path) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(subject_id || null, question || '', answer || '', notes || '', image_path || null);
    return { id: result.lastInsertRowid };
}

function updateMistake(id, { subject_id, question, answer, notes, mastered, image_path }) {
    const updates = [];
    const params = [];
    if (subject_id !== undefined) { updates.push('subject_id = ?'); params.push(subject_id); }
    if (question !== undefined) { updates.push('question = ?'); params.push(question); }
    if (answer !== undefined) { updates.push('answer = ?'); params.push(answer); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (mastered !== undefined) { updates.push('mastered = ?'); params.push(mastered ? 1 : 0); }
    if (image_path !== undefined) { updates.push('image_path = ?'); params.push(image_path); }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE mistakes SET ${updates.join(', ')} WHERE id=?`).run(...params);
    return { success: true };
}

function deleteMistake(id) {
    try {
        const mistake = db.prepare('SELECT image_path FROM mistakes WHERE id = ?').get(id);
        if (mistake && mistake.image_path) {
            const fileManager = require('./fileManager');
            fileManager.deleteMistakeImage(mistake.image_path);
        }
    } catch(e) { console.error('Failed to cleanup mistake image', e); }

    db.prepare('DELETE FROM mistakes WHERE id=?').run(id);
    return { success: true };
}

function toggleMistakeMastered(id) {
    db.prepare('UPDATE mistakes SET mastered = 1 - mastered, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    const row = db.prepare('SELECT mastered FROM mistakes WHERE id=?').get(id);
    return { mastered: row.mastered };
}

/**
 * Update a mistake's spaced-repetition fields after a review.
 * @param {number} id - Mistake ID
 * @param {{ease_factor: number, review_interval: number, next_review_date: string, review_count: number}} data
 */
function reviewMistake(id, { ease_factor, review_interval, next_review_date, review_count }) {
    db.prepare(`
        UPDATE mistakes
        SET ease_factor = ?, review_interval = ?, next_review_date = ?, review_count = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(ease_factor, review_interval, next_review_date, review_count, id);
    return { success: true };
}

/**
 * Count mistakes due for review on or before the given date.
 */
function getDueForReviewCount(date) {
    const row = db.prepare(`
        SELECT COUNT(*) as count FROM mistakes
        WHERE mastered = 0 AND (next_review_date IS NULL OR next_review_date <= ?)
    `).get(date);
    return row.count;
}

/**
 * Get a random unmastered mistake, optionally filtered by subject.
 */
function getRandomDueMistake(date, subjectId) {
    let query = `
        SELECT m.*, s.name as subject_name, s.color as subject_color
        FROM mistakes m LEFT JOIN subjects s ON m.subject_id = s.id
        WHERE m.mastered = 0 AND (m.next_review_date IS NULL OR m.next_review_date <= ?)
    `;
    const params = [date];
    if (subjectId) {
        query += ' AND m.subject_id = ?';
        params.push(subjectId);
    }
    query += ' ORDER BY RANDOM() LIMIT 1';
    return db.prepare(query).get(...params) || null;
}

module.exports = {
    initialize,
    createEntry, updateEntry, deleteEntry, getEntryById, getEntryByDate,
    getAllEntries, searchEntries, getDatesWithEntries,
    getAllTags, createTag, updateTag, deleteTag, setEntryTags, getEntryTags,
    getSetting, setSetting, getAllSettings,
    addAttachment, getAttachmentsByEntry, getAttachmentById, removeAttachment,
    getAllSubjects, createSubject, updateSubject, deleteSubject,
    addPomodoroSession, getPomodoroStats, getDailyStudyMinutes,
    getPomodoroRange, getEntryDatesRange, getStudyStreak, getTodayDashboard,
    getAllMistakes, createMistake, updateMistake, deleteMistake, toggleMistakeMastered,
    reviewMistake, getDueForReviewCount, getRandomDueMistake,
    setCustomDbPath, getDb: () => db
};
