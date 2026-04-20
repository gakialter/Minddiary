import React from 'react';
import { Home, PenLine, Calendar, BarChart2, Tags, Search, Timer, BookOpen, BookX, Bot, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Logo from './Logo';

interface SidebarProps {
  activeView: string
  onViewChange: (viewId: string) => void
  selectedDate: string
  isCollapsed: boolean
  onToggle: () => void
}

interface NavItem {
  id: string
  icon: React.ReactElement
  label: string
}

export default function Sidebar({ activeView, onViewChange, selectedDate, isCollapsed, onToggle }: SidebarProps) {
  const navItems: NavItem[] = [
    { id: 'home', icon: <Home size={20} />, label: '今日决策' },
    { id: 'editor', icon: <PenLine size={20} />, label: '写日记' },
    { id: 'calendar', icon: <Calendar size={20} />, label: '日历' },
    { id: 'dashboard', icon: <BarChart2 size={20} />, label: '数据统计' },
    { id: 'tags', icon: <Tags size={20} />, label: '标签管理' },
    { id: 'search', icon: <Search size={20} />, label: '搜索' },
    { id: 'pomodoro', icon: <Timer size={20} />, label: '番茄钟' },
    { id: 'progress', icon: <BookOpen size={20} />, label: '科目进度' },
    { id: 'mistakes', icon: <BookX size={20} />, label: '错题本' },
    { id: 'ai', icon: <Bot size={20} />, label: 'AI 助手' },
    { id: 'settings', icon: <Settings size={20} />, label: '设置' },
  ]

  return (
    <div className="sidebar" style={{ backgroundColor: 'var(--bg-primary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      {/* Brand */}
      <div className="px-4 py-4 mb-2">
        <div className="flex items-center gap-3" style={{ justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
          <div className="flex h-10 w-10 items-center justify-center shrink-0" style={{ color: 'var(--accent)' }}>
            <Logo className="w-full h-full" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>考研日记</div>
              <div className="text-[13px] leading-tight mt-0.5" style={{ color: 'var(--text-secondary)' }}>记录每一天</div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-1 flex flex-col gap-1">
        {navItems.map(item => {
          const isActive = activeView === item.id;
          return (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium transition-colors border-0 outline-none appearance-none ${
              isActive
                ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className={`shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {React.cloneElement(item.icon, { size: 18 })}
            </span>
            {!isCollapsed && <span className="truncate">{item.label}</span>}
          </button>
        )})}
      </nav>

      <div className="mt-auto px-4 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        {!isCollapsed && (
          <div className="mb-4">
            <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>今日</div>
            <div className="mt-1 text-[20px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{selectedDate}</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'long' })}
            </div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors border-0 outline-none appearance-none"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--border)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
          }}
          title={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {isCollapsed ? <PanelLeftOpen size={18} /> : (
            <>
              <PanelLeftClose size={18} />
              <span>收起侧边栏</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}