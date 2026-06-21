import { useEffect, useState } from 'react'
import { Coffee, Zap, X } from 'lucide-react'

interface PomodoroAlertProps {
  visible: boolean
  isWorkComplete: boolean   // true = focus done, false = break done
  completionKind?: 'completed' | 'interrupted'
  duration: number          // in minutes
  todayTotal: number        // in minutes
  onClose: () => void
  showSettlementActions?: boolean
  taskSettlement?: {
    id: number
    title: string
    subjectName: string | null
    status: string
    duration: number
    relatedChapterId?: number | null
    chapterTitle?: string | null
    chapterCompleted?: boolean
  } | null
  settlementError?: string | null
  isSettlingTask?: boolean
  pendingReviewEntryCreation?: { reviewText: string } | null
  onSettleTask?: (options: { completeTask: boolean; completeChapter?: boolean; reviewText: string }) => Promise<boolean> | boolean
  onResolveReviewEntryCreation?: (createEntry: boolean) => Promise<boolean> | boolean
  onWriteDiary?: () => void
  onAddMistake?: () => void
}

export default function PomodoroAlert({
  visible,
  isWorkComplete,
  completionKind = 'completed',
  duration,
  todayTotal,
  onClose,
  showSettlementActions = false,
  taskSettlement = null,
  settlementError = null,
  isSettlingTask = false,
  pendingReviewEntryCreation = null,
  onSettleTask,
  onResolveReviewEntryCreation,
  onWriteDiary,
  onAddMistake,
}: PomodoroAlertProps) {
  const [autoCloseTimer, setAutoCloseTimer] = useState(15)
  const [reviewText, setReviewText] = useState('')

  // Auto-close after 15 seconds
  useEffect(() => {
    if (!visible) return
    setReviewText('')
    setAutoCloseTimer(15)
    if (taskSettlement) return
    const interval = setInterval(() => {
      setAutoCloseTimer(prev => prev - 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [taskSettlement, visible])

  useEffect(() => {
    if (visible && !taskSettlement && autoCloseTimer <= 0) {
      onClose()
    }
  }, [autoCloseTimer, taskSettlement, visible, onClose])

  if (!visible) return null

  const isInterruptedFocus = isWorkComplete && completionKind === 'interrupted'
  const title = isInterruptedFocus
    ? '专注已保存'
    : isWorkComplete ? '专注完成！' : '休息结束！'
  const subtitle = isInterruptedFocus
    ? '本次提前结束，实际专注时长已计入统计。'
    : isWorkComplete
      ? '干得漂亮，休息几分钟再继续吧～'
      : '精力充沛，继续加油！'
  const hasChapterAttribution = taskSettlement?.relatedChapterId != null && !!taskSettlement.chapterTitle
  const canCompleteChapter = hasChapterAttribution && !taskSettlement?.chapterCompleted

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'page-fade-in 0.3s ease forwards',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-2xl)',
          textAlign: 'center',
          maxWidth: 400,
          width: '90%',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border)',
          animation: 'pomodoro-alert-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', padding: 4,
          }}
        >
          <X size={16} />
        </button>

        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: isWorkComplete
            ? 'var(--color-state-success)'
            : 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto var(--space-lg)',
          boxShadow: isWorkComplete
            ? '0 8px 24px rgba(47, 143, 107, 0.35)'
            : '0 8px 24px rgba(15, 118, 110, 0.35)',
          animation: 'pomodoro-pulse 2s ease-in-out infinite',
        }}>
          {isWorkComplete ? <Coffee size={32} color="white" /> : <Zap size={32} color="white" />}
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-sm)', color: 'var(--text-primary)' }}>
          {title}
        </h2>

        <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-lg)', lineHeight: 1.6 }}>
          {subtitle}
        </p>

        <div className="flex gap-md" style={{ justifyContent: 'center', marginBottom: 'var(--space-lg)' }}>
          <div style={{
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-sm) var(--space-md)', minWidth: 90,
          }}>
            <div className="text-xs text-muted" style={{ marginBottom: 2 }}>本次专注</div>
            <div className="font-bold" style={{ fontSize: 18, color: 'var(--accent)' }}>{duration}min</div>
          </div>
          <div style={{
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-sm) var(--space-md)', minWidth: 90,
          }}>
            <div className="text-xs text-muted" style={{ marginBottom: 2 }}>今日累计</div>
            <div className="font-bold" style={{ fontSize: 18, color: 'var(--color-state-success)' }}>
              {Math.floor(todayTotal / 60)}h {todayTotal % 60}m
            </div>
            {hasChapterAttribution && (
              <div
                data-testid="pomodoro-chapter-settlement"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))',
                  border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border))',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-md)',
                }}
              >
                <div className="text-xs text-muted" style={{ marginBottom: 4 }}>关联章节</div>
                <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{taskSettlement.chapterTitle}</div>
                <div className="text-xs" style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                  {taskSettlement.chapterCompleted ? '章节已完成' : '本次结算是否同时完成该章节？'}
                </div>
              </div>
            )}
          </div>
        </div>

        {showSettlementActions && isWorkComplete && taskSettlement && (
          <div className="flex flex-col gap-sm" style={{ marginBottom: 'var(--space-sm)', textAlign: 'left' }}>
            <div
              data-testid="pomodoro-task-settlement"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-md)',
              }}
            >
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>绑定任务</div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{taskSettlement.title}</div>
              <div className="text-xs" style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                {taskSettlement.subjectName || '未选择科目'} · {taskSettlement.status} · {taskSettlement.duration} 分钟
              </div>
            </div>
            {pendingReviewEntryCreation ? (
              <div
                data-testid="pomodoro-review-entry-prompt"
                className="flex flex-col gap-sm"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-tertiary)',
                  padding: 'var(--space-md)',
                }}
              >
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  本次专注对应日期还没有日记
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  专注和任务结算已保存。是否创建对应日期的日记并写入这条复盘？
                </p>
                <button
                  type="button"
                  className="button button-primary w-full"
                  disabled={isSettlingTask}
                  data-testid="pomodoro-review-create-entry"
                  onClick={() => { void onResolveReviewEntryCreation?.(true) }}
                  style={{ height: 40, borderRadius: 20, fontSize: 14, fontWeight: 600 }}
                >
                  {isSettlingTask ? '写入中...' : '创建日记并写入复盘'}
                </button>
                <button
                  type="button"
                  className="button button-secondary w-full"
                  disabled={isSettlingTask}
                  data-testid="pomodoro-review-skip-entry"
                  onClick={() => { void onResolveReviewEntryCreation?.(false) }}
                  style={{ height: 38, borderRadius: 19, fontSize: 13 }}
                >
                  不创建日记，完成结算
                </button>
              </div>
            ) : (
              <textarea
                className="input w-full"
                data-testid="pomodoro-focus-review-input"
                value={reviewText}
                onChange={event => setReviewText(event.target.value)}
                placeholder="一句话复盘（可选）"
                rows={3}
                disabled={isSettlingTask}
                style={{ resize: 'vertical', minHeight: 76 }}
              />
            )}
            {settlementError && (
              <div data-testid="pomodoro-settlement-error" className="text-sm" style={{ color: 'var(--danger)' }}>
                {settlementError}
              </div>
            )}
            {!pendingReviewEntryCreation && (
              <>
                {canCompleteChapter ? (
                  <>
                    <button
                      className="button button-primary w-full"
                      onClick={() => { void onSettleTask?.({ completeTask: true, completeChapter: true, reviewText }) }}
                      disabled={isSettlingTask}
                      data-testid="pomodoro-settle-complete-chapter"
                      style={{ height: 42, borderRadius: 22, fontSize: 14, fontWeight: 600 }}
                    >
                      {isSettlingTask ? '保存中...' : '完成任务并完成章节'}
                    </button>
                    <button
                      className="button button-secondary w-full"
                      onClick={() => { void onSettleTask?.({ completeTask: true, completeChapter: false, reviewText }) }}
                      disabled={isSettlingTask}
                      data-testid="pomodoro-settle-task-only"
                      style={{ height: 40, borderRadius: 20, fontSize: 14, fontWeight: 600 }}
                    >
                      仅完成任务，章节暂不完成
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-primary w-full"
                    onClick={() => { void onSettleTask?.({ completeTask: true, reviewText }) }}
                    disabled={isSettlingTask}
                    data-testid="pomodoro-settle-complete"
                    style={{ height: 42, borderRadius: 22, fontSize: 14, fontWeight: 600 }}
                  >
                    {isSettlingTask ? '保存中...' : '标记任务完成'}
                  </button>
                )}
                <button
                  className="button button-secondary w-full"
                  onClick={() => {
                    void onSettleTask?.(hasChapterAttribution
                      ? { completeTask: false, completeChapter: false, reviewText }
                      : { completeTask: false, reviewText })
                  }}
                  disabled={isSettlingTask}
                  data-testid="pomodoro-settle-continue"
                  style={{ height: 40, borderRadius: 20, fontSize: 14, fontWeight: 600 }}
                >
                  保持任务进行中
                </button>
                <button
                  className="button w-full"
                  onClick={() => {
                    void onSettleTask?.(hasChapterAttribution
                      ? { completeTask: false, completeChapter: false, reviewText: '' }
                      : { completeTask: false, reviewText: '' })
                  }}
                  disabled={isSettlingTask}
                  data-testid="pomodoro-settle-skip-review"
                  style={{ height: 38, borderRadius: 19, fontSize: 13 }}
                >
                  跳过复盘，仅保存专注记录
                </button>
                <button
                  className="button button-secondary w-full"
                  onClick={onAddMistake}
                  disabled={isSettlingTask}
                  data-testid="pomodoro-alert-add-mistake"
                  style={{ height: 40, borderRadius: 20, fontSize: 14, fontWeight: 600 }}
                >
                  添加错题
                </button>
              </>
            )}
          </div>
        )}
        {showSettlementActions && isWorkComplete && !taskSettlement && (
          <div className="flex flex-col gap-sm" style={{ marginBottom: 'var(--space-sm)' }}>
            <button
              className="button button-primary w-full"
              onClick={onWriteDiary}
              data-testid="pomodoro-alert-write-diary"
              style={{ height: 42, borderRadius: 22, fontSize: 14, fontWeight: 600 }}
            >
              写入今日日记
            </button>
            <button
              className="button button-secondary w-full"
              onClick={onAddMistake}
              data-testid="pomodoro-alert-add-mistake"
              style={{ height: 40, borderRadius: 20, fontSize: 14, fontWeight: 600 }}
            >
              添加错题
            </button>
            <button
              className="button w-full"
              onClick={onClose}
              data-testid="pomodoro-alert-save-only"
              style={{ height: 38, borderRadius: 19, fontSize: 13 }}
            >
              仅保存专注 ({autoCloseTimer}s)
            </button>
          </div>
        )}
        {!(showSettlementActions && isWorkComplete) && (
          <button
            className="button button-primary w-full"
            onClick={onClose}
            data-testid="pomodoro-alert-primary-action"
            style={{
              height: 44, borderRadius: 22, fontSize: 15, fontWeight: 600,
            }}
          >
            {isWorkComplete ? '开始休息' : '继续专注'} ({autoCloseTimer}s)
          </button>
        )}
      </div>

      <style>{`
        @keyframes pomodoro-alert-pop {
          0% { opacity: 0; transform: scale(0.85) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pomodoro-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  )
}
