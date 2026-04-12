import { useState, useEffect, useMemo } from 'react'
import { Download } from 'lucide-react'
import { DiaryProvider, useDiary } from './contexts/DiaryContext'
import { PomodoroProvider, usePomodoroContext } from './contexts/PomodoroContext'
import { useNavigation, VIEW_CONFIG } from './hooks/useNavigation'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import Layout from './components/Layout'
import Sidebar from './components/Sidebar'
import Countdown from './components/Countdown'
import MoodPicker from './components/MoodPicker'
import Pomodoro from './components/Pomodoro'
import ImageGallery from './components/ImageGallery'
import Welcome from './components/Welcome'
import CommandPalette from './components/CommandPalette'
import ExportModal from './components/ExportModal'
import BreakReviewModal from './components/BreakReviewModal'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastContainer } from './components/Toast'
import type { DiaryEntry, MoodId } from './types'

interface ViewErrorFallbackProps {
  error?: Error | null
  resetErrorBoundary?: () => void
}

const ViewErrorFallback = ({ error, resetErrorBoundary }: ViewErrorFallbackProps) => (
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

  // ─── Navigation (extracted hook) ───
  const {
    activeView, setActiveView,
    selectedDate, setSelectedDate,
    changeDate, viewTitle,
  } = useNavigation()

  // ─── Local UI state ───
  const [entry, setEntry] = useState<DiaryEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [isFirstLaunch, setIsFirstLaunch] = useState(() => !localStorage.getItem('started'))
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showBreakReview, setShowBreakReview] = useState(false)

  // Register break-start handler with Pomodoro context
  const pomodoro = usePomodoroContext()
  useEffect(() => {
    pomodoro.setOnBreakStart(() => setShowBreakReview(true))
    return () => pomodoro.setOnBreakStart(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Global keyboard shortcuts (extracted hook) ───
  const keyBindings = useMemo(() => ({
    k: () => setShowCommandPalette(true),
  }), [])
  useGlobalKeyboard(keyBindings)

  // ─── Dark mode side-effect ───
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [isDarkMode])

  // ─── Entry loading ───
  useEffect(() => {
    loadEntry(selectedDate)
  }, [selectedDate])

  const loadEntry = async (date: string) => {
    setLoading(true)
    try {
      const data = await diary.entries.getByDate(date)
      if (data) {
        setEntry(data)
      } else {
        setEntry({ date, title: '', content: '', mood: null, tags: [], word_count: 0, created_at: '', updated_at: '', id: 0 } as DiaryEntry)
      }
    } catch (error) {
      console.error('Failed to load entry:', error)
      setEntry({ date, title: '', content: '', mood: null, tags: [], word_count: 0, created_at: '', updated_at: '', id: 0 } as DiaryEntry)
    } finally {
      setLoading(false)
    }
  }

  const saveEntry = async (updated: Record<string, unknown>) => {
    try {
      let saved: DiaryEntry | null = null
      if (entry?.id) {
        saved = await diary.entries.update(entry.id, updated)
      } else {
        saved = await diary.entries.create({ title: '', content: '', mood: null, ...updated, date: selectedDate })
      }
      if (saved) setEntry(saved)
    } catch (error) {
      console.error('Failed to save entry:', error)
    }
  }

  // ─── View rendering (data-driven) ───
  const renderView = () => {
    const config = VIEW_CONFIG[activeView] || VIEW_CONFIG.editor!
    return config.render({
      entry, saveEntry, loading,
      selectedDate, setSelectedDate,
      changeDate, setActiveView,
      isSidebarCollapsed,
      ImageGallery,
    })
  }

  // ─── First-launch welcome screen ───
  if (isFirstLaunch) {
    return <Welcome onStart={() => {
      localStorage.setItem('started', 'true')
      setIsFirstLaunch(false)
    }} />
  }

  return (
    <Layout isSidebarCollapsed={isSidebarCollapsed} selectedDate={selectedDate}>
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
                {viewTitle}
              </h1>
              <Countdown />
            </div>
            <div className="flex items-center gap-sm">
              {activeView === 'editor' && entry && (
                <MoodPicker mood={entry.mood} onChange={(mood: MoodId | null) => saveEntry({ ...entry, mood })} />
              )}
              <button
                className="button button-secondary"
                style={{ borderRadius: 12, fontSize: 13, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => setShowExport(true)}
                title="导出数据"
              >
                <Download size={14} /> 导出
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
      {showBreakReview && <BreakReviewModal onClose={() => setShowBreakReview(false)} />}
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