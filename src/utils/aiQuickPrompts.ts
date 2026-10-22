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
    'unmastered-mistakes': '未掌握',
    'study-overview': '学习概况',
    'exam-countdown': '目标倒数',
    'recent-reflection': '近期回顾',
}

export const AI_QUICK_PROMPT_TEMPLATES: AIQuickPromptTemplate[] = [
    {
        id: 'daily-summary',
        label: '日记总结',
        draft: '请先让我在对话中提供今天的学习内容、主要收获和待解决的问题，再只根据我提供的内容进行总结，并给出下一步建议。',
        contextKinds: [],
    },
    {
        id: 'mistake-patterns',
        label: '错题规律',
        draft: '请先让我在对话中提供错题题目、解题过程和出错原因，再只根据我提供的内容分析反复出现的薄弱点，并给出三个优先改进方向。',
        contextKinds: [],
    },
    {
        id: 'quiz-me',
        label: '错题测验',
        draft: '请先让我在对话中提供尚未掌握的题目和解题困难，再只根据我提供的内容出一道类似题考我。先只出题，不要立即给答案。',
        contextKinds: [],
    },
    {
        id: 'mental-massage',
        label: '状态调整',
        draft: '请先让我在对话中说明当前的学习状态和遇到的困难，再只根据我提供的内容，给出克制、具体、可以立即执行的调整建议。',
        contextKinds: [],
    },
    {
        id: 'sprint-plan',
        label: '冲刺计划',
        draft: '请先问我考试日期、每天可用时间、复习科目和当前复习情况，再根据我在对话中提供的信息，制定一份现实、可执行的阶段复习计划。',
        contextKinds: [],
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
