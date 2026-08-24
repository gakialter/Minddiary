import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, BookOpen, CheckCircle2, Clock, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { Mistake, StudyTask, Subject } from '../types'
import type {
  AIContextAPI,
  MistakesContextAPI,
  SubjectsContextAPI,
  TasksContextAPI,
} from '../types/api'
import { getLocalDateKey } from '../utils/dateKey'
import {
  computeMistakeReviewContextSignature,
  buildMistakeReviewPromptMessages,
  parseMistakeReviewSuggestions,
  prepareMistakeReviewSession,
  type MistakeReviewCandidateDraft,
} from '../utils/mistakeReviewSuggestions'
import {
  createAIStudyTaskGenerationProvenance,
  type AIStudyTaskGenerationProvenance,
} from '../utils/aiOperationContracts'
import {
  createConfirmedStudyTaskAction,
  createConfirmedStudyTaskOperationId,
  executeConfirmedStudyTaskAction,
  type StudyTaskActionConfirmationSnapshot,
} from '../utils/agentStudyTaskActions'
import { showToast } from './Toast'

export interface MistakeReviewAgentDialogProps {
  currentDate?: string
  onClose: () => void
  onTaskCreated?: (task: StudyTask) => void
  mistakesAPI?: Pick<MistakesContextAPI, 'getAll'>
  subjectsAPI?: Pick<SubjectsContextAPI, 'getAll'>
  tasksAPI?: Pick<TasksContextAPI, 'find' | 'createIdempotentAIStudyTaskForCurrentDate'>
  aiAPI?: Pick<AIContextAPI, 'chat'>
}

type DialogStatus = 'loading' | 'empty' | 'ready' | 'error' | 'unsupported'

type CardExecutionState =
  | { state: 'idle' }
  | { state: 'creating'; operationId: string }
  | { state: 'created'; operationId: string; task: StudyTask }
  | { state: 'failed'; operationId: string; error: string }
  | { state: 'uncertain'; operationId: string; error: string }

type GenerationConfirmationLock = {
  sessionId: number
  candidateId: string
  phase: 'in_flight' | 'uncertain'
}

export default function MistakeReviewAgentDialog({
  currentDate: propCurrentDate,
  onClose,
  onTaskCreated,
  mistakesAPI,
  subjectsAPI,
  tasksAPI,
  aiAPI,
}: MistakeReviewAgentDialogProps) {

  const currentDate = propCurrentDate || getLocalDateKey(new Date())

  const [status, setStatus] = useState<DialogStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [candidates, setCandidates] = useState<MistakeReviewCandidateDraft[]>([])
  const [provenance, setProvenance] = useState<AIStudyTaskGenerationProvenance | null>(null)
  const [sessionSignature, setSessionSignature] = useState<string>('')
  const [generationSessionId, setGenerationSessionId] = useState(0)
  const [cardStates, setCardStates] = useState<Record<string, CardExecutionState>>({})

  const sessionRef = useRef(0)
  const generationConfirmationLockRef = useRef<GenerationConfirmationLock | null>(null)

  const loadSuggestions = useCallback(async () => {
    const activeSessionId = ++sessionRef.current
    generationConfirmationLockRef.current = null
    setStatus('loading')
    setErrorMessage('')
    setCandidates([])
    setCardStates({})
    setGenerationSessionId(0)
    if (!mistakesAPI || !subjectsAPI || !tasksAPI || !aiAPI) {
      setStatus('unsupported')
      return
    }

    try {
      // 1. Fetch complete local due set, subjects, active same-day review tasks
      const [mistakesResult, subjectsList, activeTasks] = await Promise.all([
        mistakesAPI.getAll({ due: true, dueDate: currentDate }),
        subjectsAPI.getAll(),
        tasksAPI.find({
          type: 'review',
          planned_date: currentDate,
          status: ['todo', 'doing'],
        }),
      ])

      if (activeSessionId !== sessionRef.current) return

      const allMistakes: Mistake[] = mistakesResult.data || []
      const subjects: Subject[] = subjectsList || []
      const tasks: StudyTask[] = activeTasks || []

      // 2. Prepare session (deterministic sort, top 12, ephemeral aliases, projection)
      const session = prepareMistakeReviewSession({
        mistakes: allMistakes,
        subjects,
        activeReviewTasks: tasks,
        currentDate,
      })

      if (session.sessionMistakes.length === 0) {
        if (activeSessionId !== sessionRef.current) return
        setStatus('empty')
        return
      }

      // 3. Compute session SHA-256 signature
      const signature = await computeMistakeReviewContextSignature(session.projection)
      if (activeSessionId !== sessionRef.current) return

      const prov = createAIStudyTaskGenerationProvenance('mistake_review', signature)
      setProvenance(prov)
      setSessionSignature(signature)

      // 4. Build prompt messages and call AI API
      const messages = buildMistakeReviewPromptMessages(session.projection)
      const aiResponse = await aiAPI.chat(messages)

      if (activeSessionId !== sessionRef.current) return

      if (
        aiResponse.unsupported
        || aiResponse.content === '请在 Electron 环境中使用 AI 功能'
      ) {
        setStatus('unsupported')
        return
      }

      if (aiResponse.error) {
        setErrorMessage(aiResponse.error)
        setStatus('error')
        return
      }

      // 5. Parse output and extract valid unique candidates (max 4)
      const parsed = parseMistakeReviewSuggestions(
        aiResponse.content,
        session.aliasMap,
        subjects,
        currentDate,
      )

      if (activeSessionId !== sessionRef.current) return

      if (parsed.candidates.length === 0) {
        setStatus('empty')
      } else {
        setCandidates(parsed.candidates)
        const initialStates: Record<string, CardExecutionState> = {}
        parsed.candidates.forEach(c => {
          initialStates[c.clientId] = { state: 'idle' }
        })
        setCardStates(initialStates)
        setGenerationSessionId(activeSessionId)
        setStatus('ready')
      }
    } catch (err: unknown) {
      if (activeSessionId !== sessionRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not supported') || message.includes('unsupported')) {
        setStatus('unsupported')
      } else {
        setErrorMessage(message || '获取 AI 错题复习建议失败')
        setStatus('error')
      }
    }
  }, [currentDate, mistakesAPI, subjectsAPI, tasksAPI, aiAPI])

  useEffect(() => {
    loadSuggestions()
    return () => {
      sessionRef.current += 1
    }
  }, [loadSuggestions])

  const handleConfirmCandidate = async (candidate: MistakeReviewCandidateDraft) => {
    if (
      !provenance
      || !sessionSignature
      || !tasksAPI
      || generationSessionId === 0
      || generationSessionId !== sessionRef.current
    ) return

    const existingLock = generationConfirmationLockRef.current
    if (existingLock?.sessionId === generationSessionId) {
      if (existingLock.phase === 'in_flight' || existingLock.candidateId !== candidate.clientId) {
        return
      }
    }

    const confirmationLock: GenerationConfirmationLock = {
      sessionId: generationSessionId,
      candidateId: candidate.clientId,
      phase: 'in_flight',
    }
    generationConfirmationLockRef.current = confirmationLock

    const currentState = cardStates[candidate.clientId]
    const operationId = (currentState && 'operationId' in currentState && currentState.operationId)
      ? currentState.operationId
      : createConfirmedStudyTaskOperationId()

    setCardStates(prev => ({
      ...prev,
      [candidate.clientId]: { state: 'creating', operationId },
    }))

    const snapshot: StudyTaskActionConfirmationSnapshot = {
      mode: 'mistake_review',
      generation: provenance,
      confirmationContextSignature: sessionSignature,
      generationMistakeRef: candidate.mistake_ref,
      expectedCurrentDate: currentDate,
      plannedDate: currentDate,
    }

    const draft = {
      title: candidate.title,
      description: candidate.reason,
      type: 'review' as const,
      estimate_minutes: candidate.estimate_minutes,
      subject_id: candidate.mistake.subject_id,
      related_mistake_id: candidate.mistake.id,
      related_entry_id: null,
      related_chapter_id: null,
    }

    try {
      const action = createConfirmedStudyTaskAction({
        operationId,
        confirmationSnapshot: snapshot,
        draft,
      })

      const result = await executeConfirmedStudyTaskAction(action, snapshot, tasksAPI)

      if (generationSessionId !== sessionRef.current) return

      if (result.status === 'succeeded') {
        setCardStates(prev => ({
          ...prev,
          [candidate.clientId]: { state: 'created', operationId, task: result.task },
        }))
        showToast('已创建复习任务', 'success')
        if (onTaskCreated) {
          onTaskCreated(result.task)
        }
        await loadSuggestions()
      } else if (result.status === 'failed') {
        setCardStates(prev => ({
          ...prev,
          [candidate.clientId]: { state: 'failed', operationId, error: result.error },
        }))
        await loadSuggestions()
      } else {
        generationConfirmationLockRef.current = {
          ...confirmationLock,
          phase: 'uncertain',
        }
        setCardStates(prev => ({
          ...prev,
          [candidate.clientId]: { state: 'uncertain', operationId, error: result.error },
        }))
      }
    } catch (err: unknown) {
      if (generationSessionId !== sessionRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      generationConfirmationLockRef.current = {
        ...confirmationLock,
        phase: 'uncertain',
      }
      setCardStates(prev => ({
        ...prev,
        [candidate.clientId]: { state: 'uncertain', operationId, error: msg },
      }))
    } finally {
      if (generationConfirmationLockRef.current === confirmationLock) {
        generationConfirmationLockRef.current = null
      }
    }
  }

  const hasBlockingGenerationConfirmation = Object.values(cardStates).some(
    cardState => cardState.state === 'creating' || cardState.state === 'uncertain',
  )

  const dialogContent = (
    <div
      className="modal-overlay"
      data-testid="mistake-review-agent-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-md)',
      }}
    >
      <div
        className="modal-container"
        style={{
          background: 'var(--bg-primary, #ffffff)',
          borderRadius: 12,
          maxWidth: 680,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15))',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-lg, 16px)',
            borderBottom: '1px solid var(--border-color, #e5e7eb)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={20} style={{ color: 'var(--accent, #3b82f6)' }} />
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
              AI 错题复习规划
            </h3>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--bg-secondary, #f3f4f6)',
                color: 'var(--text-secondary, #6b7280)',
              }}
            >
              {currentDate}
            </span>
          </div>
          <button
            type="button"
            className="button-icon"
            data-testid="mistake-review-close-btn"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 'var(--space-lg, 16px)',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {status === 'loading' && (
            <div
              data-testid="mistake-review-loading"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '48px 0',
                gap: 12,
                color: 'var(--text-secondary, #6b7280)',
              }}
            >
              <Loader2 className="animate-spin" size={32} style={{ color: 'var(--accent, #3b82f6)' }} />
              <p style={{ margin: 0, fontSize: '0.875rem' }}>
                正在分析到期错题并生成复习规划建议...
              </p>
            </div>
          )}

          {status === 'unsupported' && (
            <div
              data-testid="mistake-review-unsupported"
              style={{
                padding: '24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <AlertCircle size={36} style={{ color: 'var(--warning, #f59e0b)' }} />
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>AI 复习规划不可用</h4>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary, #6b7280)', maxWidth: 400 }}>
                当前环境不支持 AI 规划或未配置 AI 服务端点。你可以使用上方「开始复习」按钮继续手动复习。
              </p>
            </div>
          )}

          {status === 'empty' && (
            <div
              data-testid="mistake-review-empty"
              style={{
                padding: '36px 0',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <BookOpen size={36} style={{ color: 'var(--text-secondary, #9ca3af)' }} />
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>暂无到期错题或未生成建议</h4>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary, #6b7280)', maxWidth: 380 }}>
                今天没有到期需复习的错题，或所有到期错题已有今日活跃任务。
              </p>
              <button
                type="button"
                className="button button-secondary"
                data-testid="mistake-review-empty-refresh-btn"
                onClick={loadSuggestions}
                style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={14} /> 刷新检查
              </button>
            </div>
          )}

          {status === 'error' && (
            <div
              data-testid="mistake-review-error"
              style={{
                padding: '24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <AlertCircle size={36} style={{ color: 'var(--danger, #ef4444)' }} />
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--danger, #ef4444)' }}>
                生成复习建议遇到问题
              </h4>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary, #6b7280)', maxWidth: 420 }}>
                {errorMessage || '服务请求失败，请稍后重试。'}
              </p>
              <button
                type="button"
                className="button button-primary"
                data-testid="mistake-review-retry-btn"
                onClick={loadSuggestions}
                style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={14} /> 重试
              </button>
            </div>
          )}

          {status === 'ready' && (
            <div
              data-testid="mistake-review-candidate-list"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary, #6b7280)',
                  marginBottom: 4,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>AI 为你挑选了以下值得今天优先复习的错题（最多 4 项）：</span>
                <button
                  type="button"
                  className="button button-secondary"
                  data-testid="mistake-review-regenerate-btn"
                  onClick={loadSuggestions}
                  disabled={hasBlockingGenerationConfirmation}
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <RefreshCw size={12} /> 重新生成
                </button>
              </div>

              {candidates.map((candidate, index) => {
                const cardState = cardStates[candidate.clientId] || { state: 'idle' }
                const isCreating = cardState.state === 'creating'
                const isCreated = cardState.state === 'created'
                const isFailed = cardState.state === 'failed'
                const isUncertain = cardState.state === 'uncertain'

                return (
                  <div
                    key={candidate.clientId}
                    data-testid={`mistake-review-candidate-card-${index}`}
                    style={{
                      border: '1px solid var(--border-color, #e5e7eb)',
                      borderRadius: 8,
                      padding: '12px 16px',
                      background: isCreated
                        ? 'var(--bg-secondary, #f9fafb)'
                        : 'var(--card-bg, #ffffff)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          {candidate.subject_name && (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: 'var(--bg-secondary, #f3f4f6)',
                                color: 'var(--text-primary, #111827)',
                                fontWeight: 500,
                              }}
                            >
                              {candidate.subject_name}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: candidate.overdue_days > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                              color: candidate.overdue_days > 0 ? 'var(--danger, #ef4444)' : 'var(--accent, #3b82f6)',
                              fontWeight: 500,
                            }}
                          >
                            {candidate.overdue_days > 0 ? `已逾期 ${candidate.overdue_days} 天` : '今日到期'}
                          </span>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary, #6b7280)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 2,
                            }}
                          >
                            <Clock size={12} /> {candidate.estimate_minutes} 分钟
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                            已复习 {candidate.review_count} 次
                          </span>
                        </div>
                        <h4
                          style={{
                            margin: 0,
                            fontSize: '0.9375rem',
                            fontWeight: 600,
                            color: 'var(--text-primary, #111827)',
                          }}
                        >
                          {candidate.title}
                        </h4>
                      </div>

                      <div style={{ flexShrink: 0 }}>
                        {isCreated ? (
                          <span
                            data-testid={`mistake-review-created-badge-${index}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.8125rem',
                              color: 'var(--success, #10b981)',
                              fontWeight: 500,
                            }}
                          >
                            <CheckCircle2 size={16} /> 已添加
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="button button-primary"
                            data-testid={`mistake-review-confirm-btn-${index}`}
                            disabled={isCreating || (hasBlockingGenerationConfirmation && !isUncertain)}
                            onClick={() => handleConfirmCandidate(candidate)}
                            style={{
                              padding: '4px 12px',
                              fontSize: '0.8125rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {isCreating && <Loader2 className="animate-spin" size={14} />}
                            {isUncertain ? '重试' : '加入今日规划'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--text-secondary, #4b5563)',
                        lineHeight: 1.5,
                        background: 'var(--bg-secondary, #f9fafb)',
                        padding: '6px 10px',
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ fontWeight: 500, color: 'var(--text-primary, #111827)' }}>理由：</span>
                      {candidate.reason}
                    </div>

                    {isFailed && (
                      <div
                        data-testid={`mistake-review-card-error-${index}`}
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--danger, #ef4444)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <AlertCircle size={14} />
                        创建失败：{cardState.error}
                      </div>
                    )}

                    {isUncertain && (
                      <div
                        data-testid={`mistake-review-card-uncertain-${index}`}
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--warning, #f59e0b)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <AlertCircle size={14} />
                        结果不确定，请点击重试以核对并恢复任务。
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(dialogContent, document.body)
}
