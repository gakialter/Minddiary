/**
 * exportUtils.js — Markdown, JSON, and PDF export for MindDiary
 *
 * PDF strategy
 * ────────────
 * We generate a self-contained HTML document in the renderer, send it to the
 * Electron main process via IPC, which loads it in a hidden BrowserWindow and
 * calls webContents.printToPDF().  This gives us:
 *   • Native Chromium rendering → zero Chinese-font embedding issues
 *   • Full CSS support (Glassmorphism, colour variables, etc.)
 *   • Automatic A4 pagination handled by the browser's print engine
 *   • No jsPDF dependency, no font subsetting, no canvas hacks
 */

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Escape HTML special characters (used when embedding user content in HTML). */
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/** Format an ISO date string to a human-readable Chinese date. */
function formatDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    })
}

/** Map mood IDs to emoji. */
const MOOD_EMOJI = {
    motivated: '💪', happy: '😊', calm: '😐',
    tired: '😫', anxious: '😰', sad: '😢',
}

// ─────────────────────────────────────────────
// Markdown export
// ─────────────────────────────────────────────

/**
 * Convert an array of diary entries to a single Markdown document with YAML
 * Frontmatter per entry (compatible with Obsidian, Notion import, etc.).
 *
 * @param {object[]} entries
 * @returns {string}
 */
export function generateMarkdown(entries) {
    if (!entries?.length) return '# MindDiary 导出\n\n暂无日记记录。\n'

    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))

    const blocks = sorted.map(entry => {
        const tags = (entry.tags || []).map(t => t.name || t).join(', ')
        const mood = MOOD_EMOJI[entry.mood] || ''
        return [
            '---',
            `date: "${entry.date}"`,
            `title: "${(entry.title || '').replace(/"/g, '\\"')}"`,
            mood ? `mood: "${mood}"` : null,
            tags ? `tags: [${tags}]` : null,
            '---',
            '',
            entry.title ? `# ${entry.title}` : `# ${formatDate(entry.date)}`,
            '',
            entry.content || '_（今天没有留下文字）_',
            '',
            '---',
            '',
        ].filter(l => l !== null).join('\n')
    })

    return (
        `# MindDiary 导出\n\n` +
        `> 导出时间：${new Date().toLocaleString('zh-CN')}\n` +
        `> 共 ${sorted.length} 篇日记\n\n` +
        blocks.join('\n')
    )
}

// ─────────────────────────────────────────────
// JSON export
// ─────────────────────────────────────────────

/**
 * Full-site JSON backup — includes entries, subjects, pomodoro stats, and
 * mistakes so the entire dataset can be restored from a single file.
 *
 * @param {object} data  — { entries, subjects, mistakes }
 * @returns {string}     — formatted JSON
 */
export function generateJSON(data) {
    const payload = {
        _meta: {
            app: 'MindDiary',
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            counts: {
                entries: data.entries?.length ?? 0,
                subjects: data.subjects?.length ?? 0,
                mistakes: data.mistakes?.length ?? 0,
            },
        },
        entries: data.entries ?? [],
        subjects: data.subjects ?? [],
        mistakes: data.mistakes ?? [],
    }
    return JSON.stringify(payload, null, 2)
}

// ─────────────────────────────────────────────
// PDF HTML template
// ─────────────────────────────────────────────

/**
 * Build a print-ready HTML document for the given entries.
 * The CSS uses @page A4 with sensible margins, avoids page breaks inside
 * diary cards, and embeds system fonts so Chinese renders correctly on all
 * platforms supported by Electron (Win/Mac/Linux).
 *
 * @param {object[]} entries
 * @param {object}   [opts]
 * @param {string}   [opts.title='MindDiary 学习报告']
 * @returns {string}   — complete HTML string
 */
export function generatePdfHtml(entries, opts = {}) {
    const { title = 'MindDiary 学习报告' } = opts
    const sorted = [...(entries || [])].sort((a, b) => a.date.localeCompare(b.date))

    const entryCards = sorted.map(entry => {
        const mood = MOOD_EMOJI[entry.mood] || ''
        const tags = (entry.tags || [])
            .map(t => `<span class="tag">${escapeHtml(t.name || t)}</span>`)
            .join('')

        // Convert newlines to <br> for the PDF (Markdown not parsed here to
        // avoid bundling a parser into the export path)
        const bodyHtml = escapeHtml(entry.content || '（今天没有留下文字）')
            .replace(/\n/g, '<br>')

        return `
        <div class="entry-card">
            <div class="entry-header">
                <span class="entry-date">${escapeHtml(formatDate(entry.date))}</span>
                ${mood ? `<span class="entry-mood">${mood}</span>` : ''}
            </div>
            ${entry.title ? `<h2 class="entry-title">${escapeHtml(entry.title)}</h2>` : ''}
            ${tags ? `<div class="entry-tags">${tags}</div>` : ''}
            <div class="entry-body">${bodyHtml}</div>
        </div>`
    }).join('\n')

    const now = new Date().toLocaleString('zh-CN')

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
    /* ── Page geometry ── */
    @page {
        size: A4 portrait;
        margin: 18mm 16mm 20mm 16mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Typography — system fonts for full CJK coverage ── */
    body {
        font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC",
                     "Source Han Sans CN", "WenQuanYi Zen Hei", sans-serif;
        font-size: 11pt;
        line-height: 1.75;
        color: #1a1a2e;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* ── Cover header ── */
    .cover {
        text-align: center;
        padding: 32pt 0 24pt;
        border-bottom: 2px solid #8b5cf6;
        margin-bottom: 28pt;
    }
    .cover h1 {
        font-size: 24pt;
        font-weight: 800;
        color: #8b5cf6;
        letter-spacing: -0.5pt;
    }
    .cover p { color: #64748b; margin-top: 6pt; font-size: 10pt; }

    /* ── Entry cards — avoid page break inside ── */
    .entry-card {
        page-break-inside: avoid;
        break-inside: avoid;
        border: 1px solid #e2e8f0;
        border-radius: 8pt;
        padding: 16pt 18pt;
        margin-bottom: 16pt;
        border-left: 4pt solid #8b5cf6;
    }

    .entry-header {
        display: flex;
        align-items: center;
        gap: 8pt;
        margin-bottom: 6pt;
    }
    .entry-date {
        font-size: 9pt;
        color: #64748b;
        font-weight: 600;
        letter-spacing: 0.3pt;
    }
    .entry-mood { font-size: 14pt; }

    .entry-title {
        font-size: 14pt;
        font-weight: 700;
        color: #1e1b4b;
        margin-bottom: 8pt;
    }

    .entry-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4pt;
        margin-bottom: 10pt;
    }
    .tag {
        font-size: 8.5pt;
        background: #ede9fe;
        color: #6d28d9;
        padding: 2pt 7pt;
        border-radius: 10pt;
        font-weight: 500;
    }

    .entry-body {
        font-size: 10.5pt;
        color: #334155;
        line-height: 1.8;
    }

    /* ── Footer ── */
    .footer {
        margin-top: 24pt;
        padding-top: 10pt;
        border-top: 1px solid #e2e8f0;
        text-align: center;
        font-size: 8.5pt;
        color: #94a3b8;
    }
</style>
</head>
<body>
    <div class="cover">
        <h1>📖 ${escapeHtml(title)}</h1>
        <p>共 ${sorted.length} 篇日记 &nbsp;·&nbsp; 导出于 ${escapeHtml(now)}</p>
    </div>

    ${entryCards}

    <div class="footer">
        由 MindDiary 生成 &nbsp;·&nbsp; ${escapeHtml(now)}
    </div>
</body>
</html>`
}
