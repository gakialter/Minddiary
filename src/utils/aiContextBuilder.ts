import type {
    AppSettings,
    DiaryEntry,
    Mistake,
    PomodoroRangeEntry,
    StudyTask,
    Subject,
    SubjectChapter,
} from '../types'
import type {
    EntriesContextAPI,
    MistakesContextAPI,
    PomodoroContextAPI,
    SubjectChaptersContextAPI,
    SubjectsContextAPI,
    TasksContextAPI,
} from '../types/api'
import { sanitizeUserInput } from './promptTemplates'
import { AI_CONTEXT_LABELS, type AIContextKind } from './aiQuickPrompts'
import { getPrimaryCountdownEvent, normalizeCountdownEvents } from './countdown'

export interface AIContextSection {
    kind: AIContextKind
    label: string
    content: string
    truncated: boolean
}

export interface AIContextBuildDeps {
    entry: DiaryEntry | null
    settingsData: AppSettings
    entries: EntriesContextAPI
    mistakes: MistakesContextAPI
    subjects: SubjectsContextAPI
    subjectChapters?: SubjectChaptersContextAPI
    tasks: TasksContextAPI
    pomodoro: PomodoroContextAPI
}

const CONTEXT_LIMITS = {
    diaryChars: 8_000,
    mistakeCount: 40,
    unmasteredMistakeCount: 20,
    mistakeQuestionChars: 240,
    mistakeNotesChars: 180,
    recentReflectionDays: 7,
    recentEntryChars: 600,
    subjectChapterPreviewCount: 3,
} as const

function getLocalDateKey(date = new Date()): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
    const sanitized = sanitizeUserInput(text)
    if (sanitized.length <= limit) return { text: sanitized, truncated: false }
    return { text: `${sanitized.slice(0, limit)}\n[以下为裁剪后的数据，原始内容更长。]`, truncated: true }
}

function summarizeMistake(mistake: Mistake, index: number): string {
    const question = truncateText(mistake.question || '（无题目）', CONTEXT_LIMITS.mistakeQuestionChars).text
    const notes = truncateText(mistake.notes || '', CONTEXT_LIMITS.mistakeNotesChars).text
    return [
        `【${index + 1}】科目：${sanitizeUserInput(mistake.subject_name || '未分类')}`,
        `题目：${question}`,
        notes ? `笔记：${notes}` : '',
        `掌握状态：${mistake.mastered ? '已掌握' : '未掌握'}`,
    ].filter(Boolean).join('\n')
}

function formatSubjectChapterSummary(chapters: SubjectChapter[]): string {
    if (chapters.length === 0) return ''
    const ordered = [...chapters].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    const completed = ordered.filter(chapter => chapter.completed).length
    const open = ordered.filter(chapter => !chapter.completed)
    const next = open[0]?.title
    const preview = open.slice(0, CONTEXT_LIMITS.subjectChapterPreviewCount).map(chapter => sanitizeUserInput(chapter.title)).join('；')
    return [
        `详细章节 ${completed}/${ordered.length}`,
        next ? `下一章节：${sanitizeUserInput(next)}` : '全部章节已完成',
        preview && open.length > 1 ? `近期未完成：${preview}` : '',
    ].filter(Boolean).join('，')
}

async function formatSubjects(subjects: Subject[], subjectChapters?: SubjectChaptersContextAPI): Promise<string> {
    if (subjects.length === 0) return '暂无科目数据。'
    const chapterSummaries = new Map<number, string>()
    if (subjectChapters) {
        await Promise.all(subjects.map(async subject => {
            try {
                chapterSummaries.set(subject.id, formatSubjectChapterSummary(await subjectChapters.getBySubject(subject.id)))
            } catch {
                chapterSummaries.set(subject.id, '')
            }
        }))
    }
    return subjects.map(subject => {
        const progress = typeof subject.total_chapters === 'number' && subject.total_chapters > 0
            ? `，章节进度 ${subject.completed_chapters || 0}/${subject.total_chapters}`
            : ''
        const chapterSummary = chapterSummaries.get(subject.id)
        return `- ${sanitizeUserInput(subject.name)}${progress}${chapterSummary ? `，${chapterSummary}` : ''}`
    }).join('\n')
}

function formatTasks(tasks: StudyTask[]): string {
    if (tasks.length === 0) return '今日暂无学习任务。'
    return tasks.slice(0, 20).map(task => (
        `- ${sanitizeUserInput(task.title)}（${task.status}，${task.estimate_minutes || 0} 分钟）`
    )).join('\n')
}

function formatPomodoro(entries: PomodoroRangeEntry[]): string {
    const totalMinutes = entries.reduce((sum, entry) => sum + (entry.total_minutes || 0), 0)
    const sessions = entries.reduce((sum, entry) => sum + (entry.session_count || 0), 0)
    return `最近 ${entries.length} 天专注：${totalMinutes} 分钟，${sessions} 次。`
}

async function buildCurrentDiaryContext(deps: AIContextBuildDeps): Promise<AIContextSection> {
    if (!deps.entry?.content?.trim()) {
        throw new Error('当前没有可用日记内容。你可以移除“今日日记”上下文后作为普通请求发送。')
    }
    const content = truncateText(
        `日期：${deps.entry.date}\n标题：${deps.entry.title}\n正文：\n${deps.entry.content}`,
        CONTEXT_LIMITS.diaryChars,
    )
    return { kind: 'current-diary', label: AI_CONTEXT_LABELS['current-diary'], content: content.text, truncated: content.truncated }
}

async function buildMistakePatternsContext(deps: AIContextBuildDeps): Promise<AIContextSection> {
    const response = await deps.mistakes.getAll({ limit: CONTEXT_LIMITS.mistakeCount })
    const mistakes = response.data || []
    if (mistakes.length === 0) {
        throw new Error('当前没有错题记录。你可以移除“错题规律”上下文后作为普通请求发送。')
    }
    const content = mistakes.slice(0, CONTEXT_LIMITS.mistakeCount).map(summarizeMistake).join('\n\n')
    return {
        kind: 'mistake-patterns',
        label: AI_CONTEXT_LABELS['mistake-patterns'],
        content: mistakes.length > CONTEXT_LIMITS.mistakeCount ? `${content}\n[以下为裁剪后的数据。]` : content,
        truncated: mistakes.length > CONTEXT_LIMITS.mistakeCount,
    }
}

async function buildUnmasteredMistakesContext(deps: AIContextBuildDeps): Promise<AIContextSection> {
    const response = await deps.mistakes.getAll({ mastered: false, limit: CONTEXT_LIMITS.unmasteredMistakeCount })
    const mistakes = response.data || []
    if (mistakes.length === 0) {
        throw new Error('当前没有未掌握错题。你可以移除“未掌握错题”上下文后作为普通请求发送。')
    }
    return {
        kind: 'unmastered-mistakes',
        label: AI_CONTEXT_LABELS['unmastered-mistakes'],
        content: mistakes.slice(0, CONTEXT_LIMITS.unmasteredMistakeCount).map(summarizeMistake).join('\n\n'),
        truncated: false,
    }
}

async function buildStudyOverviewContext(deps: AIContextBuildDeps): Promise<AIContextSection> {
    const today = getLocalDateKey()
    const [subjects, tasks, range] = await Promise.all([
        deps.subjects.getAll(),
        deps.tasks.getByDate(today),
        deps.pomodoro.getRange(getLocalDateKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)), today).catch(() => []),
    ])
    const content = [
        `日期：${today}`,
        '科目进度：',
        await formatSubjects(subjects || [], deps.subjectChapters),
        '今日任务：',
        formatTasks(tasks || []),
        formatPomodoro(range || []),
    ].join('\n')
    return { kind: 'study-overview', label: AI_CONTEXT_LABELS['study-overview'], content, truncated: false }
}

async function buildExamCountdownContext(deps: AIContextBuildDeps): Promise<AIContextSection> {
    const today = getLocalDateKey()
    const primaryEvent = getPrimaryCountdownEvent(normalizeCountdownEvents(
        deps.settingsData.countdownEvents,
        deps.settingsData.examDate,
    ))
    if (!primaryEvent) {
        throw new Error('当前没有主目标日期设置。你可以移除“主目标倒计时”上下文后作为普通请求发送。')
    }
    const todayDate = new Date(`${today}T00:00:00`)
    const exam = new Date(`${primaryEvent.date}T00:00:00`)
    const daysLeft = Math.ceil((exam.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000))
    const content = `本地日期：${today}\n主目标名称：${sanitizeUserInput(primaryEvent.title)}\n主目标日期：${primaryEvent.date}\n剩余天数：${daysLeft}`
    return { kind: 'exam-countdown', label: AI_CONTEXT_LABELS['exam-countdown'], content, truncated: false }
}

async function buildRecentReflectionContext(deps: AIContextBuildDeps): Promise<AIContextSection> {
    const today = getLocalDateKey()
    const entries = await deps.entries.getAll({
        endDate: today,
        limit: CONTEXT_LIMITS.recentReflectionDays,
        includeContent: true,
    })
    if (!entries || entries.length === 0) {
        throw new Error('最近没有可用复盘记录。你可以移除“近期复盘”上下文后作为普通请求发送。')
    }
    let truncated = false
    const content = entries.slice(0, CONTEXT_LIMITS.recentReflectionDays).map(entry => {
        const summary = truncateText(entry.content || entry.content_snippet || '', CONTEXT_LIMITS.recentEntryChars)
        if (summary.truncated) truncated = true
        return `日期：${entry.date}\n标题：${sanitizeUserInput(entry.title)}\n摘要：${summary.text}`
    }).join('\n\n')
    return { kind: 'recent-reflection', label: AI_CONTEXT_LABELS['recent-reflection'], content, truncated }
}

const CONTEXT_BUILDERS: Record<AIContextKind, (deps: AIContextBuildDeps) => Promise<AIContextSection>> = {
    'current-diary': buildCurrentDiaryContext,
    'mistake-patterns': buildMistakePatternsContext,
    'unmastered-mistakes': buildUnmasteredMistakesContext,
    'study-overview': buildStudyOverviewContext,
    'exam-countdown': buildExamCountdownContext,
    'recent-reflection': buildRecentReflectionContext,
}

export async function buildAIContextSections(
    kinds: AIContextKind[],
    deps: AIContextBuildDeps,
): Promise<AIContextSection[]> {
    const sections: AIContextSection[] = []
    for (const kind of kinds) {
        sections.push(await CONTEXT_BUILDERS[kind](deps))
    }
    return sections
}
