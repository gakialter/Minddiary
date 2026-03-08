import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'

function Settings() {
  const diary = useDiary()
  const [examDate, setExamDate] = useState('2025-12-21')
  const [aiEndpoint, setAiEndpoint] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiModel, setAiModel] = useState('gpt-3.5-turbo')
  const [theme, setTheme] = useState('dark')
  const [autoSave, setAutoSave] = useState(true)
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await diary.settings.getAll()
      if (!settings) return
      setExamDate(settings.examDate || '2025-12-21')
      setAiEndpoint(settings.aiEndpoint || '')
      setAiApiKey(settings.aiApiKey || '')
      setAiModel(settings.aiModel || 'gpt-3.5-turbo')
      setTheme(settings.theme || 'dark')
      setAutoSave(settings.autoSave !== false)
      setPomodoroMinutes(parseInt(settings.pomodoroMinutes) || 25)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await diary.settings.update('examDate', examDate)
      await diary.settings.update('aiEndpoint', aiEndpoint)
      await diary.settings.update('aiApiKey', aiApiKey)
      await diary.settings.update('aiModel', aiModel)
      await diary.settings.update('theme', theme)
      await diary.settings.update('autoSave', autoSave)
      await diary.settings.update('pomodoroMinutes', pomodoroMinutes)
      showToast('设置已保存', 'success')
    } catch (error) {
      console.error('Failed to save settings:', error)
      showToast('保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const exportData = async () => {
    try {
      showToast('正在准备数据...', 'info')
      setSaving(true)

      const [entries, tags, subjects, mistakes, pomodoro] = await Promise.all([
        diary.entries.getAll({}),
        diary.tags.getAll(),
        diary.subjects.getAll(),
        diary.mistakes.getAll({}),
        diary.pomodoro.getRange('1970-01-01', '2099-12-31'),
      ]).catch(() => [[], [], [], [], []])

      const backup = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          entries, tags, subjects, mistakes, pomodoro
        }
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = url
      a.download = `MindDiary_Backup_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      showToast('导出成功', 'success')
    } catch (e) {
      console.error(e)
      showToast('导出失败: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const importData = async () => {
    // 1. Create a hidden file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return

      if (file.size > 50 * 1024 * 1024) {
        showToast('文件过大（超过 50MB），请选择有效的备份文件', 'error')
        return
      }

      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const content = event.target.result
          const backup = JSON.parse(content)

          if (!backup.data || (!backup.data.entries && !backup.data.mistakes)) {
            throw new Error('无效的备份文件格式')
          }

          // Basic confirmation
          const confirmImport = window.confirm(
            `解析成功！检测到版本 ${backup.version || '未知'} 的备份文件。\n` +
            `包含 ${backup.data.entries?.length || 0} 篇日记，${backup.data.mistakes?.length || 0} 道错题。\n\n` +
            `是否要继续合并导入？(这将会追加不存在的记录，并覆盖相同ID的记录)`
          )

          if (!confirmImport) return

          setSaving(true)
          showToast('正在导入数据...', 'info')

          // Naive Import: Use unified API if available or mockApi
          const data = backup.data
          let importCount = 0

          if (data.entries) {
            for (const entry of data.entries) {
              const existing = await diary.entries.getByDate(entry.date)
              if (existing) {
                await diary.entries.update(existing.id, entry)
              } else {
                await diary.entries.create(entry)
              }
              importCount++
            }
          }

          // Similar for tags, subjects, mistakes... (omitted for brevity, assume simple creation)
          if (data.tags) {
            for (const tag of data.tags) {
              await diary.tags.create(tag).catch(() => { }) // Ignore duplicate names
            }
          }

          if (data.subjects) {
            const existingSubjects = await diary.subjects.getAll()
            for (const sub of data.subjects) {
              const match = existingSubjects.find(s => s.name === sub.name)
              if (match) {
                await diary.subjects.update(match.id, sub).catch(() => { })
              } else {
                await diary.subjects.create(sub).catch(() => { })
              }
            }
          }

          if (data.mistakes) {
            // Append mistakes directly
            for (const mis of data.mistakes) {
              await diary.mistakes.create(mis).catch(() => { })
            }
          }

          showToast(`导入完成，处理了 ${importCount} 篇日记。请重启应用以刷新状态。`, 'success', 5000)

        } catch (error) {
          console.error('Import failed:', error)
          showToast(`导入失败: ${error.message}`, 'error')
        } finally {
          setSaving(false)
        }
      }
      reader.readAsText(file)
    }

    input.click()
  }

  const sectionStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-lg)',
  }

  const labelStyle = {
    display: 'block', fontSize: 13, color: 'var(--text-muted)',
    marginBottom: 'var(--space-sm)',
  }

  const fieldGroupStyle = {
    display: 'flex', flexDirection: 'column', gap: 'var(--space-md)',
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 className="text-xl font-semibold" style={{ marginBottom: 'var(--space-lg)' }}>⚙️ 设置</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
        {/* General settings */}
        <div style={sectionStyle}>
          <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16 }}>📋 基本设置</h3>
          <div style={fieldGroupStyle}>
            <div>
              <label style={labelStyle}>考研日期</label>
              <input
                type="date" className="input w-full"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>主题</label>
              <select className="input w-full" value={theme} onChange={(e) => {
                const newTheme = e.target.value
                setTheme(newTheme)

                // Instant preview
                if (newTheme === 'dark') {
                  document.documentElement.setAttribute('data-theme', 'dark')
                } else if (newTheme === 'light') {
                  document.documentElement.removeAttribute('data-theme')
                } else {
                  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    document.documentElement.setAttribute('data-theme', 'dark')
                  } else {
                    document.documentElement.removeAttribute('data-theme')
                  }
                }
              }}>
                <option value="light">亮色模式</option>
                <option value="dark">暗色模式</option>
                <option value="auto">跟随系统</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>番茄钟时长（分钟）</label>
              <input
                type="number" className="input w-full"
                min={1} max={120}
                value={pomodoroMinutes}
                onChange={(e) => setPomodoroMinutes(Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={autoSave}
                  onChange={(e) => setAutoSave(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                <span className="text-sm">启用自动保存</span>
              </label>
            </div>
          </div>
        </div>

        {/* AI settings */}
        <div style={sectionStyle}>
          <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16 }}>🤖 AI 助手设置</h3>
          <div style={fieldGroupStyle}>
            <div>
              <label style={labelStyle}>API Endpoint</label>
              <input
                type="text" className="input w-full"
                placeholder="https://api.openai.com/v1"
                value={aiEndpoint}
                onChange={(e) => setAiEndpoint(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>API Key</label>
              <input
                type="password" className="input w-full"
                placeholder="sk-..."
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>模型</label>
              <select className="input w-full" value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="qwen-turbo">Qwen Turbo</option>
              </select>
            </div>
            <div className="text-xs text-muted">
              留空则不启用 AI 功能。支持 OpenAI 兼容的 API（DeepSeek、Qwen 等）。
            </div>
          </div>
        </div>

        {/* Data management */}
        <div style={sectionStyle}>
          <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16 }}>💾 数据管理</h3>
          <div style={fieldGroupStyle}>
            <div>
              <label style={labelStyle}>导出数据</label>
              <button className="button button-secondary w-full" onClick={exportData}>
                📦 导出为 JSON
              </button>
            </div>
            <div>
              <label style={labelStyle}>导入数据</label>
              <button className="button button-secondary w-full" onClick={importData}>
                📂 从 JSON 导入
              </button>
            </div>
            <div className="text-xs text-muted">
              数据全部存储在本地，导出可做备份。
            </div>
          </div>
        </div>

        {/* About */}
        <div style={sectionStyle}>
          <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16 }}>ℹ️ 关于</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <div className="text-sm">
              <span className="text-muted">版本：</span> <span>1.0.0</span>
            </div>
            <div className="text-sm">
              <span className="text-muted">存储：</span> <span>SQLite 本地数据库</span>
            </div>
            <div className="text-sm">
              <span className="text-muted">隐私：</span> <span>数据完全本地存储，无网络请求</span>
            </div>
            <div className="text-xs text-muted" style={{ paddingTop: 12 }}>
              MindDiary · 专为考研学生设计的日记应用
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end gap-sm" style={{ marginTop: 'var(--space-lg)' }}>
        <button className="button button-secondary" onClick={loadSettings}>
          重置
        </button>
        <button className="button button-primary" onClick={saveSettings} disabled={saving}>
          {saving ? '保存中...' : '✅ 保存设置'}
        </button>
      </div>
    </div>
  )
}

export default Settings