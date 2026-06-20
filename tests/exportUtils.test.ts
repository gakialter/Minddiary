// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateJSON, generateMarkdown, generatePdfHtml, parseMindDiaryJsonSnapshot } from '../src/utils/exportUtils'
import packageJson from '../package.json'

afterEach(() => {
  vi.restoreAllMocks()
})

type ExportEntry = NonNullable<Parameters<typeof generateMarkdown>[0]>[number]

interface ExportPayload {
  _meta: {
    app: string
    version: string
    exportedAt: string
    counts: {
      entries: number
      subjects: number
      subject_chapters: number
      mistakes: number
    }
  }
  entries: unknown[]
  subjects: unknown[]
  subject_chapters: unknown[]
  mistakes: unknown[]
}

const makeEntry = (overrides: Partial<ExportEntry> = {}): ExportEntry => ({
  id: 1,
  date: '2026-04-20',
  title: '复盘记录',
  content: '今天完成了数学错题复盘。',
  mood: 'happy',
  word_count: 13,
  tags: [],
  created_at: '2026-04-20T08:00:00.000Z',
  updated_at: '2026-04-20T09:00:00.000Z',
  ...overrides,
})

const parseExport = (json: string): ExportPayload => JSON.parse(json) as ExportPayload

describe('generateMarkdown', () => {
  it('returns fallback text for empty input', () => {
    expect(generateMarkdown(null)).toContain('暂无日记记录')
    expect(generateMarkdown(undefined)).toContain('暂无日记记录')
    expect(generateMarkdown([])).toContain('暂无日记记录')
  })

  it('renders one entry with frontmatter and body', () => {
    const markdown = generateMarkdown([
      makeEntry({
        date: '2026-04-21',
        title: '周二复盘',
        content: '整理完英语长难句。',
        mood: 'calm',
        tags: ['英语', '长难句'],
      }),
    ])

    expect(markdown).toContain('# MindDiary 导出')
    expect(markdown).toMatch(
      /---\ndate: "2026-04-21"\ntitle: "周二复盘"\nmood: "平静"\ntags: \[英语, 长难句\]\n---/,
    )
    expect(markdown).toContain('# 周二复盘')
    expect(markdown).toContain('整理完英语长难句。')
  })

  it('sorts multiple entries by date ascending', () => {
    const markdown = generateMarkdown([
      makeEntry({ id: 2, date: '2026-04-22', title: '第二天' }),
      makeEntry({ id: 1, date: '2026-04-20', title: '第一天' }),
      makeEntry({ id: 3, date: '2026-04-21', title: '中间一天' }),
    ])

    expect(markdown.indexOf('date: "2026-04-20"')).toBeLessThan(markdown.indexOf('date: "2026-04-21"'))
    expect(markdown.indexOf('date: "2026-04-21"')).toBeLessThan(markdown.indexOf('date: "2026-04-22"'))
  })

  it('maps motivated mood to its Chinese label', () => {
    const markdown = generateMarkdown([makeEntry({ mood: 'motivated' })])

    expect(markdown).toContain('mood: "动力满满"')
  })

  it('stringifies object, number, and string tags', () => {
    const markdown = generateMarkdown([
      makeEntry({
        tags: [{ name: '数学', color: '#0f766e' }, 42, '错题'],
      }),
    ])

    expect(markdown).toContain('tags: [数学, 42, 错题]')
  })

  it('uses the formatted date as heading when title is empty', () => {
    const markdown = generateMarkdown([makeEntry({ date: '2026-04-20', title: '' })])

    expect(markdown).toMatch(/# 2026年4月20日周一|# 2026年4月20日 周一/)
  })

  it('uses fallback copy when content is empty', () => {
    const markdown = generateMarkdown([makeEntry({ content: '' })])

    expect(markdown).toContain('（今天没有留下文字）')
  })

  it('escapes quotes in frontmatter title', () => {
    const markdown = generateMarkdown([makeEntry({ title: '读完"概率论"' })])

    expect(markdown).toContain('title: "读完\\"概率论\\""')
  })
})

describe('generateJSON', () => {
  it('returns valid JSON with metadata and provided data', () => {
    const entries = [makeEntry()] as any
    const subjects = [{ id: 1, name: '数学', color: '#0f766e' }]
    const mistakes = [{ id: 1, question: '积分题', answer: '换元法' }]
    const payload = parseExport(generateJSON({ entries, subjects, mistakes }))

    expect(payload._meta.app).toBe('MindDiary')
    expect(payload._meta.version).toBe(packageJson.version)
    expect(payload._meta.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(payload._meta.counts).toEqual({ entries: 1, subjects: 1, subject_chapters: 0, mistakes: 1 })
    expect(payload.entries).toEqual(entries)
    expect(payload.subjects).toEqual(subjects)
    expect(payload.subject_chapters).toEqual([])
    expect(payload.mistakes).toEqual(mistakes)
  })

  it('uses empty arrays and zero counts when data sections are missing', () => {
    const payload = parseExport(generateJSON({}))

    expect(payload._meta.counts).toEqual({ entries: 0, subjects: 0, subject_chapters: 0, mistakes: 0 })
    expect(payload.entries).toEqual([])
    expect(payload.subjects).toEqual([])
    expect(payload.subject_chapters).toEqual([])
    expect(payload.mistakes).toEqual([])
  })

  it('reports counts that match actual array lengths', () => {
    const payload = parseExport(
      generateJSON({
        entries: [makeEntry({ id: 1 }), makeEntry({ id: 2 })] as any,
        subjects: [{ id: 1 }, { id: 2 }, { id: 3 }] as any[],
        subject_chapters: [{ id: 1, subject_id: 1, title: 'A' }, { id: 2, subject_id: 2, title: 'B' }] as any[],
        mistakes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as any[],
      }),
    )

    expect(payload._meta.counts.entries).toBe(payload.entries.length)
    expect(payload._meta.counts.subjects).toBe(payload.subjects.length)
    expect(payload._meta.counts.subject_chapters).toBe(payload.subject_chapters.length)
    expect(payload._meta.counts.mistakes).toBe(payload.mistakes.length)
  })
})

describe('parseMindDiaryJsonSnapshot', () => {
  it('accepts old JSON exports without subject chapters', () => {
    const snapshot = parseMindDiaryJsonSnapshot(JSON.stringify({
      entries: [makeEntry()],
      subjects: [{ id: 1, name: 'Math', total_chapters: 5, completed_chapters: 2, color: '#0f766e' }],
      mistakes: [],
    }))

    expect(snapshot.subject_chapters).toEqual([])
    expect(snapshot.subjects).toHaveLength(1)
  })

  it('accepts subject chapters that reference imported subjects', () => {
    const snapshot = parseMindDiaryJsonSnapshot(JSON.stringify({
      entries: [],
      subjects: [{ id: 10, name: 'Math', total_chapters: 2, completed_chapters: 1, color: '#0f766e' }],
      subject_chapters: [
        {
          id: 20,
          subject_id: 10,
          title: '  第一章 函数  ',
          notes: '  重点  ',
          completed: 1,
          sort_order: 0,
        },
      ],
      mistakes: [],
    }))

    expect(snapshot.subject_chapters).toEqual([
      expect.objectContaining({
        id: 20,
        subject_id: 10,
        title: '第一章 函数',
        notes: '重点',
        completed: true,
        sort_order: 0,
      }),
    ])
  })

  it('rejects subject chapters that point at missing imported subjects', () => {
    expect(() => parseMindDiaryJsonSnapshot(JSON.stringify({
      entries: [],
      subjects: [{ id: 10, name: 'Math' }],
      subject_chapters: [{ id: 20, subject_id: 99, title: 'Dangling' }],
      mistakes: [],
    }))).toThrow('subject_chapters references missing subject_id 99')
  })
})

describe('generatePdfHtml', () => {
  it('returns a complete HTML document structure', () => {
    const html = generatePdfHtml([makeEntry()])

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<head>')
    expect(html).toContain('<body>')
    expect(html).toContain('</html>')
  })

  it('uses the default title when options are omitted', () => {
    const html = generatePdfHtml([])

    expect(html).toContain('<title>MindDiary 学习报告</title>')
    expect(html).toContain('MindDiary 学习报告')
  })

  it('renders a custom title', () => {
    const html = generatePdfHtml([], { title: '四月复盘报告' })

    expect(html).toContain('<title>四月复盘报告</title>')
    expect(html).toContain('四月复盘报告')
  })

  it('escapes HTML characters in title and content', () => {
    const html = generatePdfHtml(
      [
        makeEntry({
          title: '标题 <script>alert("x")</script>',
          content: '正文 <script>alert("x")</script> & "quote"',
        }),
      ],
      { title: '报告 <script>alert("x")</script>' },
    )

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).toContain('正文 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quote&quot;')
    expect(html).not.toContain('<script>')
  })

  it('returns valid HTML for null or undefined input', () => {
    expect(generatePdfHtml(null)).toContain('<!DOCTYPE html>')
    expect(generatePdfHtml(undefined)).toContain('<!DOCTYPE html>')
  })

  it('renders mood and tags', () => {
    const html = generatePdfHtml([
      makeEntry({
        mood: 'motivated',
        tags: [{ name: '数学', color: '#0f766e' }, 7, '复盘'],
      }),
    ])

    expect(html).toContain('<span class="entry-mood">动力满满</span>')
    expect(html).toContain('<span class="tag">数学</span>')
    expect(html).toContain('<span class="tag">7</span>')
    expect(html).toContain('<span class="tag">复盘</span>')
  })
})
