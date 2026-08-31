import type { LucideIcon } from 'lucide-react'
import { Home, PenLine, Calendar, BarChart2, Tags, Search, Timer, BookOpen, BookX, Bot, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface SidebarProps {
  activeView: string
  onViewChange: (viewId: string) => void
  selectedDate: string
  isCollapsed: boolean
  onToggle: () => void
}

interface NavItem {
  id: string
  icon: LucideIcon
  label: string
}

export default function Sidebar({ activeView, onViewChange, selectedDate, isCollapsed, onToggle }: SidebarProps) {
  const navItems: NavItem[] = [
    { id: 'home', icon: Home, label: '今日执行' },
    { id: 'editor', icon: PenLine, label: '写日记' },
    { id: 'calendar', icon: Calendar, label: '日历' },
    { id: 'dashboard', icon: BarChart2, label: '数据统计' },
    { id: 'tags', icon: Tags, label: '标签管理' },
    { id: 'search', icon: Search, label: '搜索' },
    { id: 'pomodoro', icon: Timer, label: '番茄钟' },
    { id: 'progress', icon: BookOpen, label: '科目进度' },
    { id: 'mistakes', icon: BookX, label: '错题本' },
    { id: 'ai', icon: Bot, label: 'AI 助手' },
    { id: 'settings', icon: Settings, label: '设置' },
  ]
  const toggleLabel = isCollapsed ? '展开侧边栏' : '收起侧边栏'

  return (
    <aside className="sidebar" data-collapsed={isCollapsed}>
      <nav id="primary-navigation" className="sidebar-nav" aria-label="主要导航">
        {navItems.map(item => {
          const isActive = activeView === item.id
          const Icon = item.icon

          return (
            <button
              key={item.id}
              type="button"
              className="sidebar-nav-item"
              data-current={isActive}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onViewChange(item.id)}
            >
              <span className="sidebar-nav-icon">
                <Icon size={18} aria-hidden="true" focusable="false" />
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">{item.label}</span>}
              {isCollapsed && (
                <span className="sidebar-tooltip" aria-hidden="true">
                  {item.label}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        {!isCollapsed && (
          <div className="sidebar-today">
            <div className="sidebar-today-label">今日</div>
            <div className="sidebar-today-date">{selectedDate}</div>
            <div className="sidebar-today-weekday">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'long' })}
            </div>
          </div>
        )}
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={toggleLabel}
          aria-expanded={!isCollapsed}
          aria-controls="primary-navigation"
          title={toggleLabel}
          onClick={onToggle}
        >
          {isCollapsed
            ? <PanelLeftOpen size={18} aria-hidden="true" focusable="false" />
            : <PanelLeftClose size={18} aria-hidden="true" focusable="false" />}
          {!isCollapsed && <span>收起侧边栏</span>}
          {isCollapsed && (
            <span className="sidebar-tooltip" aria-hidden="true">
              展开侧边栏
            </span>
          )}
        </button>
      </div>
    </aside>
  )
}
