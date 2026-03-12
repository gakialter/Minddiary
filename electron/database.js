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

function createMistake({ subject_id, question, answer, notes }) {
    const stmt = db.prepare(
        'INSERT INTO mistakes (subject_id, question, answer, notes) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(subject_id || null, question, answer || '', notes || '');
    return { id: result.lastInsertRowid };
}

function updateMistake(id, { subject_id, question, answer, notes }) {
    db.prepare(
        'UPDATE mistakes SET subject_id=?, question=?, answer=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(subject_id || null, question, answer || '', notes || '', id);
    return { success: true };
}

function deleteMistake(id) {
    db.prepare('DELETE FROM mistakes WHERE id=?').run(id);
    return { success: true };
}

function toggleMistakeMastered(id) {
    db.prepare('UPDATE mistakes SET mastered = 1 - mastered, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    const row = db.prepare('SELECT mastered FROM mistakes WHERE id=?').get(id);
    return { mastered: row.mastered };
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
    getPomodoroRange, getEntryDatesRange, getStudyStreak,
    getAllMistakes, createMistake, updateMistake, deleteMistake, toggleMistakeMastered,
    setCustomDbPath, getDb: () => db
};
