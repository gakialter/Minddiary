import { useState } from 'react'
import { generateMarkdown, generateJSON, generatePdfHtml } from '../utils/exportUtils'
import { useDiary } from '../contexts/DiaryContext'

const FORMATS = [
    {
        id: 'pdf',
        icon: '📄',
        label: 'PDF 报告',
        desc: '带排版的可打印学习报告，中文字体原生渲染',
        ext: '.pdf',
        filter: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    },
    {
        id: 'markdown',
        icon: '📝',
        label: 'Markdown',
        desc: '含 YAML Frontmatter，兼容 Obsidian / Notion 导入',
        ext: '.md',
        filter: [{ name: 'Markdown 文件', extensions: ['md'] }],
    },
    {
        id: 'json',
        icon: '💾',
        label: 'JSON 全站备份',
        desc: '包含日记、科目、错题的完整数据快照，可用于恢复',
        ext: '.json',
        filter: [{ name: 'JSON 文件', extensions: ['json'] }],
    },
]

export default function ExportModal({ onClose }) {
    const { entries: entriesAPI, subjects: subjectsAPI, mistakes: mistakesAPI, exportUtil } = useDiary()
    const [selectedFormat, setSelectedFormat] = useState('pdf')
    const [status, setStatus] = useState('idle') // idle | loading | success | error
    const [message, setMessage] = useState('')

    const handleExport = async () => {
        setStatus('loading')
        setMessage('')

        try {
            // 1. Fetch all data needed
            const [entries, subjects, mistakes] = await Promise.all([
                entriesAPI.getAll({}),
                subjectsAPI.getAll(),
                mistakesAPI.getAll({}),
            ])

            if (!entries?.length) {
                setStatus('error')
                setMessage('暂无日记记录，请先写几篇日记再导出。')
                return
            }

            // 2. Show native Save-As dialog
            const fmt = FORMATS.find(f => f.id === selectedFormat)
            const defaultName = `MindDiary_${new Date().toISOString().split('T')[0]}${fmt.ext}`
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
                const json = generateJSON({ entries, subjects, mistakes })
                await exportUtil.writeFile(savePath, json)

            } else if (selectedFormat === 'pdf') {
                const html = generatePdfHtml(entries, { title: 'MindDiary 学习报告' })
                await exportUtil.toPDF(html, savePath)
            }

            setStatus('success')
            setMessage(`已成功导出到：${savePath}`)
        } catch (err) {
            console.error('Export failed:', err)
            setStatus('error')
            setMessage(`导出失败：${err.message}`)
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
                zIndex: 2000,
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
                        <h2 style={{ fontSize: 18, fontWeight: 700 }}>📤 导出数据</h2>
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
                            <span style={{ fontSize: 26 }}>{fmt.icon}</span>
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
                                }}>✓</div>
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
                        background: status === 'success' ? 'var(--success-light, #d1fae5)' : 'var(--error-light, #fee2e2)',
                        color: status === 'success' ? 'var(--success, #059669)' : 'var(--error, #dc2626)',
                        wordBreak: 'break-all',
                    }}>
                        {status === 'success' ? '✅ ' : '❌ '}{message}
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
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}
