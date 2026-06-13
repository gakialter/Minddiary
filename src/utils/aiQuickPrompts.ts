import type { ReactNode } from 'react'

export type AIQuickPromptId =
    | 'daily-summary'
    | 'mistake-patterns'
    | 'quiz-me'
    | 'mental-massage'
    | 'sprint-plan'

export type AIContextKind =
    | 'current-diary'
    | 'mistake-patterns'
    | 'unmastered-mistakes'
    | 'study-overview'
    | 'exam-countdown'
    | 'recent-reflection'

export interface AIQuickPromptTemplate {
    id: AIQuickPromptId
    label: string
    draft: string
    contextKinds: AIContextKind[]
}

export interface AIQuickPromptViewModel extends AIQuickPromptTemplate {
    icon: ReactNode
    disabledReason?: string
}

export const AI_CONTEXT_LABELS: Record<AIContextKind, string> = {
    'current-diary': '今日日记',
    'mistake-patterns': '错题规律',
    'unmastered-mistakes': '未掌握错题',
    'study-overview': '学习概况',
    'exam-countdown': '考试倒计时',
    'recent-reflection': '近期复盘',
}

export const AI_QUICK_PROMPT_TEMPLATES: AIQuickPromptTemplate[] = [
    {
        id: 'daily-summary',
        label: '总结今日日记',
        draft: '请总结我今天的学习内容、主要收获、仍未解决的问题，并给出下一步建议。',
        contextKinds: ['current-diary'],
    },
    {
        id: 'mistake-patterns',
        label: '错题规律分析',
        draft: '请分析我近期错题中反复出现的薄弱点，并给出三个优先改进方向。',
        contextKinds: ['mistake-patterns'],
    },
    {
        id: 'quiz-me',
        label: '考考我',
        draft: '请根据我尚未掌握的错题出一道题考我。先只出题，不要立即给答案。',
        contextKinds: ['unmastered-mistakes'],
    },
    {
        id: 'mental-massage',
        label: '心理按摩',
        draft: '请根据我当前的学习状态，给出克制、具体、可以立即执行的调整建议，不要使用空泛鼓励。',
        contextKinds: ['recent-reflection'],
    },
    {
        id: 'sprint-plan',
        label: '制定复习冲刺',
        draft: '请根据剩余时间和当前学习情况，为我制定一份现实、可执行的阶段复习计划。',
        contextKinds: ['exam-countdown', 'study-overview'],
    },
]

export function appendQuickPromptDraft(currentInput: string, draft: string): string {
    const trimmedDraft = draft.trim()
    if (!currentInput.trim()) return trimmedDraft
    return `${currentInput.replace(/\s+$/, '')}\n\n${trimmedDraft}`
}

export function mergeContextKinds(current: AIContextKind[], next: AIContextKind[]): AIContextKind[] {
    const seen = new Set<AIContextKind>()
    const merged: AIContextKind[] = []
    for (const kind of [...current, ...next]) {
        if (seen.has(kind)) continue
        seen.add(kind)
        merged.push(kind)
    }
    return merged
}
