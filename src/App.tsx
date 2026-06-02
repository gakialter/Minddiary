import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Download, Frown, RotateCcw } from 'lucide-react'
import { DiaryProvider, useDiary } from './contexts/DiaryContext'
import { PomodoroProvider, usePomodoroData, usePomodoroActions } from './contexts/PomodoroContext'
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
import PomodoroAlert from './components/PomodoroAlert'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastContainer, showToast } from './components/Toast'
import { logger } from './utils/logger'
import { getLocalDateKey } from './utils/dateKey'
import type { DiaryEntry, MoodId } from './types'
import type { PendingDiaryInsert } from './components/Editor'
import type { MistakeFilterIntent } from './components/MistakeBook'

const POMODORO_FULLSCREEN_NAVIGATION_MESSAGE = '请先退出番茄钟全屏模式再切换页面'

interface ViewErrorFallbackProps {
  error?: Error | null
  resetErrorBoundary?: () => void
}

const ViewErrorFallback = ({ error, resetErrorBoundary }: ViewErrorFallbackProps) => (
  <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
    <div style={{ marginBottom: 'var(--space)', color: 'var(--text-muted)' }}>
      <Frown size={48} strokeWidth={1.5} />
    </div>
    <h3 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space)' }}>该区域加载失败</h3>
    <p style={{ marginBottom: 'var(--space-lg)', fontSize: 13 }}>{error?.message || '发生了未知的渲染错误'}</p>
    <button className="button button-primary" onClick={resetErrorBoundary}>
      <RotateCcw size={16} /> 重试
    </button>
  </div>
)

const buildFocusReflectionTemplate = (subjectName: string | null) => {
  const subjectLine = subjectName ? `- 科目：${subjectName}\n` : ''
  return `## 本轮专注沉淀\n${subjectLine}- 学习内容：\n- 卡点：\n- 下一步：`
}

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
  const loadRequestId = useRef(0)
  const [isFirstLaunch, setIsFirstLaunch] = useState(() => !localStorage.getItem('started'))
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showBreakReview, setShowBreakReview] = useState(false)
  const [pendingDiaryInsert, setPendingDiaryInsert] = useState<PendingDiaryInsert | null>(null)
  const [pendingMistakeFilter, setPendingMistakeFilter] = useState<MistakeFilterIntent | null>(null)
  const [isPomodoroFullscreenActive, setIsPomodoroFullscreenActive] = useState(false)

  // Register break-start handler with Pomodoro context
  const { alertState } = usePomodoroData()
  const { setOnBreakStart, dismissAlert } = usePomodoroActions()

  useEffect(() => {
    setOnBreakStart(() => setShowBreakReview(true))
    return () => setOnBreakStart(null)
  }, [setOnBreakStart])

  const navigateToView = useCallback((view: string) => {
    if (isPomodoroFullscreenActive && view !== activeView) {
      showToast(POMODORO_FULLSCREEN_NAVIGATION_MESSAGE, 'info')
      return false
    }
    setActiveView(view)
    return true
  }, [activeView, isPomodoroFullscreenActive, setActiveView])

  const handleWriteFocusDiary = useCallback(() => {
    if (!navigateToView('editor')) return
    const today = getLocalDateKey()
    setPendingDiaryInsert({
      id: Date.now(),
      date: today,
      content: buildFocusReflectionTemplate(alertState.subjectName),
    })
    setSelectedDate(today)
    dismissAlert()
  }, [alertState.subjectName, dismissAlert, navigateToView, setSelectedDate])

  const handleAddFocusMistake = useCallback(() => {
    if (!navigateToView('mistakes')) return
    dismissAlert()
  }, [dismissAlert, navigateToView])

  const handlePendingDiaryInsertApplied = useCallback((id: number) => {
    setPendingDiaryInsert(current => current?.id === id ? null : current)
  }, [])

  const handleMistakeFilterIntent = useCallback((intent: MistakeFilterIntent) => {
    setPendingMistakeFilter(intent)
  }, [])

  const handleMistakeFilterIntentApplied = useCallback(() => {
    setPendingMistakeFilter(null)
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

  /** Create a blank entry shell for a given date (used when no saved entry exists). */
  const createEmptyEntry = (date: string): DiaryEntry => ({
    id: 0, date, title: '', content: '', mood: null,
    tags: [], word_count: 0, created_at: '', updated_at: '',
  })

  const loadEntryTags = async (loadedEntry: DiaryEntry) => {
    if (!loadedEntry.id) return loadedEntry.tags || []
    try {
      const entryTags = await diary.tags.getEntryTags(loadedEntry.id)
      return entryTags.map(tag => tag.id)
    } catch (error) {
      logger.error('Failed to load entry tags:', error)
      return loadedEntry.tags || []
    }
  }

  const loadEntry = async (date: string) => {
    // Guard against race conditions when the user switches dates rapidly:
    // each call captures a unique requestId; if a newer call has started by the
    // time an older one resolves, the older result is silently discarded.
    const currentRequestId = ++loadRequestId.current
    setLoading(true)
    try {
      const data = await diary.entries.getByDate(date)
      if (currentRequestId !== loadRequestId.current) return // stale request
      if (data) {
        const tagIds = await loadEntryTags(data)
        if (currentRequestId !== loadRequestId.current) return // stale after tag fetch
        setEntry({ ...data, tags: tagIds })
      } else {
        setEntry(createEmptyEntry(date))
      }
    } catch (error) {
      logger.error('Failed to load entry:', error)
      if (currentRequestId === loadRequestId.current) {
        setEntry(createEmptyEntry(date))
      }
    } finally {
      if (currentRequestId === loadRequestId.current) {
        setLoading(false)
      }
    }
  }

  // saveEntry receives Partial<DiaryEntry>. Tags are stripped out and saved
  // separately via setEntryTags after the entry itself is persisted. When
  // called from MoodPicker (which passes the full entry spread), `tags` will
  // be present but is deliberately handled via setEntryTags rather than being
  // sent to entries.create/update. When `tags` is absent (undefined), the
  // setEntryTags call is skipped — this is intentional.
  const saveEntry = async (updated: Partial<DiaryEntry>) => {
    try {
      const { tags, ...entryData } = updated
      const tagIds = Array.isArray(tags) ? tags : undefined
      let saved: DiaryEntry | null = null
      if (entry?.id) {
        saved = await diary.entries.update(entry.id, entryData)
      } else {
        saved = await diary.entries.create({
          date: selectedDate,
          title: entryData.title || '',
          content: entryData.content || '',
          mood: entryData.mood ?? null,
          ...(entryData.images ? { images: entryData.images } : {}),
        })
      }
      if (saved) {
        if (tagIds) {
          await diary.tags.setEntryTags(saved.id, tagIds)
        }
        setEntry({ ...saved, tags: tagIds || saved.tags || [] })
      }
    } catch (error) {
      logger.error('Failed to save entry:', error)
    }
  }

  const ensureEntryId = useCallback(async () => {
    if (entry?.id) return entry.id
    try {
      const saved = await diary.entries.create({
        date: selectedDate,
        title: entry?.title || '',
        content: entry?.content || '',
        mood: entry?.mood ?? null,
      })
      const tagIds = entry?.tags || saved.tags || []
      setEntry({ ...saved, tags: tagIds })
      return saved.id
    } catch (error) {
      logger.error('Failed to create entry before image upload:', error)
      return null
    }
  }, [diary.entries, entry, selectedDate])

  // ─── View rendering (data-driven) ───
  const renderView = () => {
    const config = VIEW_CONFIG[activeView] || VIEW_CONFIG.editor!
    return config.render({
      entry, saveEntry, loading,
      selectedDate, setSelectedDate,
      changeDate, setActiveView: navigateToView,
      isSidebarCollapsed,
      ImageGallery,
      ensureEntryId,
      pendingDiaryInsert,
      onPendingDiaryInsertApplied: handlePendingDiaryInsertApplied,
      mistakeFilterIntent: pendingMistakeFilter,
      onMistakeFilterIntent: handleMistakeFilterIntent,
      onMistakeFilterIntentApplied: handleMistakeFilterIntentApplied,
      onPomodoroFullscreenChange: setIsPomodoroFullscreenActive,
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
        onViewChange={navigateToView}
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
            <ErrorBoundary fallback={<ViewErrorFallback />} onReset={() => navigateToView('welcome')}>
              {renderView()}
            </ErrorBoundary>
          </div>
        </div>
      </div>
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNavigate={navigateToView}
      />
      {activeView !== 'pomodoro' && (
        <Pomodoro
          isWidget={true}
          onExpand={() => navigateToView('pomodoro')}
          isCollapsed={isSidebarCollapsed}
        />
      )}
      <ToastContainer />
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showBreakReview && <BreakReviewModal onClose={() => setShowBreakReview(false)} />}
      <PomodoroAlert
        visible={alertState.visible}
        isWorkComplete={alertState.isWorkComplete}
        duration={alertState.duration}
        todayTotal={alertState.todayTotal}
        onClose={dismissAlert}
        showSettlementActions={alertState.showSettlementActions}
        onWriteDiary={handleWriteFocusDiary}
        onAddMistake={handleAddFocusMistake}
      />
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
