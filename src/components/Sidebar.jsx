export default function Sidebar({ activeView, onViewChange, selectedDate, isCollapsed, onToggle }) {
  const navItems = [
    { id: 'editor', icon: '📝', label: '写日记' },
    { id: 'calendar', icon: '📅', label: '日历' },
    { id: 'dashboard', icon: '📊', label: '数据统计' },
    { id: 'tags', icon: '🏷️', label: '标签管理' },
    { id: 'search', icon: '🔍', label: '搜索' },
    { id: 'pomodoro', icon: '🍅', label: '番茄钟' },
    { id: 'progress', icon: '📖', label: '科目进度' },
    { id: 'mistakes', icon: '📝', label: '错题本' },
    { id: 'ai', icon: '🤖', label: 'AI 助手' },
    { id: 'settings', icon: '⚙️', label: '设置' },
  ]

  return (
    <div className="sidebar">
      {/* Brand */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space)',
        padding: isCollapsed ? 'var(--space-md) 0' : 'var(--space-md)',
        background: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-lg)',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        transition: 'all 0.3s'
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '40%',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: 16, flexShrink: 0
        }}>
          考
        </div>
        {!isCollapsed && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <div className="font-semibold" style={{ fontSize: 14 }}>考研日记</div>
            <div className="text-muted" style={{ fontSize: 11 }}>记录每一天</div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space)',
              padding: '6px var(--space-md)',
              borderRadius: 'var(--radius)', border: 'none',
              cursor: 'pointer', width: '100%', textAlign: 'left',
              fontSize: 14, fontWeight: activeView === item.id ? 600 : 500, fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              background: activeView === item.id ? 'var(--bg-secondary)' : 'transparent',
              color: activeView === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: activeView === item.id ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
            }}
            onMouseEnter={(e) => {
              if (activeView !== item.id) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'
            }}
            onMouseLeave={(e) => {
              if (activeView !== item.id) e.currentTarget.style.background = 'transparent'
            }}
          >
            <span style={{
              fontSize: 18,
              color: activeView === item.id ? 'var(--accent)' : 'inherit',
              flexShrink: 0,
              width: 24, textAlign: 'center'
            }}>
              {item.icon}
            </span>
            {!isCollapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Today & Toggle */}
      <div style={{
        marginTop: 'auto', paddingTop: 'var(--space-lg)',
        borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space)',
        alignItems: isCollapsed ? 'center' : 'flex-start'
      }}>
        {!isCollapsed && (
          <div>
            <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>今日</div>
            <div className="font-semibold" style={{ fontSize: 17 }}>{selectedDate}</div>
            <div className="text-secondary" style={{ fontSize: 13 }}>
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'long' })}
            </div>
          </div>
        )}
        <button
          onClick={onToggle}
          style={{
            background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer',
            width: isCollapsed ? 36 : '100%', height: 36, borderRadius: 'var(--radius)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          title={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {isCollapsed ? '→' : '← 收起侧边栏'}
        </button>
      </div>
    </div>
  )
}