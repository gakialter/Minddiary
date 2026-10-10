import { useState, useEffect, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { sanitizeSettingsForExport } from '../utils/sanitize'
import { coerceBoolean } from '../utils/helpers'
import { normalizeCountdownEvents, normalizeCountdownSettings } from '../utils/countdown'
import { getLocalDateKey } from '../utils/dateKey'
import { logger } from '../utils/logger'
import { DEFAULT_AI_MODEL } from '../data/aiProviders'
import { parseSettingsJsonBackup, prepareSettingsJsonImport } from '../utils/settingsJsonImport'
import { Settings as SettingsIcon, Check } from 'lucide-react'
import { SettingsGeneral, SettingsAI, SettingsBackup, SettingsFocus, SettingsAbout } from './SettingsSections'
import type { CountdownEvent, FocusWhitelistItem } from '../types'
import type { UpdateStatus } from '../types/api'

const ZIP_RESTORE_UNSUPPORTED_MESSAGE = '\u6b64\u529f\u80fd\u4ec5\u5728\u684c\u9762\u5ba2\u6237\u7aef\u53ef\u7528'
const ZIP_RESTORE_CONFIRM_MESSAGE = '\u6062\u590d\u81ea\u52a8\u5907\u4efd ZIP \u4f1a\u8986\u76d6\u5f53\u524d\u6570\u636e\u3001\u9644\u4ef6\u548c\u9519\u9898\u56fe\u7247\u3002\u5efa\u8bae\u5148\u624b\u52a8\u590d\u5236\u5f53\u524d\u6570\u636e\u76ee\u5f55\u3002\u662f\u5426\u7ee7\u7eed\uff1f'
const ZIP_RESTORE_IN_PROGRESS_MESSAGE = '正在恢复 ZIP 备份…'
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
  const [aiKeySaved, setAiKeySaved] = useState(false)
  const [clearKeyRequested, setClearKeyRequested] = useState(false)
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL)
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
  const keyRevisionRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveSettingsRef = useRef<(() => Promise<void>) | null>(null)
  const pendingSavesRef = useRef(0)
  const mountedRef = useRef(true)
  const jsonImportInFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; keyRevisionRef.current += 1 }
  }, [])

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
      setAiModel((settings.aiModel as string) || DEFAULT_AI_MODEL)
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

  // All settings share one debounce so input restarts an earlier ordinary
  // settings timer. Opening the credential editor itself is not a submission.
  useEffect(() => {
    if (!settingsLoaded || !countdownFieldsValid) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveSettingsRef.current?.()
    }, 500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [settingsLoaded, examDate, countdownEvents, countdownFieldsValid, aiEndpoint, aiModel, aiVisionEnabled, autoSave, pomodoroMinutes, autoBackup, backupPath, pomodoroSound, pomodoroAlert, focusGuardEnabled, focusGuardIntervalSec, focusWhitelist, aiApiKeyInput, clearKeyRequested])

  const saveSettings = (closeKeyEditor = false) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (!countdownFieldsValid) {
      showToast('请先修正主目标名称或日期', 'error')
      return Promise.resolve()
    }
    const keyRevision = keyRevisionRef.current
    const submittedKey = aiApiKeyInput.trim()
    pendingSavesRef.current += 1
    setSaving(true)
    // Serialize writes, including explicit save and autosave. An older write
    // must settle before a newer credential can be persisted.
    const save = saveQueueRef.current.then(async () => {
      if (!mountedRef.current) return
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
        if (!mountedRef.current) return
        const keyStillCurrent = keyRevision === keyRevisionRef.current
        if (clearKeyRequested && keyStillCurrent) {
          await diary.settings.updateAI({ clearAiApiKey: true, aiEndpoint, aiModel, aiVisionEnabled })
        } else if (aiKeyDirty && submittedKey && keyStillCurrent) {
          await diary.settings.updateAI({ aiApiKey: submittedKey, aiEndpoint, aiModel, aiVisionEnabled })
        } else {
          await diary.settings.updateAI({ aiEndpoint, aiModel, aiVisionEnabled })
        }
        // A completed write cannot acknowledge or erase text entered after it
        // started. The newer draft keeps its debounce and editing state.
        if (!mountedRef.current || keyRevision !== keyRevisionRef.current) return
        if (clearKeyRequested || (aiKeyDirty && submittedKey)) {
          setAiApiKeyPresent(!clearKeyRequested)
          setAiApiKeyMasked(clearKeyRequested ? null : '********')
          setAiKeySaved(true)
          // Autosave must not interrupt slow typing after a pause. Explicit
          // save finishes editing; automatic commits keep the input available.
          if (clearKeyRequested || closeKeyEditor) {
            setClearKeyRequested(false)
            setAiApiKeyInput('')
            setAiKeyDirty(false)
          }
        } else if (aiKeyDirty) {
          showToast('其他设置已保存，API Key 未保存；留空保持现有 Key', 'info')
          return
        }
        showToast('设置已保存', 'success')
      } catch {
        // Do not log an arbitrary persistence error that could include a Key.
        logger.error('Failed to save settings')
        if (mountedRef.current && keyRevision === keyRevisionRef.current) showToast('保存失败', 'error')
      }
    }).finally(() => {
      pendingSavesRef.current -= 1
      if (mountedRef.current && pendingSavesRef.current === 0) setSaving(false)
    })
    saveQueueRef.current = save
    return save
  }
  saveSettingsRef.current = saveSettings

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
      ])

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
    if (jsonImportInFlightRef.current) return
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
        if (jsonImportInFlightRef.current) return
        jsonImportInFlightRef.current = true
        const written = { entries: 0, tags: 0, subjectsCreated: 0, subjectsUpdated: 0, mistakes: 0 }
        let writeAttempted = false
        let writePending = false
        try {
          const content = event.target?.result as string
          const backup = parseSettingsJsonBackup(JSON.parse(content))

          // Basic confirmation
          const confirmImport = window.confirm(
            `解析成功！检测到版本 ${backup.version || '未知'} 的备份文件。\n` +
            `包含 ${backup.entries.length} 篇日记，${backup.mistakes.length} 道错题。\n\n` +
            `继续合并导入？同日的日记会被更新，同名科目会尝试更新，错题会新增；标签会尝试新增。`
          )

          if (!confirmImport) return

          setSaving(true)
          showToast('正在导入数据...', 'info')
          // Resolve every predictable field/reference/conflict before the first write.
          const plan = await prepareSettingsJsonImport(backup, diary)
          let importCount = 0
          let mistakeImportCount = 0
          if (backup.entries.length > 0) {
            for (const entry of backup.entries) {
              const existing = await diary.entries.getByDate(entry.date)
              writeAttempted = true
              writePending = true
              const saved = existing
                ? await diary.entries.update(existing.id, entry)
                : await diary.entries.create(entry)
              if (!saved || !Number.isSafeInteger(saved.id) || saved.id <= 0 || saved.date !== entry.date) {
                throw new Error('日记写入结果无法确认，已停止导入')
              }
              writePending = false
              importCount++
              written.entries++
            }
          }

          for (const tag of plan.tags) {
            writeAttempted = true
            writePending = true
            await diary.tags.create(tag)
            writePending = false
            written.tags++
          }

          const importedSubjectIds = new Map<number, number>()
          for (const { source, targetId } of plan.subjects) {
            // Do not pass the source's numeric identity into destination writes.
            const { id: sourceId, ...payload } = source
            let destinationId = targetId
            writeAttempted = true
            if (destinationId === undefined) {
              writePending = true
              const created = await diary.subjects.create(payload)
              if (!created || !Number.isSafeInteger(created.id) || created.id <= 0) {
                throw new Error(`科目“${source.name}”新建失败，无法建立对应关系`)
              }
              destinationId = created.id
              writePending = false
              written.subjectsCreated++
            }
            // Ordinary creation starts at zero; import explicitly restores the summary.
            writePending = true
            await diary.subjects.update(destinationId, payload)
            writePending = false
            written.subjectsUpdated++
            const saved = (await diary.subjects.getAll()).find(subject => subject.id === destinationId)
            if (!saved || saved.name !== payload.name || saved.color !== payload.color
              || saved.total_chapters !== payload.total_chapters || saved.completed_chapters !== payload.completed_chapters) {
              throw new Error(`科目“${source.name}”写入后核对失败，已停止导入`)
            }
            importedSubjectIds.set(sourceId, destinationId)
          }

          if (backup.mistakes.length > 0) {
            const importableMistakes = backup.mistakes.map((mistake, index) => {
              if (mistake.subject_id === undefined || mistake.subject_id === null) return mistake
              const mappedSubjectId = importedSubjectIds.get(mistake.subject_id)
              if (mappedSubjectId === undefined) {
                throw new Error(`第 ${index + 1} 道错题导入失败: 无法建立科目对应关系`)
              }
              return { ...mistake, subject_id: mappedSubjectId }
            })
            writeAttempted = true
            writePending = true
            await diary.mistakes.createBatch(importableMistakes)
            writePending = false
            mistakeImportCount = importableMistakes.length
            written.mistakes = mistakeImportCount
          }

          showToast(
            `导入完成，处理了 ${importCount} 篇日记、${mistakeImportCount} 道错题。${plan.skippedTags > 0 ? '同名标签已跳过。' : ''}请重启应用以刷新状态。`,
            'success',
            5000,
          )

        } catch (error: unknown) {
          logger.error('Import failed:', error)
          const progress = writeAttempted
            ? `。已返回成功的操作：写入 ${written.entries} 篇日记、${written.tags} 个标签，新建 ${written.subjectsCreated} 个科目、更新 ${written.subjectsUpdated} 个科目、追加 ${written.mistakes} 道错题。${writePending ? '失败操作的提交状态无法确定，实际写入可能多于上述计数。' : '本次导入未全部完成，已成功的操作不会自动撤销。'}请先核对数据；重新导入可能覆盖同日日记，并继续追加错题。`
            : '。本次在写入前停止，没有导入写入。'
          showToast(`导入失败: ${error instanceof Error ? error.message : String(error)}${progress}`, 'error', writeAttempted ? 10000 : 5000)
        } finally {
          jsonImportInFlightRef.current = false
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
    <div className="workspace-page workspace-page--medium settings-page" aria-busy={saving}>
      <header className="settings-page__intro">
        <div className="settings-page__title-line">
          <SettingsIcon size={20} aria-hidden="true" />
          <h1>设置</h1>
        </div>
        <p>调整外观、学习、AI 和数据选项。</p>
      </header>

      <div className="settings-page__sections">
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
        <SettingsAI
            aiEndpoint={aiEndpoint} setAiEndpoint={setAiEndpoint}
            aiApiKeyPresent={aiApiKeyPresent}
            aiApiKeyMasked={aiApiKeyMasked}
            aiApiKeyInput={aiApiKeyInput} setAiApiKeyInput={value => { keyRevisionRef.current += 1; setAiKeySaved(false); setAiApiKeyInput(value) }}
            aiKeyDirty={aiKeyDirty} setAiKeyDirty={value => { keyRevisionRef.current += 1; setAiKeyDirty(value) }}
            aiKeySaved={aiKeySaved}
            clearKeyRequested={clearKeyRequested} setClearKeyRequested={value => { keyRevisionRef.current += 1; setClearKeyRequested(value) }}
            aiModel={aiModel} setAiModel={setAiModel}
            aiVisionEnabled={aiVisionEnabled} setAiVisionEnabled={setAiVisionEnabled}
        />
        <SettingsFocus
            focusGuardEnabled={focusGuardEnabled} setFocusGuardEnabled={setFocusGuardEnabled}
            focusGuardIntervalSec={focusGuardIntervalSec} setFocusGuardIntervalSec={setFocusGuardIntervalSec}
            focusWhitelist={focusWhitelist} setFocusWhitelist={setFocusWhitelist}
        />
        <SettingsBackup
            autoBackup={autoBackup} setAutoBackup={setAutoBackup}
            backupPath={backupPath} setBackupPath={setBackupPath}
            exportData={exportData} importData={importData} restoreAutomaticBackupZip={restoreAutomaticBackupZip}
            showToast={showToast}
        />
        <SettingsAbout
            checkForUpdates={checkForUpdates}
            installUpdate={installUpdate}
            updateStatus={updateStatus}
            version={typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}
        />
      </div>

      <div className="settings-page__actions">
        <p>更改会自动保存，也可点击“保存设置”立即保存。</p>
        <button type="button" className="button button-secondary" onClick={loadSettings}>
          重新读取
        </button>
        <button type="button" className="button button-primary" onClick={() => { void saveSettings(true) }} disabled={saving || !countdownFieldsValid}>
           {saving ? '保存中...' : <><Check size={15} aria-hidden="true" /> 保存设置</>}
        </button>
      </div>
    </div>
  )
}

export default Settings
