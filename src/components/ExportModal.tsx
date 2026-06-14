import { useRef, useState } from 'react'
import { CheckCircle, XCircle, Check, Upload } from 'lucide-react'
import { generateMarkdown, generateJSON, generatePdfHtml, parseMindDiaryJsonSnapshot } from '../utils/exportUtils'
import { useDiary } from '../contexts/DiaryContext'
import { getLocalDateKey } from '../utils/dateKey'
import { logger } from '../utils/logger'
import { Download, FileDown, FileText, FileJson } from 'lucide-react'

interface ExportFormat {
    id: string
    icon: React.ReactElement
    label: string
    desc: string
    ext: string
    filter: Array<{ name: string; extensions: string[] }>
}

const FORMATS: ExportFormat[] = [
    {
        id: 'pdf',
        icon: <FileDown size={28} style={{ color: 'var(--text-secondary)' }} />,
        label: 'PDF 报告',
        desc: '带排版的可打印学习报告，中文字体原生渲染',
        ext: '.pdf',
        filter: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    },
    {
        id: 'markdown',
        icon: <FileText size={28} style={{ color: 'var(--text-secondary)' }} />,
        label: 'Markdown',
        desc: '含 YAML Frontmatter，兼容 Obsidian / Notion 导入',
        ext: '.md',
        filter: [{ name: 'Markdown 文件', extensions: ['md'] }],
    },
    {
        id: 'json',
        icon: <FileJson size={28} style={{ color: 'var(--text-secondary)' }} />,
        label: 'JSON 全站备份',
        desc: '包含日记、科目、错题的完整数据快照，可用于恢复',
        ext: '.json',
        filter: [{ name: 'JSON 文件', extensions: ['json'] }],
    },
]

interface ExportModalProps {
    onClose: () => void
}

export default function ExportModal({ onClose }: ExportModalProps) {
    const { entries: entriesAPI, subjects: subjectsAPI, subjectChapters: subjectChaptersAPI, mistakes: mistakesAPI, exportUtil } = useDiary()
    const [selectedFormat, setSelectedFormat] = useState('pdf')
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [message, setMessage] = useState('')
    const importInputRef = useRef<HTMLInputElement | null>(null)

    const handleExport = async () => {
        setStatus('loading')
        setMessage('')

        try {
            // 1. Fetch all data needed
            const [entries, subjects, mistakes] = await Promise.all([
                entriesAPI.getAll({ includeContent: true }),
                subjectsAPI.getAll(),
                mistakesAPI.getAll({}).then(res => res?.data || []),
            ])
            const subjectChapters = (await Promise.all(
                subjects.map(subject => subjectChaptersAPI.getBySubject(subject.id).catch(() => [])),
            )).flat()

            if (!entries?.length) {
                setStatus('error')
                setMessage('暂无日记记录，请先写几篇日记再导出。')
                return
            }

            // 2. Show native Save-As dialog
            const fmt = FORMATS.find(f => f.id === selectedFormat)!
            const defaultName = `MindDiary_${getLocalDateKey()}${fmt.ext}`
            const savePath = await exportUtil.showSaveDialog({
                title: `导出为 ${fmt.label}`,
                defaultPath: defaultName,
                filters: fmt.filter,
            })

            if (!savePath) {
                // User cancelled the dialog
                setStatus('idle')
                return
            }

            // 3. Generate content and write
            if (selectedFormat === 'markdown') {
                const md = generateMarkdown(entries)
                await exportUtil.writeFile(savePath, md)

            } else if (selectedFormat === 'json') {
                const json = generateJSON({ entries, subjects, subject_chapters: subjectChapters, mistakes })
                await exportUtil.writeFile(savePath, json)

            } else if (selectedFormat === 'pdf') {
                const html = generatePdfHtml(entries, { title: 'MindDiary 学习报告' })
                await exportUtil.toPDF(html, savePath)
            }

            setStatus('success')
            setMessage(`已成功导出到：${savePath}`)
        } catch (err: unknown) {
            logger.error('Export failed:', err)
            setStatus('error')
            setMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`)
        }
    }

    const handleImportFile = async (file: File | null | undefined) => {
        if (!file) return
        setStatus('loading')
        setMessage('')
        try {
            const snapshot = parseMindDiaryJsonSnapshot(await file.text())
            if (
                snapshot.entries.length === 0 &&
                snapshot.subjects.length === 0 &&
                snapshot.mistakes.length === 0 &&
                snapshot.subject_chapters.length === 0
            ) {
                throw new Error('JSON 快照中没有可导入的数据。')
            }

            const subjectIdMap = new Map<number, number>()
            for (const subject of snapshot.subjects) {
                const oldId = Number(subject.id)
                const name = typeof subject.name === 'string' ? subject.name : 'Imported subject'
                const totalChapters = Math.max(0, Number.isInteger(subject.total_chapters) ? Number(subject.total_chapters) : 0)
                const completedChapters = Math.min(
                    totalChapters,
                    Math.max(0, Number.isInteger(subject.completed_chapters) ? Number(subject.completed_chapters) : 0),
                )
                const color = typeof subject.color === 'string' ? subject.color : '#0F766E'
                const created = await subjectsAPI.create({
                    name,
                    color,
                    total_chapters: totalChapters,
                })
                await subjectsAPI.update(created.id, {
                    name,
                    color,
                    total_chapters: totalChapters,
                    completed_chapters: completedChapters,
                })
                if (Number.isInteger(oldId) && oldId > 0) subjectIdMap.set(oldId, created.id)
            }

            const chaptersBySubject = new Map<number, typeof snapshot.subject_chapters>()
            for (const chapter of snapshot.subject_chapters) {
                const newSubjectId = subjectIdMap.get(chapter.subject_id)
                if (!newSubjectId) {
                    throw new Error(`章节引用的科目不存在：${chapter.subject_id}`)
                }
                const existing = chaptersBySubject.get(newSubjectId) ?? []
                existing.push(chapter)
                chaptersBySubject.set(newSubjectId, existing)
            }
            for (const [subjectId, chapters] of chaptersBySubject.entries()) {
                await subjectChaptersAPI.bulkCreate({
                    subject_id: subjectId,
                    chapters: chapters
                        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                        .map(chapter => ({
                            title: chapter.title,
                            notes: chapter.notes,
                            completed: chapter.completed,
                        })),
                })
            }

            for (const entry of snapshot.entries) {
                if (!entry.date || typeof entry.content !== 'string') continue
                await entriesAPI.create({
                    date: entry.date,
                    title: entry.title || '',
                    content: entry.content,
                    mood: entry.mood || null,
                    tags: entry.tags,
                    images: entry.images,
                })
            }

            for (const mistake of snapshot.mistakes) {
                const oldSubjectId = Number(mistake.subject_id)
                const created = await mistakesAPI.create({
                    subject_id: subjectIdMap.get(oldSubjectId) ?? null,
                    question: typeof mistake.question === 'string' ? mistake.question : '',
                    answer: typeof mistake.answer === 'string' ? mistake.answer : '',
                    notes: typeof mistake.notes === 'string' ? mistake.notes : '',
                    image_path: typeof mistake.image_path === 'string' ? mistake.image_path : null,
                    answer_image_path: typeof mistake.answer_image_path === 'string' ? mistake.answer_image_path : null,
                })
                if (mistake.mastered === true || mistake.mastered === 1) {
                    await mistakesAPI.update(created.id, { mastered: true })
                }
            }

            setStatus('success')
            setMessage(`导入完成：${snapshot.subjects.length} 个科目、${snapshot.subject_chapters.length} 个章节、${snapshot.entries.length} 篇日记、${snapshot.mistakes.length} 条错题。`)
        } catch (err: unknown) {
            logger.error('Import failed:', err)
            setStatus('error')
            setMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`)
        } finally {
            if (importInputRef.current) importInputRef.current.value = ''
        }
    }

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 'var(--z-modal)',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: 480, background: 'var(--bg-primary)',
                    borderRadius: 20, boxShadow: 'var(--shadow-xl)',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    animation: 'page-fade-in 0.25s cubic-bezier(0.2,0,0,1)',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px',
                    borderBottom: '1px solid var(--border-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Download size={18} style={{ color: 'var(--text-primary)' }} /> 导出数据</h2>
                        <p className="text-muted text-sm mt-1">选择格式，一键导出全部日记</p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            width: 32, height: 32, borderRadius: '50%',
                            border: 'none', background: 'var(--bg-tertiary)',
                            cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >×</button>
                </div>

                {/* Format selector */}
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {FORMATS.map(fmt => (
                        <label
                            key={fmt.id}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 14,
                                padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                                border: `2px solid ${selectedFormat === fmt.id ? 'var(--accent)' : 'var(--border)'}`,
                                background: selectedFormat === fmt.id ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                                transition: 'all 0.18s',
                            }}
                        >
                            <input
                                type="radio"
                                name="export-format"
                                value={fmt.id}
                                checked={selectedFormat === fmt.id}
                                onChange={() => { setSelectedFormat(fmt.id); setStatus('idle'); setMessage('') }}
                                style={{ display: 'none' }}
                            />
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32 }}>{fmt.icon}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontWeight: 600, fontSize: 15,
                                    color: selectedFormat === fmt.id ? 'var(--accent)' : 'var(--text-primary)',
                                }}>
                                    {fmt.label}
                                </div>
                                <div className="text-muted text-xs mt-1">{fmt.desc}</div>
                            </div>
                            {selectedFormat === fmt.id && (
                                <div style={{
                                    width: 20, height: 20, borderRadius: '50%',
                                    background: 'var(--accent)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'white', fontSize: 12, flexShrink: 0,
                                }}><Check size={12} /></div>
                            )}
                        </label>
                    ))}
                </div>

                {/* Status message */}
                {message && (
                    <div style={{
                        margin: '0 24px',
                        padding: '10px 14px',
                        borderRadius: 10,
                        fontSize: 13,
                        background: status === 'success' ? 'var(--bg-tertiary)' : 'rgba(198,90,58,0.08)',
                        color: status === 'success' ? 'var(--success)' : 'var(--danger)',
                        wordBreak: 'break-all',
                    }}>
                        {status === 'success' ? <><CheckCircle size={14} style={{ marginRight: 4 }} />{message}</> : <><XCircle size={14} style={{ marginRight: 4 }} />{message}</>}
                    </div>
                )}

                {/* Footer */}
                <div style={{
                    padding: '16px 24px 20px',
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                }}>
                    <button
                        className="button button-secondary"
                        style={{ borderRadius: 12 }}
                        onClick={onClose}
                        disabled={status === 'loading'}
                    >
                        取消
                    </button>
                    <button
                        className="button button-primary"
                        style={{ borderRadius: 12, minWidth: 110 }}
                        onClick={handleExport}
                        disabled={status === 'loading'}
                    >
                        {status === 'loading'
                            ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                    width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)',
                                    borderTopColor: 'white', borderRadius: '50%',
                                    animation: 'spin 0.8s linear infinite', display: 'inline-block',
                                }} />
                                导出中…
                            </span>
                            : '导出文件'}
                    </button>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        style={{ display: 'none' }}
                        onChange={event => { void handleImportFile(event.target.files?.[0]) }}
                    />
                    <button
                        className="button button-secondary"
                        style={{ borderRadius: 12 }}
                        onClick={() => importInputRef.current?.click()}
                        disabled={status === 'loading'}
                        title="导入 MindDiary JSON 快照"
                    >
                        <Upload size={15} /> 导入 JSON
                    </button>
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}
