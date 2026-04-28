import React from 'react'
import { ClipboardList, Bot, Database, Info, Package, FolderOpen, RefreshCw } from 'lucide-react'

interface SettingsGeneralProps {
  examDate: string; setExamDate: (v: string) => void
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

interface SettingsAboutProps {
  checkForUpdates: () => Promise<void>
  checkingUpdate: boolean
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

export function SettingsAI({
    aiEndpoint, setAiEndpoint,
    aiApiKeyPresent, aiApiKeyMasked,
    aiApiKeyInput, setAiApiKeyInput,
    aiKeyDirty, setAiKeyDirty,
    clearKeyRequested, setClearKeyRequested,
    aiModel, setAiModel
}: SettingsAIProps) {
    return (
        <div style={sectionStyle}>
            <h3 className="font-semibold" style={{ fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bot size={16} /> AI 助手设置
            </h3>
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

export function SettingsAbout({
    checkForUpdates, checkingUpdate, version
}: SettingsAboutProps) {
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
                    <span className="text-muted">隐私：</span> <span>数据完全本地存储，无网络请求</span>
                </div>
                <div style={{ marginTop: 'var(--space-md)' }}>
                    <button 
                        className="button button-secondary w-full" 
                        onClick={checkForUpdates}
                        disabled={checkingUpdate}
                    >
                        {checkingUpdate ? '正在检查...' : <><RefreshCw size={15} /> 检查更新</>}
                    </button>
                </div>
                <div className="text-xs text-muted" style={{ paddingTop: 12 }}>
                    MindDiary · 面向备考场景的本地优先学习系统
                </div>
            </div>
        </div>
    )
}
