import { useState, useEffect } from 'react'
import { DiaryProvider, useDiary } from './contexts/DiaryContext'
import { PomodoroProvider } from './contexts/PomodoroContext'
import Layout from './components/Layout'
import Editor from './components/Editor'
import Calendar from './components/Calendar'
import Sidebar from './components/Sidebar'
import TagManager from './components/TagManager'
import SearchPanel from './components/SearchPanel'
import Countdown from './components/Countdown'
import MoodPicker from './components/MoodPicker'
import Settings from './components/Settings'
import Pomodoro from './components/Pomodoro'
import StudyProgress from './components/StudyProgress'
import MistakeBook from './components/MistakeBook'
import AIPanel from './components/AIPanel'
import ImageGallery from './components/ImageGallery'
import Dashboard from './components/Dashboard'
import Welcome from './components/Welcome'
import CommandPalette from './components/CommandPalette'
import ExportModal from './components/ExportModal'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastContainer } from './components/Toast'
import { getTodayStr } from './utils/helpers'

const VIEW_TITLES = {
  editor: '📝 写日记',
  calendar: '📅 日历',
  dashboard: '📊 数据统计',
  tags: '🏷️ 标签管理',
  search: '🔍 搜索',
  pomodoro: '🍅 番茄钟',
  progress: '📖 科目进度',
  mistakes: '📝 错题本',
  ai: '🤖 AI 助手',
}

const ViewErrorFallback = ({ error, resetErrorBoundary }) => (
  <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
    <div style={{ fontSize: 48, marginBottom: 'var(--space)' }}>😵</div>
    <h3 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space)' }}>该区域加载失败</h3>
    <p style={{ marginBottom: 'var(--space-lg)', fontSize: 13 }}>{error?.message || '发生了未知的渲染错误'}</p>
    <button className="button button-primary" onClick={resetErrorBoundary}>
      🔄 重试
    </button>
  </div>
)

function AppContent() {
  const diary = useDiary()
  const { isDarkMode } = diary
  const [activeView, setActiveView] = useState('editor')
  const [selectedDate, setSelectedDate] = useState(getTodayStr())
  const [entry, setEntry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isFirstLaunch, setIsFirstLaunch] = useState(() => !localStorage.getItem('started'))
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showExport, setShowExport] = useState(false)

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K or Ctrl+K to open Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    loadEntry(selectedDate)
  }, [selectedDate])

  // Reactively apply dark mode whenever isDarkMode changes (settings change or system preference change)
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [isDarkMode])

  const loadEntry = async (date) => {
    setLoading(true)
    try {
      const data = await diary.entries.getByDate(date)
      if (data) {
        setEntry(data)
      } else {
        setEntry({
          date,
          title: '',
          content: '',
          mood: null,
          tags: []
        })
      }
    } catch (error) {
      console.error('Failed to load entry:', error)
      setEntry({ date, title: '', content: '', mood: null, tags: [] })
    } finally {
      setLoading(false)
    }
  }

  const saveEntry = async (updated) => {
    try {
      let saved
      if (entry?.id) {
        saved = await diary.entries.update(entry.id, updated)
      } else {
        saved = await diary.entries.create({ ...updated, date: selectedDate })
      }
      if (saved) setEntry(saved)
    } catch (error) {
      console.error('Failed to save entry:', error)
    }
  }

  const changeDate = (date) => {
    setSelectedDate(date)
    setActiveView('editor')
  }

  const renderView = () => {
    switch (activeView) {
      case 'editor':
        return (
          <div style={{ display: 'flex', gap: 0, height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 'var(--space)' }}>
              <Editor entry={entry} onSave={saveEntry} loading={loading} />
            </div>
            <div style={{
              width: 280, borderLeft: '1px solid var(--border)',
              overflow: 'auto', flexShrink: 0, padding: 'var(--space-sm)'
            }}>
              <ImageGallery entryId={entry?.id} />
            </div>
          </div>
        )
      case 'calendar':
        return <Calendar selectedDate={selectedDate} onSelectDate={changeDate} />
      case 'dashboard':
        return <Dashboard />
      case 'tags':
        return <TagManager />
      case 'search':
        return <SearchPanel onSelectEntry={(e) => { setSelectedDate(e.date); setActiveView('editor') }} />
      case 'pomodoro':
        return <Pomodoro isWidget={false} onExpand={() => {}} isCollapsed={isSidebarCollapsed} />
      case 'progress':
        return <StudyProgress />
      case 'mistakes':
        return <MistakeBook />
      case 'ai':
        return <AIPanel entry={entry} />
      case 'settings':
        return <Settings />
      default:
        return <Editor entry={entry} onSave={saveEntry} loading={loading} />
    }
  }

  if (isFirstLaunch) {
    return <Welcome onStart={() => {
      localStorage.setItem('started', 'true')
      setIsFirstLaunch(false)
    }} />
  }

  return (
    <Layout isSidebarCollapsed={isSidebarCollapsed}>
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        selectedDate={selectedDate}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      <div className="main">
        {activeView !== 'settings' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 'var(--space-md)', padding: '0 var(--space)',
          }}>
            <div className="flex items-center gap-md">
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>
                {VIEW_TITLES[activeView] || ''}
              </h1>
              <Countdown />
            </div>
            <div className="flex items-center gap-sm">
              {activeView === 'editor' && entry && (
                <MoodPicker mood={entry.mood} onChange={(mood) => saveEntry({ ...entry, mood })} />
              )}
              <button
                className="button button-secondary"
                style={{ borderRadius: 12, fontSize: 13, padding: '5px 12px' }}
                onClick={() => setShowExport(true)}
                title="导出数据"
              >
                📤 导出
              </button>
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: activeView === 'editor' ? 0 : 'var(--space)' }}>
          <div key={activeView} className="view-transition">
            <ErrorBoundary fallback={<ViewErrorFallback />} onReset={() => {}}>
              {renderView()}
            </ErrorBoundary>
          </div>
        </div>
      </div>
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNavigate={setActiveView}
      />
      {activeView !== 'pomodoro' && (
        <Pomodoro
          isWidget={true}
          onExpand={() => setActiveView('pomodoro')}
          isCollapsed={isSidebarCollapsed}
        />
      )}
      <ToastContainer />
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </Layout>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <DiaryProvider>
        <PomodoroProvider>
          <AppContent />
        </PomodoroProvider>
      </DiaryProvider>
    </ErrorBoundary>
  )
}

export default App