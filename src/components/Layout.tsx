import { useState, useEffect } from 'react'
import Logo from './Logo'

interface LayoutProps {
  children: React.ReactNode
  isSidebarCollapsed: boolean
  selectedDate: string
}

function Layout({ children, isSidebarCollapsed, selectedDate }: LayoutProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const hasCustomTitlebar = window.api.window.titlebarMode === 'custom'

  useEffect(() => {
    if (!hasCustomTitlebar) return

    window.api.window.isMaximized().then(setIsMaximized).catch(() => {})
    // Listen for maximize state changes pushed from main process
    // (e.g. user double-clicks titlebar, or Win11 snap layouts)
    window.api.window.onMaximizedChange?.((maximized: boolean) => {
      setIsMaximized(maximized)
    })
  }, [hasCustomTitlebar])

  const handleMinimize = () => {
    window.api.window.minimize()
  }

  const handleMaximize = () => {
    window.api.window.maximize().then(maximized => {
      setIsMaximized(maximized)
    }).catch(() => {})
  }

  const handleClose = () => {
    window.api.window.close()
  }

  const winBtnStyle: React.CSSProperties = {
    width: 40, height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', transition: 'all 0.15s',
  }

  return (
    <div
      className="app-container"
      style={{
        '--sidebar-width': isSidebarCollapsed ? '72px' : '240px',
        '--titlebar-height': hasCustomTitlebar ? '40px' : '0px',
      } as React.CSSProperties}
    >
      {hasCustomTitlebar && (
        <div className="titlebar titlebar-custom">
          <div className="flex items-center gap-sm">
            <div style={{ width: 18, height: 18, position: 'relative', top: '-1px' }}>
              <img src="/images/app-icon.svg" className="w-full h-full object-contain" alt="MindDiary" style={{ borderRadius: 4 }} />
            </div>
            <span className="text-sm font-semibold text-secondary">MindDiary</span>
          </div>
          <div className="text-sm text-muted">
            考研日记 · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
          </div>
          <div className="flex items-center" style={{ height: '100%' }}>
            <button
              style={{ ...winBtnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={handleMinimize}
              title="最小化"
              aria-label="最小化窗口"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect y="5.5" width="12" height="1" fill="currentColor" />
              </svg>
            </button>
            <button
              style={{ ...winBtnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={handleMaximize}
              title={isMaximized ? "还原" : "最大化"}
              aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M2,1v2H0v7h7V8h2V1H2z M6,9H1V3h5V9z M9,6H8V2H3V1h6V6z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M0,0v10h10V0H0z M9,9H1V1h8V9z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              style={{ ...winBtnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={handleClose}
              title="关闭"
              aria-label="关闭窗口"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = 'var(--danger)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M10.707,1.293c-0.391-0.391-1.023-0.391-1.414,0L6,4.586L2.707,1.293c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414L4.586,6L1.293,9.293c-0.391,0.391-0.391,1.023,0,1.414C1.488,10.902,1.744,11,2,11s0.512-0.098,0.707-0.293L6,7.414l3.293,3.293C9.488,10.902,9.744,11,10,11s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414L7.414,6l3.293-3.293C11.098,2.316,11.098,1.684,10.707,1.293z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  )
}

export default Layout