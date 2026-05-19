import { Plus, X } from 'lucide-react'
import type { ActiveAppInfo } from '../types'

interface FocusGuardNoticeProps {
  app: ActiveAppInfo
  onAddToWhitelist: (app: ActiveAppInfo) => void | Promise<void>
  onIgnore: (app: ActiveAppInfo) => void
  onDismiss: () => void
}

function getAppDisplayName(app: ActiveAppInfo): string {
  return app.name || app.processName || app.executable || '未知应用'
}

export default function FocusGuardNotice({
  app,
  onAddToWhitelist,
  onIgnore,
  onDismiss,
}: FocusGuardNoticeProps) {
  const appName = getAppDisplayName(app)

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="focus-guard-notice"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        width: 'min(360px, calc(100vw - 32px))',
        zIndex: 'var(--z-focus-notice)',
        padding: 'var(--space-md)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            当前应用不在专注白名单：{appName}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            回到学习相关窗口，或将它加入本次专注白名单。
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="知道了"
          title="知道了"
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="button button-primary"
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999 }}
          onClick={() => { void onAddToWhitelist(app) }}
        >
          <Plus size={13} /> 加入白名单
        </button>
        <button
          type="button"
          className="button button-secondary"
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999 }}
          onClick={() => onIgnore(app)}
        >
          本次忽略 5 分钟
        </button>
        <button
          type="button"
          className="button button-secondary"
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999 }}
          onClick={onDismiss}
        >
          知道了
        </button>
      </div>
    </div>
  )
}
