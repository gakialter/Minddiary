import React, { useState, useMemo } from 'react'
import { ClipboardList, Bot, Database, Info, Package, FolderOpen, RefreshCw, ChevronDown, ExternalLink, Search, X, CheckCircle, AlertTriangle, Download, RotateCw, ShieldCheck, Plus, Trash2, Monitor } from 'lucide-react'
import { AI_PROVIDERS, getProvider, getProviderByModel, getTagColor } from '../data/aiProviders'
import type { AIProvider, AIModel } from '../data/aiProviders'
import CountdownEventsManager from './CountdownEventsManager'
import type { ActiveAppInfo, CountdownEvent, FocusWhitelistItem } from '../types'
import type { UpdateStatus } from '../types/api'

interface SettingsGeneralProps {
  examDate: string; setExamDate: (v: string) => void
  countdownEvents: CountdownEvent[]; setCountdownEvents: (v: CountdownEvent[]) => void
  theme: string; changeTheme: (v: string) => void
  pomodoroMinutes: number; setPomodoroMinutes: (v: number) => void
  pomodoroSound: boolean; setPomodoroSound: (v: boolean) => void
  pomodoroAlert: boolean; setPomodoroAlert: (v: boolean) => void
  autoSave: boolean; setAutoSave: (v: boolean) => void
}

interface SettingsAIProps {
  aiEndpoint: string; setAiEndpoint: (v: string) => void
  aiApiKeyPresent: boolean
  aiApiKeyMasked: string | null
  aiApiKeyInput: string; setAiApiKeyInput: (v: string) => void
  aiKeyDirty: boolean; setAiKeyDirty: (v: boolean) => void
  clearKeyRequested: boolean; setClearKeyRequested: (v: boolean) => void
  aiModel: string; setAiModel: (v: string) => void
}

interface SettingsBackupProps {
  autoBackup: boolean; setAutoBackup: (v: boolean) => void
  backupPath: string; setBackupPath: (v: string) => void
  exportData: () => Promise<void>
  importData: () => Promise<void>
  showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => number
}

function createFocusWhitelistId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `focus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface SettingsFocusProps {
  focusGuardEnabled: boolean; setFocusGuardEnabled: (v: boolean) => void
  focusGuardIntervalSec: number; setFocusGuardIntervalSec: (v: number) => void
  focusWhitelist: FocusWhitelistItem[]; setFocusWhitelist: (v: FocusWhitelistItem[]) => void
}

function basenameOnly(value: string | undefined): string | undefined {
    if (!value) return undefined
    const normalized = value.replace(/\\/g, '/')
    return normalized.split('/').filter(Boolean).pop() || value
}

function toFocusWhitelistItem(app: ActiveAppInfo): FocusWhitelistItem {
    const executable = basenameOnly(app.executable)
    const name = app.name || app.processName || executable || '未知应用'
    return {
        id: createFocusWhitelistId(),
        name: name.trim().slice(0, 160),
        ...(app.processName ? { processName: app.processName.trim().slice(0, 160) } : {}),
        ...(executable ? { executable: executable.trim().slice(0, 160) } : {}),
        enabled: true,
        createdAt: new Date().toISOString(),
    }
}

function toManualWhitelistItem(value: string): FocusWhitelistItem {
    const trimmed = value.trim().slice(0, 160)
    const looksLikeProcess = /\.[a-z0-9]{2,5}$/i.test(trimmed)
    return {
        id: createFocusWhitelistId(),
        name: trimmed,
        ...(looksLikeProcess ? { processName: trimmed } : {}),
        enabled: true,
        createdAt: new Date().toISOString(),
    }
}

function isSameWhitelistTarget(a: FocusWhitelistItem, b: FocusWhitelistItem): boolean {
    const normalize = (value: string | undefined) => (value || '').trim().toLowerCase()
    return (!!a.processName && normalize(a.processName) === normalize(b.processName))
        || (!!a.executable && normalize(a.executable) === normalize(b.executable))
        || normalize(a.name) === normalize(b.name)
}

function isMindDiaryApp(app: ActiveAppInfo): boolean {
    return [app.name, app.processName, app.executable]
        .map(value => (value || '').toLowerCase())
        .some(value => value.includes('minddiary') || value.includes('mind diary') || value.includes('electron'))
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms))
}

interface SettingsAboutProps {
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  updateStatus: UpdateStatus
  version: string
}

const sectionStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-lg)',
}

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, color: 'var(--text-muted)',
    marginBottom: 'var(--space-sm)',
}

const fieldGroupStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 'var(--space-md)',
}

export function SettingsGeneral({
    examDate, setExamDate,
    countdownEvents, setCountdownEvents,
    theme, changeTheme,
    pomodoroMinutes, setPomodoroMinutes,
    pomodoroSound, setPomodoroSound,
    pomodoroAlert, setPomodoroAlert,
    autoSave, setAutoSave
}: SettingsGeneralProps) {
    return (
        <div style={sectionStyle}>
            <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClipboardList size={16} /> 基本设置
            </h3>
            <div style={fieldGroupStyle}>
                <CountdownEventsManager
                    examDate={examDate}
                    setExamDate={setExamDate}
                    events={countdownEvents}
                    setEvents={setCountdownEvents}
                />
                <div>
                    <label style={labelStyle}>主题</label>
                    <select className="input w-full" value={theme} onChange={(e) => changeTheme(e.target.value)}>
                        <option value="system">跟随系统</option>
                        <option value="light">亮色模式</option>
                        <option value="dark">暗色模式</option>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                        <input
                            type="checkbox" checked={pomodoroSound}
                            onChange={(e) => setPomodoroSound(e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                        />
                        <span className="text-sm">计时结束音效提示</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                        <input
                            type="checkbox" checked={pomodoroAlert}
                            onChange={(e) => setPomodoroAlert(e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                        />
                        <span className="text-sm">计时结束弹窗提示（适合看网课时使用）</span>
                    </label>
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
    )
}

/* ──────────────────────────────────────────────────────
   AI Settings — CC-Switch inspired provider+model UI
   ────────────────────────────────────────────────────── */

export function SettingsFocus({
    focusGuardEnabled, setFocusGuardEnabled,
    focusGuardIntervalSec, setFocusGuardIntervalSec,
    focusWhitelist, setFocusWhitelist,
}: SettingsFocusProps) {
    const [manualApp, setManualApp] = useState('')
    const [feedback, setFeedback] = useState('')
    const currentPlatform = window.api?.window?.platform || ''
    const isWindowsPlatform = currentPlatform === 'win32'

    const addWhitelistItem = (item: FocusWhitelistItem) => {
        const withoutDuplicate = focusWhitelist.filter(existing => !isSameWhitelistTarget(existing, item))
        setFocusWhitelist([...withoutDuplicate, item])
    }

    const addCurrentApp = async () => {
        if (!isWindowsPlatform) {
            setFeedback('当前平台暂不支持自动捕获前台应用，请手动输入应用名称或进程名。')
            return
        }
        setFeedback('')
        try {
            setFeedback('3 秒后捕获前台应用，请切换到目标应用窗口。')
            await delay(3000)
            const app = await window.api?.focusGuard?.getActiveApp?.()
            if (!app) {
                setFeedback('无法读取当前应用，可手动添加。')
                return
            }
            if (isMindDiaryApp(app)) {
                setFeedback('捕获到的是 MindDiary 自身，请切到目标应用后重试，或手动输入进程名。')
                return
            }
            addWhitelistItem(toFocusWhitelistItem(app))
            setFeedback(`已捕获：${app.processName || app.executable || app.name}`)
        } catch (error) {
            console.error('[focusGuard][settings] getActiveApp error', error instanceof Error ? error.message : String(error))
            setFeedback('无法读取当前应用，可手动添加。')
        }
    }

    const addManualApp = () => {
        const value = manualApp.trim()
        if (!value) return
        addWhitelistItem(toManualWhitelistItem(value))
        setManualApp('')
    }

    return (
        <div style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
            <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={16} /> 专注模式
            </h3>
            <div style={fieldGroupStyle}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={focusGuardEnabled}
                        onChange={(e) => setFocusGuardEnabled(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                    />
                    <span className="text-sm font-semibold">启用专注白名单提醒</span>
                </label>

                <div className="text-xs text-muted" style={{ lineHeight: 1.6 }}>
                    开启后，番茄钟专注期间只提醒不在白名单内的应用。建议先加入网课、资料、输入法、浏览器或常用学习工具。
                </div>

                {!isWindowsPlatform && (
                    <div
                        data-testid="focus-guard-platform-hint"
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-light)',
                            lineHeight: 1.6,
                        }}
                    >
                        <Monitor size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span className="text-xs" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                                当前平台暂未完整支持前台应用检测
                            </span>
                            <span className="text-xs text-muted">
                                你仍可以配置白名单，但系统可能无法准确判断当前应用。Windows 版本支持更完整的专注提醒。
                            </span>
                        </div>
                    </div>
                )}

                <div>
                    <label htmlFor="focus-guard-interval" style={labelStyle}>检测间隔（秒）</label>
                    <input
                        id="focus-guard-interval"
                        type="number"
                        min={3}
                        max={30}
                        className="input"
                        style={{ width: 120 }}
                        value={focusGuardIntervalSec}
                        onChange={(e) => {
                            const next = Math.max(3, Math.min(30, Number(e.target.value) || 5))
                            setFocusGuardIntervalSec(next)
                        }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 220px' }}>
                        <label htmlFor="focus-guard-manual-app" style={labelStyle}>应用名称或进程名</label>
                        <input
                            id="focus-guard-manual-app"
                            className="input w-full"
                            value={manualApp}
                            onChange={(e) => setManualApp(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    addManualApp()
                                }
                            }}
                            placeholder="例如 chrome.exe 或 Zotero"
                        />
                    </div>
                    <button
                        type="button"
                        className="button button-secondary"
                        onClick={addCurrentApp}
                        disabled={!isWindowsPlatform}
                        title={isWindowsPlatform ? undefined : '当前平台暂不支持自动捕获前台应用'}
                        style={!isWindowsPlatform ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                    >
                        <Plus size={15} /> 添加当前应用
                    </button>
                    <button type="button" className="button button-primary" onClick={addManualApp}>
                        手动添加
                    </button>
                </div>

                {feedback && <div className="text-xs text-muted">{feedback}</div>}

                {focusWhitelist.length === 0 ? (
                    <div className="text-xs text-muted" style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', lineHeight: 1.6 }}>
                        当前没有白名单，除 MindDiary 外的应用都会触发提醒。
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {focusWhitelist.map(item => (
                            <div
                                key={item.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                    padding: '8px 10px',
                                    border: '1px solid var(--border-light)',
                                    borderRadius: 'var(--radius-sm)',
                                    background: 'var(--bg-primary)',
                                }}
                            >
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                                    <input
                                        type="checkbox"
                                        checked={item.enabled}
                                        onChange={(e) => setFocusWhitelist(focusWhitelist.map(current => (
                                            current.id === item.id ? { ...current, enabled: e.target.checked } : current
                                        )))}
                                        aria-label={`${item.enabled ? '停用' : '启用'} ${item.name}`}
                                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                                    />
                                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                        <span className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.name}</span>
                                        <span className="text-xs text-muted">{item.processName || item.executable || '仅按应用名称匹配'}</span>
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    className="button button-secondary"
                                    aria-label={`删除 ${item.name}`}
                                    title={`删除 ${item.name}`}
                                    onClick={() => setFocusWhitelist(focusWhitelist.filter(current => current.id !== item.id))}
                                    style={{ width: 32, height: 32, padding: 0, borderRadius: 16, flexShrink: 0 }}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function ProviderChip({ provider, active, onClick }: {
  provider: AIProvider; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 'var(--radius)',
        border: active ? `2px solid var(--accent)` : '1px solid var(--border)',
        background: active ? `var(--accent-light)` : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
      }}
    >
      <span>{provider.name}</span>
    </button>
  )
}

function ModelCard({ model, active, onClick }: {
  model: AIModel; active: boolean; onClick: () => void
}) {
  const tagColors = model.tag ? getTagColor(model.tag) : null
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: 'var(--radius-sm)',
        border: active ? `2px solid var(--accent)` : '1px solid var(--border)',
        background: active ? `var(--accent-light)` : 'var(--bg-primary)',
        cursor: 'pointer', width: '100%', textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {active && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--accent)', flexShrink: 0,
            }} />
          )}
          <span style={{
            fontSize: 13, fontWeight: active ? 600 : 500,
            color: active ? 'var(--accent)' : 'var(--text-primary)',
          }}>
            {model.name}
          </span>
          {model.tag && tagColors && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px',
              borderRadius: 4, background: tagColors.bg, color: tagColors.text,
              lineHeight: '16px',
            }}>
              {model.tag}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>
          {model.desc}
        </span>
      </div>
    </button>
  )
}

export function SettingsAI({
    aiEndpoint, setAiEndpoint,
    aiApiKeyPresent, aiApiKeyMasked,
    aiApiKeyInput, setAiApiKeyInput,
    aiKeyDirty, setAiKeyDirty,
    clearKeyRequested, setClearKeyRequested,
    aiModel, setAiModel
}: SettingsAIProps) {
    // Determine the active provider from the current model or endpoint
    const detectedProvider = useMemo(() => {
      const byModel = getProviderByModel(aiModel)
      if (byModel) return byModel.id
      // Try matching by endpoint
      const byEndpoint = AI_PROVIDERS.find(p => p.endpoint && aiEndpoint.includes(new URL(p.endpoint).hostname))
      if (byEndpoint) return byEndpoint.id
      return 'custom'
    }, [aiModel, aiEndpoint])

    const [activeProviderId, setActiveProviderId] = useState(detectedProvider)
    const [customModelInput, setCustomModelInput] = useState(
      activeProviderId === 'custom' ? aiModel : ''
    )
    const [showModelPicker, setShowModelPicker] = useState(false)
    const [modelSearch, setModelSearch] = useState('')

    const activeProvider = getProvider(activeProviderId) || AI_PROVIDERS[AI_PROVIDERS.length - 1]!

    const handleSelectProvider = (providerId: string) => {
      setActiveProviderId(providerId)
      const provider = getProvider(providerId)
      if (provider && provider.endpoint) {
        setAiEndpoint(provider.endpoint)
      }
      // Auto-select first recommended model
      if (provider && provider.id !== 'custom') {
        const recommended = provider.models.find(m => m.tag === '推荐') || provider.models[0]
        if (recommended) {
          setAiModel(recommended.id)
        }
      }
      setShowModelPicker(false)
    }



    const handleCustomModelChange = (value: string) => {
      setCustomModelInput(value)
      setAiModel(value)
    }

    // Filtered models for search
    const filteredModels = useMemo(() => {
      if (!modelSearch.trim()) return activeProvider.models
      const q = modelSearch.toLowerCase()
      return activeProvider.models.filter(
        m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      )
    }, [activeProvider, modelSearch])

    // Current model display
    const currentModelObj = activeProvider.models.find(m => m.id === aiModel)
    const currentModelDisplay = currentModelObj?.name || aiModel || '未选择'

    return (
        <div style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
            <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bot size={16} /> AI 助手设置
            </h3>

            <div style={fieldGroupStyle}>
                {/* ── Provider Selection ── */}
                <div>
                    <label style={labelStyle}>选择供应商</label>
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', gap: 8,
                    }}>
                      {AI_PROVIDERS.map(p => (
                        <ProviderChip
                          key={p.id}
                          provider={p}
                          active={activeProviderId === p.id}
                          onClick={() => handleSelectProvider(p.id)}
                        />
                      ))}
                    </div>
                </div>

                {/* ── Endpoint ── */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>API 请求地址</label>
                      {activeProvider.website && (
                        <a
                          href={activeProvider.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 12, color: 'var(--accent)',
                            display: 'flex', alignItems: 'center', gap: 4,
                            textDecoration: 'none', opacity: 0.8,
                          }}
                        >
                          官网 <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <div style={{
                        fontSize: 12, color: 'var(--text-muted)',
                        background: 'var(--bg-tertiary)', padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 6,
                        marginTop: 'var(--space-sm)'
                    }}>
                        <Info size={14} style={{ color: 'var(--accent)' }} />
                        <span>填写真实有效的 API 端点地址，留空将无法使用对应模型。</span>
                    </div>
                    <input
                        type="text" className="input w-full"
                        placeholder="https://your-api-endpoint.com/v1"
                        value={aiEndpoint}
                        onChange={(e) => setAiEndpoint(e.target.value)}
                        style={{ marginTop: 'var(--space-sm)' }}
                    />
                </div>

                {/* ── API Key ── */}
                <div>
                    <label style={labelStyle}>API Key</label>
                    {aiApiKeyPresent && !aiKeyDirty && !clearKeyRequested ? (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                                <span className="text-sm" style={{ color: 'var(--accent)' }}>
                                    已配置（{aiApiKeyMasked || '********'}）
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                <button
                                    className="button button-secondary"
                                    style={{ fontSize: 13, padding: '4px var(--space-md)' }}
                                    onClick={() => { setAiKeyDirty(true); setAiApiKeyInput('') }}
                                >
                                    修改
                                </button>
                                <button
                                    className="button button-secondary"
                                    style={{ fontSize: 13, padding: '4px var(--space-md)', color: 'var(--danger, #C65A3A)' }}
                                    onClick={() => {
                                        setClearKeyRequested(true)
                                        setAiKeyDirty(true)
                                        setAiApiKeyInput('')
                                    }}
                                >
                                    清除 Key
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <input
                                type="password" className="input w-full"
                                placeholder={clearKeyRequested ? 'Key 将在保存时清除' : '输入新 API Key（留空保持不变）'}
                                value={aiApiKeyInput}
                                onChange={(e) => { setAiApiKeyInput(e.target.value); setAiKeyDirty(true) }}
                            />
                            {clearKeyRequested && (
                                <button
                                    className="button button-secondary"
                                    style={{ fontSize: 12, padding: '2px var(--space-sm)', marginTop: 'var(--space-sm)' }}
                                    onClick={() => { setClearKeyRequested(false); setAiKeyDirty(false) }}
                                >
                                    取消清除
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Model Selection ── */}
                <div>
                    <label style={labelStyle}>模型名称</label>
                    {activeProviderId === 'custom' ? (
                      <div>
                        <input
                          type="text" className="input w-full"
                          placeholder="输入自定义模型名称，如 gpt-4o"
                          value={customModelInput}
                          onChange={e => handleCustomModelChange(e.target.value)}
                        />
                        <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                          指定使用的模型名称，将直接传递给 API
                        </div>
                      </div>
                    ) : (
                      <div style={{ position: 'relative' }}>
                        {/* Current Selection Button */}
                        <button
                          onClick={() => setShowModelPicker(!showModelPicker)}
                          className="input w-full"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: 'var(--accent)',
                            }} />
                            <span style={{ fontWeight: 500 }}>{currentModelDisplay}</span>
                            {currentModelObj?.tag && (
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 6px',
                                borderRadius: 4,
                                background: getTagColor(currentModelObj.tag).bg,
                                color: getTagColor(currentModelObj.tag).text,
                              }}>
                                {currentModelObj.tag}
                              </span>
                            )}
                          </div>
                          <ChevronDown size={16} style={{
                            color: 'var(--text-muted)',
                            transform: showModelPicker ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.2s',
                          }} />
                        </button>

                        {/* Dropdown: Model Picker */}
                        {showModelPicker && (
                          <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                              marginTop: 8, background: 'var(--bg-secondary)',
                              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                              boxShadow: 'var(--shadow-lg)',
                              overflow: 'hidden', display: 'flex', flexDirection: 'column',
                          }}>
                            {/* Search */}
                            {activeProvider.models.length > 3 && (
                              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 6,
                                  padding: '4px 8px', background: 'var(--bg-primary)',
                                  borderRadius: 8, border: '1px solid var(--border)',
                                }}>
                                  <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                  <input
                                    type="text"
                                    placeholder="搜索模型..."
                                    value={modelSearch}
                                    onChange={e => setModelSearch(e.target.value)}
                                    style={{
                                      width: '100%', background: 'transparent', border: 'none', outline: 'none',
                                      fontSize: 13, color: 'var(--text-primary)',
                                    }}
                                    autoFocus
                                  />
                                  {modelSearch && (
                                    <button onClick={() => setModelSearch('')} style={{
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      color: 'var(--text-muted)', padding: 0,
                                    }} aria-label="清除搜索" title="清除搜索">
                                      <X size={13} aria-hidden />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Model List */}
                            <div style={{
                              padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
                              maxHeight: 240, overflowY: 'auto',
                            }}>
                              {filteredModels.length === 0 ? (
                                <div style={{
                                  padding: '16px', textAlign: 'center',
                                  color: 'var(--text-muted)', fontSize: 13,
                                }}>
                                  未找到匹配模型
                                </div>
                              ) : (
                                filteredModels.map(model => (
                                  <ModelCard
                                    key={model.id}
                                    model={model}
                                    active={aiModel === model.id}
                                    onClick={() => {
                                      setAiModel(model.id)
                                      setShowModelPicker(false)
                                    }}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                </div>

                <div className="text-xs text-muted" style={{
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-tertiary)'
                }}>
                    留空则不启用 AI 功能。所有接口均兼容 OpenAI 格式，只需填写对应的 Endpoint 和 Key 即可使用。
                </div>
            </div>
        </div>
    )
}

export function SettingsBackup({
    autoBackup, setAutoBackup,
    backupPath, setBackupPath,
    exportData, importData, showToast
}: SettingsBackupProps) {
    return (
        <div style={sectionStyle}>
            <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Database size={16} /> 数据管理与备份
            </h3>
            <div style={fieldGroupStyle}>
                <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', marginBottom: 'var(--space-sm)' }}>
                        <input
                            type="checkbox" checked={autoBackup}
                            onChange={(e) => setAutoBackup(e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                        />
                        <span className="text-sm font-semibold">开启静默自动备份</span>
                    </label>
                    <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-sm)' }}>
                        开启后，每24小时及启动时自动在指定目录备份 JSON 文件。
                    </div>

                    <div style={{ opacity: autoBackup ? 1 : 0.5, pointerEvents: autoBackup ? 'auto' : 'none', transition: 'opacity 0.2s', marginBottom: 'var(--space-md)' }}>
                        <label style={labelStyle}>自动备份目录</label>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <input
                                type="text" className="input" style={{ flex: 1, fontSize: 12 }}
                                placeholder="选择文件夹..."
                                value={backupPath}
                                readOnly
                            />
                            <button className="button button-secondary" style={{ padding: '0 var(--space-md)' }} onClick={async () => {
                                if (!(window as any).api?.settings?.selectBackupFolder) return showToast('此功能仅在客户端可用', 'error')
                                const path = await (window as any).api.settings.selectBackupFolder()
                                if (path) setBackupPath(path)
                            }}>选择</button>
                        </div>
                    </div>
                </div>

                <div style={{ height: 1, background: 'var(--border)', margin: 'var(--space-sm) 0' }} />
                <div>
                    <label style={labelStyle}>导出数据</label>
                    <button className="button button-secondary w-full" onClick={exportData}>
                        <Package size={15} /> 导出为 JSON
                    </button>
                </div>
                <div>
                    <label style={labelStyle}>导入数据</label>
                    <button className="button button-secondary w-full" onClick={importData}>
                        <FolderOpen size={15} /> 从 JSON 导入
                    </button>
                </div>
                <div className="text-xs text-muted">
                    数据全部存储在本地，导出可做备份。
                </div>
            </div>
        </div>
    )
}

/** Format bytes/sec to human-readable speed string */
function formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond >= 1024 * 1024) {
        return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MB/s'
    }
    return Math.round(bytesPerSecond / 1024) + ' KB/s'
}

export function SettingsAbout({
    checkForUpdates, installUpdate, updateStatus, version
}: SettingsAboutProps) {
    const { status } = updateStatus
    const isChecking = status === 'checking'
    const isDownloading = status === 'downloading'
    const isDownloaded = status === 'downloaded'
    const isBusy = isChecking || status === 'available' || isDownloading

    return (
        <div style={sectionStyle}>
            <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Info size={16} /> 关于
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <div className="text-sm">
                    <span className="text-muted">版本：</span> <span>{version}</span>
                </div>
                <div className="text-sm">
                    <span className="text-muted">存储：</span> <span>SQLite 本地数据库</span>
                </div>
                <div className="text-sm">
                    <span className="text-muted">隐私：</span> <span>学习数据完全本地存储；AI 与更新检查仅在配置或触发时联网</span>
                </div>
                <div style={{ marginTop: 'var(--space-md)' }}>
                    {isDownloaded ? (
                        <button
                            className="button button-primary w-full"
                            onClick={installUpdate}
                            data-testid="update-install-btn"
                        >
                            <RotateCw size={15} /> 重启安装 v{updateStatus.version}
                        </button>
                    ) : (
                        <button
                            className="button button-secondary w-full"
                            onClick={checkForUpdates}
                            disabled={isBusy}
                            data-testid="update-check-btn"
                        >
                            {isChecking
                                ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> 正在检查...</>
                                : status === 'error'
                                    ? <><RefreshCw size={15} /> 重试</>
                                    : <><RefreshCw size={15} /> 检查更新</>}
                        </button>
                    )}
                </div>

                {/* ── Update Status Line ── */}
                {status !== 'idle' && (
                    <div data-testid="update-status" style={{
                        display: 'flex', flexDirection: 'column', gap: 6,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-tertiary)',
                        animation: 'fadeIn 0.2s ease',
                    }}>
                        {status === 'checking' && (
                            <span className="text-xs" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                正在连接更新服务器...
                            </span>
                        )}

                        {status === 'available' && (
                            <span className="text-xs" style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Download size={12} />
                                发现新版本 v{updateStatus.version}，正在准备下载...
                            </span>
                        )}

                        {status === 'not-available' && (
                            <span className="text-xs" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CheckCircle size={12} />
                                已是最新版本
                            </span>
                        )}

                        {status === 'downloading' && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="text-xs" style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Download size={12} />
                                        正在下载... {updateStatus.percent ?? 0}%
                                    </span>
                                    {updateStatus.bytesPerSecond != null && updateStatus.bytesPerSecond > 0 && (
                                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            {formatSpeed(updateStatus.bytesPerSecond)}
                                        </span>
                                    )}
                                </div>
                                <div style={{
                                    height: 4, borderRadius: 2,
                                    background: 'var(--border)',
                                    overflow: 'hidden',
                                }}>
                                    <div
                                        data-testid="update-progress-bar"
                                        style={{
                                            height: '100%',
                                            width: `${updateStatus.percent ?? 0}%`,
                                            background: 'var(--accent)',
                                            borderRadius: 2,
                                            transition: 'width 0.3s ease',
                                        }}
                                    />
                                </div>
                            </>
                        )}

                        {status === 'downloaded' && (
                            <span className="text-xs" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CheckCircle size={12} />
                                新版本 v{updateStatus.version} 已下载完毕，重启即可安装
                            </span>
                        )}

                        {status === 'error' && (
                            <span className="text-xs" style={{ color: 'var(--danger, #C65A3A)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AlertTriangle size={12} />
                                {updateStatus.message || '检查更新失败'}
                            </span>
                        )}
                    </div>
                )}

                <div className="text-xs text-muted" style={{ paddingTop: 12 }}>
                    MindDiary · 面向备考场景的本地优先学习系统
                </div>
            </div>
        </div>
    )
}
