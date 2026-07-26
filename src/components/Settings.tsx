import { useState, useEffect, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { sanitizeSettingsForExport } from '../utils/sanitize'
import { coerceBoolean } from '../utils/helpers'
import { normalizeCountdownEvents, normalizeCountdownSettings } from '../utils/countdown'
import { getLocalDateKey } from '../utils/dateKey'
import { logger } from '../utils/logger'
import {
  validateMistakeWritePayload,
  type MistakeWritePayload,
} from '../utils/mistakePayload'
import { Settings as SettingsIcon, Check } from 'lucide-react'
import { SettingsGeneral, SettingsAI, SettingsBackup, SettingsFocus, SettingsAbout } from './SettingsSections'
import type { CountdownEvent, FocusWhitelistItem } from '../types'
import type { UpdateStatus } from '../types/api'

const ZIP_RESTORE_UNSUPPORTED_MESSAGE = '\u6b64\u529f\u80fd\u4ec5\u5728\u684c\u9762\u5ba2\u6237\u7aef\u53ef\u7528'
const ZIP_RESTORE_CONFIRM_MESSAGE = '\u6062\u590d\u81ea\u52a8\u5907\u4efd ZIP \u4f1a\u8986\u76d6\u5f53\u524d\u6570\u636e\u3001\u9644\u4ef6\u548c\u9519\u9898\u56fe\u7247\u3002\u5efa\u8bae\u5148\u624b\u52a8\u590d\u5236\u5f53\u524d\u6570\u636e\u76ee\u5f55\u3002\u662f\u5426\u7ee7\u7eed\uff1f'
const ZIP_RESTORE_IN_PROGRESS_MESSAGE = '\u6b63\u5728\u6062\u590d\u81ea\u52a8\u5907\u4efd ZIP...'
const ZIP_RESTORE_SUCCESS_MESSAGE = '\u6062\u590d\u6210\u529f\uff0c\u8bf7\u91cd\u542f\u5e94\u7528\u6216\u5237\u65b0\u6570\u636e\u3002'
const ZIP_RESTORE_FAILED_PREFIX = '\u6062\u590d\u5931\u8d25'
const ZIP_RESTORE_UNKNOWN_ERROR = '\u672a\u77e5\u9519\u8bef'

function normalizeFocusWhitelist(value: unknown): FocusWhitelistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const candidate = item as Partial<FocusWhitelistItem>
    if (!candidate.id || !candidate.name || typeof candidate.enabled !== 'boolean' || !candidate.createdAt) return []
    return [{
      id: String(candidate.id),
      name: String(candidate.name),
      ...(candidate.processName ? { processName: String(candidate.processName) } : {}),
      ...(candidate.executable ? { executable: String(candidate.executable) } : {}),
      enabled: candidate.enabled,
      createdAt: String(candidate.createdAt),
    }]
  })
}

function Settings() {
  const diary = useDiary()
  const [examDate, setExamDate] = useState('2025-12-21')
  const [countdownEvents, setCountdownEvents] = useState<CountdownEvent[]>([])
  const [aiEndpoint, setAiEndpoint] = useState('')
  const [aiApiKeyInput, setAiApiKeyInput] = useState('')
  const [aiApiKeyPresent, setAiApiKeyPresent] = useState(false)
  const [aiApiKeyMasked, setAiApiKeyMasked] = useState<string | null>(null)
  const [aiKeyDirty, setAiKeyDirty] = useState(false)
  const [clearKeyRequested, setClearKeyRequested] = useState(false)
  const [aiModel, setAiModel] = useState('deepseek-v4-flash')
  const [aiVisionEnabled, setAiVisionEnabled] = useState(false)
  const [autoSave, setAutoSave] = useState(true)
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25)
  const [autoBackup, setAutoBackup] = useState(false)
  const [backupPath, setBackupPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [pomodoroSound, setPomodoroSound] = useState(true)
  const [pomodoroAlert, setPomodoroAlert] = useState(true)
  const [focusGuardEnabled, setFocusGuardEnabled] = useState(false)
  const [focusGuardIntervalSec, setFocusGuardIntervalSec] = useState(5)
  const [focusWhitelist, setFocusWhitelist] = useState<FocusWhitelistItem[]>([])
  const [countdownFieldsValid, setCountdownFieldsValid] = useState(true)
  const [countdownResetVersion, setCountdownResetVersion] = useState(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  // Subscribe to updater status pushed from main process
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    
    // Fetch initial cached status before subscribing
    if (window.api?.updater?.getStatus) {
      window.api.updater.getStatus().then(status => {
        setUpdateStatus(current => {
          // Only apply initial status if we haven't already received a push event
          return current.status === 'idle' ? status : current
        })
      }).catch(err => console.error('Failed to get updater status', err))
    }

    if (window.api?.updater?.onStatusChange) {
      cleanup = window.api.updater.onStatusChange((status: UpdateStatus) => {
        setUpdateStatus(status);
      });
    }
    return () => {
      if (cleanup) cleanup();
    };
  }, [])

  // Auto-clear "not-available" after 5 seconds
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (updateStatus.status === 'not-available') {
      timer = setTimeout(() => setUpdateStatus({ status: 'idle' }), 5000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [updateStatus.status])

  const loadSettings = async () => {
    try {
      const settings = await diary.settings.getAll()
      if (!settings) return
      const normalizedCountdown = normalizeCountdownSettings(settings.countdownEvents, settings.examDate)
      const loadedExamDate = normalizedCountdown.examDate || '2025-12-21'
      setExamDate(loadedExamDate)
      setCountdownEvents(normalizeCountdownEvents(normalizedCountdown.countdownEvents, loadedExamDate))
      setAiEndpoint((settings.aiEndpoint as string) || '')
      setAiApiKeyPresent(settings.aiApiKeyPresent)
      setAiApiKeyMasked(settings.aiApiKeyMasked || null)
      setAiModel((settings.aiModel as string) || 'deepseek-v4-flash')
      setAiVisionEnabled(coerceBoolean(settings.aiVisionEnabled, false))
      setAutoSave(coerceBoolean(settings.autoSave, true))
      setPomodoroMinutes(parseInt(String(settings.pomodoroMinutes)) || 25)
      setAutoBackup(coerceBoolean(settings.autoBackup, false))
      setBackupPath((settings.backupPath as string) || '')
      setPomodoroSound(coerceBoolean(settings.pomodoroSound, true))
      setPomodoroAlert(coerceBoolean(settings.pomodoroAlert, true))
      setFocusGuardEnabled(coerceBoolean(settings.focusGuardEnabled, false))
      setFocusGuardIntervalSec(Math.max(3, Math.min(30, parseInt(String(settings.focusGuardIntervalSec)) || 5)))
      setFocusWhitelist(normalizeFocusWhitelist(settings.focusWhitelist))
      setCountdownResetVersion(version => version + 1)
      setSettingsLoaded(true)
    } catch (error) {
      logger.error('Failed to load settings:', error)
    }
  }

  // Auto-save: debounced 500ms (only after initial load)
  useEffect(() => {
    if (!settingsLoaded || !countdownFieldsValid) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveSettings()
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [examDate, countdownEvents, countdownFieldsValid, aiEndpoint, aiModel, aiVisionEnabled, autoSave, pomodoroMinutes, autoBackup, backupPath, pomodoroSound, pomodoroAlert, focusGuardEnabled, focusGuardIntervalSec, focusWhitelist, aiKeyDirty, clearKeyRequested])

  const saveSettings = async () => {
    if (!countdownFieldsValid) {
      showToast('请先修正主目标名称或日期', 'error')
      return
    }
    setSaving(true)
    try {
      await Promise.all([
        diary.settings.updateGeneral({
          examDate,
          countdownEvents: normalizeCountdownEvents(countdownEvents, examDate),
          theme: diary.theme,
          pomodoroMinutes, autoSave, pomodoroSound, pomodoroAlert,
          focusGuardEnabled, focusGuardIntervalSec, focusWhitelist,
        }),
        diary.settings.updateBackup({ autoBackup, backupPath }),
      ])
      if (clearKeyRequested) {
        await diary.settings.updateAI({ clearAiApiKey: true, aiEndpoint, aiModel, aiVisionEnabled })
        setClearKeyRequested(false)
        setAiApiKeyInput('')
        setAiApiKeyPresent(false)
        setAiApiKeyMasked(null)
      } else if (aiKeyDirty && aiApiKeyInput) {
        await diary.settings.updateAI({ aiApiKey: aiApiKeyInput, aiEndpoint, aiModel, aiVisionEnabled })
        setAiApiKeyInput('')
        setAiApiKeyPresent(true)
        // Placeholder until next getAll() returns real mask from main process
        setAiApiKeyMasked('********')
      } else {
        await diary.settings.updateAI({ aiEndpoint, aiModel, aiVisionEnabled })
      }
      setAiKeyDirty(false)
      showToast('设置已保存', 'success')
    } catch (error) {
      logger.error('Failed to save settings:', error)
      showToast('保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const exportData = async () => {
    try {
      showToast('正在准备数据...', 'info')
      setSaving(true)

      const [entries, tags, subjects, mistakes, pomodoro, allSettings] = await Promise.all([
        diary.entries.getAll({ includeContent: true }),
        diary.tags.getAll(),
        diary.subjects.getAll(),
        diary.mistakes.getAll({}),
        diary.pomodoro.getRange('1970-01-01', '2099-12-31'),
        diary.settings.getAll(),
      ]).catch(() => [[], [], [], [], [], {}] as const) as [unknown, unknown, unknown, unknown, unknown, unknown]

      const backup = {
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          entries, tags, subjects, 
          mistakes: mistakes && typeof mistakes === 'object' && 'data' in mistakes
            ? (mistakes as { data: unknown }).data
            : mistakes,
          pomodoro,
          settings: sanitizeSettingsForExport(allSettings as Record<string, unknown>),
        }
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = url
      a.download = `MindDiary_Backup_${getLocalDateKey()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      showToast('导出成功', 'success')
    } catch (e: unknown) {
      logger.error(e)
      showToast('导出失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setSaving(false)
    }
  }

  const importData = async () => {
    // 1. Create a hidden file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement
      const file = target.files?.[0]
      if (!file) return

      // TODO: support restoring automatic zip backups from manifest.json, database.json, and media entries.
      if (file.name.toLowerCase().endsWith('.zip')) {
        showToast('自动备份 ZIP 当前不能直接导入；请保留该灾备包，后续版本会提供恢复入口。', 'error')
        return
      }

      if (!file.name.toLowerCase().endsWith('.json')) {
        showToast('请选择 JSON 备份文件；自动备份 ZIP 当前不支持直接导入。', 'error')
        return
      }

      if (file.size > 50 * 1024 * 1024) {
        showToast('文件过大（超过 50MB），请选择有效的备份文件', 'error')
        return
      }

      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string
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

          const data = backup.data
          let importCount = 0
          let mistakeImportCount = 0
          const validatedMistakes: MistakeWritePayload[] = Array.isArray(data.mistakes)
            ? data.mistakes.map((mistake: unknown, index: number) => {
                try {
                  return validateMistakeWritePayload(mistake)
                } catch (error: unknown) {
                  throw new Error(
                    `第 ${index + 1} 道错题导入失败: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              })
            : []

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

          if (data.tags) {
            for (const tag of data.tags) {
              await diary.tags.create(tag).catch(() => { })
            }
          }

          const importedSubjectIds = new Map<number, number>()
          if (data.subjects) {
            const existingSubjects = await diary.subjects.getAll()
            for (const sub of data.subjects) {
              const match = (existingSubjects || []).find((s: { name: string }) => s.name === sub.name)
              if (match) {
                await diary.subjects.update(match.id, sub).catch(() => { })
                if (typeof sub.id === 'number' && Number.isInteger(sub.id) && sub.id > 0) {
                  importedSubjectIds.set(sub.id, match.id)
                }
              } else {
                const created = await diary.subjects.create(sub).catch(() => null)
                if (created && typeof sub.id === 'number' && Number.isInteger(sub.id) && sub.id > 0) {
                  importedSubjectIds.set(sub.id, created.id)
                }
              }
            }
          }

          if (validatedMistakes.length > 0) {
            const destinationSubjectIds = new Set(
              (await diary.subjects.getAll()).map(subject => subject.id),
            )
            const importableMistakes = validatedMistakes.map((mistake: MistakeWritePayload, index: number) => {
              if (mistake.subject_id === undefined || mistake.subject_id === null) return mistake
              const mappedSubjectId = importedSubjectIds.get(mistake.subject_id)
              if (mappedSubjectId !== undefined) {
                return { ...mistake, subject_id: mappedSubjectId }
              }
              if (!destinationSubjectIds.has(mistake.subject_id)) {
                throw new Error(
                  `第 ${index + 1} 道错题导入失败: 引用的科目不存在`,
                )
              }
              return mistake
            })
            await diary.mistakes.createBatch(importableMistakes)
            mistakeImportCount = importableMistakes.length
          }

          showToast(
            `导入完成，处理了 ${importCount} 篇日记、${mistakeImportCount} 道错题。请重启应用以刷新状态。`,
            'success',
            5000,
          )

        } catch (error: unknown) {
          logger.error('Import failed:', error)
          showToast(`导入失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
        } finally {
          setSaving(false)
        }
      }
      reader.readAsText(file)
    }

    input.click()
  }

  const restoreAutomaticBackupZip = async () => {
    if (!diary.settings.selectBackupFile || !diary.settings.restoreBackupFromZip) {
      showToast(ZIP_RESTORE_UNSUPPORTED_MESSAGE, 'error')
      return
    }

    const filepath = await diary.settings.selectBackupFile()
    if (!filepath) return
    if (!window.confirm(ZIP_RESTORE_CONFIRM_MESSAGE)) return

    try {
      setSaving(true)
      showToast(ZIP_RESTORE_IN_PROGRESS_MESSAGE, 'info')
      const result = await diary.settings.restoreBackupFromZip(filepath)
      if (!result.success) {
        throw new Error(result.message || ZIP_RESTORE_UNKNOWN_ERROR)
      }
      diary.requestDataRefresh?.()
      showToast(ZIP_RESTORE_SUCCESS_MESSAGE, 'success', 5000)
    } catch (error: unknown) {
      logger.error('Automatic ZIP restore failed:', error)
      showToast(`${ZIP_RESTORE_FAILED_PREFIX}: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const checkForUpdates = async () => {
    if (!window.api?.updater?.check) {
      showToast('此功能仅在桌面客户端可用', 'error')
      return
    }

    try {
      const res = await window.api.updater.check()
      if (!res.success) {
        setUpdateStatus({
          status: res.status === 'auto-update-not-configured' ? 'auto-update-not-configured' : 'error',
          message: res.message || '环境不支持自动更新',
        })
      }
      // On success, main process pushes status via onStatusChange
    } catch {
      setUpdateStatus({ status: 'error', message: '更新检查失败，请重试' })
    }
  }

  const installUpdate = async () => {
    if (window.api?.updater?.install) {
      await window.api.updater.install()
    }
  }


  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 className="text-xl font-semibold" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <SettingsIcon size={22} style={{ color: 'var(--accent)' }} /> 设置
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 'var(--space-md)' }}>
        <SettingsAI
            aiEndpoint={aiEndpoint} setAiEndpoint={setAiEndpoint}
            aiApiKeyPresent={aiApiKeyPresent}
            aiApiKeyMasked={aiApiKeyMasked}
            aiApiKeyInput={aiApiKeyInput} setAiApiKeyInput={setAiApiKeyInput}
            aiKeyDirty={aiKeyDirty} setAiKeyDirty={setAiKeyDirty}
            clearKeyRequested={clearKeyRequested} setClearKeyRequested={setClearKeyRequested}
            aiModel={aiModel} setAiModel={setAiModel}
            aiVisionEnabled={aiVisionEnabled} setAiVisionEnabled={setAiVisionEnabled}
        />
        <SettingsGeneral 
            examDate={examDate} setExamDate={setExamDate}
            countdownEvents={countdownEvents} setCountdownEvents={setCountdownEvents}
            onCountdownValidityChange={setCountdownFieldsValid}
            countdownResetVersion={countdownResetVersion}
            theme={diary.theme} changeTheme={diary.changeTheme}
            pomodoroMinutes={pomodoroMinutes} setPomodoroMinutes={setPomodoroMinutes}
            pomodoroSound={pomodoroSound} setPomodoroSound={setPomodoroSound}
            pomodoroAlert={pomodoroAlert} setPomodoroAlert={setPomodoroAlert}
            autoSave={autoSave} setAutoSave={setAutoSave}
        />
        <SettingsBackup 
            autoBackup={autoBackup} setAutoBackup={setAutoBackup}
            backupPath={backupPath} setBackupPath={setBackupPath}
            exportData={exportData} importData={importData} restoreAutomaticBackupZip={restoreAutomaticBackupZip}
            showToast={showToast}
        />
        <SettingsFocus
            focusGuardEnabled={focusGuardEnabled} setFocusGuardEnabled={setFocusGuardEnabled}
            focusGuardIntervalSec={focusGuardIntervalSec} setFocusGuardIntervalSec={setFocusGuardIntervalSec}
            focusWhitelist={focusWhitelist} setFocusWhitelist={setFocusWhitelist}
        />
        <SettingsAbout 
            checkForUpdates={checkForUpdates}
            installUpdate={installUpdate}
            updateStatus={updateStatus}
            version={typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}
        />
      </div>

      {/* Save button */}
      <div className="flex justify-end gap-sm" style={{ marginTop: 'var(--space-lg)' }}>
        <button className="button button-secondary" onClick={loadSettings}>
          重置
        </button>
        <button className="button button-primary" onClick={saveSettings} disabled={saving || !countdownFieldsValid}>
           {saving ? '保存中...' : <><Check size={15} /> 保存设置</>}
        </button>
      </div>
    </div>
  )
}

export default Settings
