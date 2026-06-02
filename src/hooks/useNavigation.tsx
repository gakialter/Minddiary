import { useState, useCallback, type ReactNode } from 'react'
import { getTodayStr } from '../utils/helpers'
import { Home, PenLine, CalendarDays, BarChart2, Tags, Search, Timer, BookOpen, BookX, Bot } from 'lucide-react'
import type { DiaryEntry } from '../types'

import HomeDashboard from '../components/HomeDashboard'
import Calendar from '../components/Calendar'
import Editor from '../components/Editor'
import type { PendingDiaryInsert } from '../components/Editor'
import Dashboard from '../components/Dashboard'
import TagManager from '../components/TagManager'
import SearchPanel from '../components/SearchPanel'
import Pomodoro from '../components/Pomodoro'
import StudyProgress from '../components/StudyProgress'
import MistakeBook from '../components/MistakeBook'
import type { MistakeFilterIntent } from '../components/MistakeBook'
import AIPanel from '../components/AIPanel'
import Settings from '../components/Settings'

interface ViewRenderProps {
  entry: DiaryEntry | null
  saveEntry: (data: Partial<DiaryEntry>) => Promise<void>
  loading: boolean
  selectedDate: string
  setSelectedDate: (date: string) => void
  changeDate: (date: string) => void
  setActiveView: (view: string) => void
  isSidebarCollapsed: boolean
  ImageGallery: React.ComponentType<{ entryId?: number; ensureEntryId?: () => Promise<number | null> }> | null
  ensureEntryId: () => Promise<number | null>
  pendingDiaryInsert?: PendingDiaryInsert | null
  onPendingDiaryInsertApplied?: (id: number) => void
  mistakeFilterIntent?: MistakeFilterIntent | null
  onMistakeFilterIntent?: (intent: MistakeFilterIntent) => void
  onMistakeFilterIntentApplied?: () => void
  onPomodoroFullscreenChange?: (isActive: boolean) => void
}

interface ViewConfig {
  title: ReactNode
  render: (props: ViewRenderProps) => ReactNode
}

/**
 * VIEW_CONFIG — declarative mapping of view IDs to metadata and render functions.
 *
 * Each entry provides:
 *   - title:  page heading shown in the header bar
 *   - render: function(props) => JSX for the view content
 */
export const VIEW_CONFIG: Record<string, ViewConfig> = {
  home: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Home size={22} style={{ color: 'var(--accent)' }} /> 今日决策</span>,
    render: (props) => (
      <HomeDashboard
        setActiveView={props.setActiveView}
        onMistakeFilterIntent={props.onMistakeFilterIntent}
      />
    ),
  },
  editor: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PenLine size={22} style={{ color: 'var(--accent)' }} /> 写日记</span>,
    render: (props) => (
      <div style={{ display: 'flex', gap: 0, height: '100%' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 'var(--space)' }}>
          <Editor
            entry={props.entry}
            onSave={props.saveEntry}
            loading={props.loading}
            pendingInsert={props.pendingDiaryInsert}
            onPendingInsertApplied={props.onPendingDiaryInsertApplied}
          />
        </div>
        <div style={{
          width: 280, borderLeft: '1px solid var(--border)',
          overflow: 'auto', flexShrink: 0, padding: 'var(--space-sm)'
        }}>
          {props.ImageGallery && <props.ImageGallery entryId={props.entry?.id} ensureEntryId={props.ensureEntryId} />}
        </div>
      </div>
    ),
  },
  calendar: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CalendarDays size={22} style={{ color: 'var(--accent)' }} /> 日历</span>,
    render: (props) => <Calendar selectedDate={props.selectedDate} onSelectDate={props.changeDate} />,
  },
  dashboard: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BarChart2 size={22} style={{ color: 'var(--accent)' }} /> 数据统计</span>,
    render: () => <Dashboard />,
  },
  tags: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Tags size={22} style={{ color: 'var(--accent)' }} /> 标签管理</span>,
    render: () => <TagManager />,
  },
  search: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Search size={22} style={{ color: 'var(--accent)' }} /> 搜索</span>,
    render: (props) => (
      <SearchPanel onSelectEntry={(e) => {
        props.setSelectedDate(e.date)
        props.setActiveView('editor')
      }} />
    ),
  },
  pomodoro: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Timer size={22} style={{ color: 'var(--accent)' }} /> 番茄钟</span>,
    render: (props) => (
      <Pomodoro
        isWidget={false}
        onExpand={() => {}}
        isCollapsed={props.isSidebarCollapsed}
        onFullscreenChange={props.onPomodoroFullscreenChange}
      />
    ),
  },
  progress: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BookOpen size={22} style={{ color: 'var(--accent)' }} /> 科目进度</span>,
    render: () => <StudyProgress />,
  },
  mistakes: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BookX size={22} style={{ color: 'var(--accent)' }} /> 错题本</span>,
    render: (props) => (
      <MistakeBook
        initialFilter={props.mistakeFilterIntent}
        onInitialFilterApplied={props.onMistakeFilterIntentApplied}
      />
    ),
  },
  ai: {
    title: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={22} style={{ color: 'var(--accent)' }} /> AI 助手</span>,
    render: (props) => <AIPanel entry={props.entry} />,
  },
  settings: {
    title: null, // Settings has its own header
    render: () => <Settings />,
  },
}

/**
 * useNavigation — manages active view state and date-based navigation.
 */
export function useNavigation() {
  const [activeView, setActiveView] = useState('home')
  const [selectedDate, setSelectedDate] = useState(getTodayStr())

  const changeDate = useCallback((date: string) => {
    setSelectedDate(date)
    setActiveView('editor')
  }, [])

  const viewTitle = VIEW_CONFIG[activeView]?.title || ''

  return {
    activeView,
    setActiveView,
    selectedDate,
    setSelectedDate,
    changeDate,
    viewTitle,
  }
}
