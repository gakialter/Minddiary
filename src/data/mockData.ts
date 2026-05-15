// Mock 数据 - 用于前端开发和测试
import type { DiaryEntry, Tag, AppSettings, Subject, Mistake, MoodId, StorageKeys } from '../types'

export const mockTags: Tag[] = [
  { id: 1, name: '政治', color: '#C65A3A' },
  { id: 2, name: '英语', color: '#0F766E' },
  { id: 3, name: '数学', color: '#0D655E' },
  { id: 4, name: '专业课', color: '#2F8F6B' },
  { id: 5, name: '错题', color: '#D97706' },
  { id: 6, name: '灵感', color: '#475569' },
]

export const mockEntries: DiaryEntry[] = [
  {
    id: 1,
    date: '2024-03-06',
    title: '考研第一天：政治马原复习',
    content: `## 今日学了什么
- 马克思主义哲学基本原理
- 唯物论与辩证法的核心概念
- 做了10道选择题

## 薄弱点 / 疑问
- 唯物辩证法的三大规律还不太熟练
- 质量互变规律的例子需要多记几个

## 明日计划
- 继续政治马原第二章
- 英语单词背诵 Unit 3
- 数学高数第一章习题

## 感悟 / 碎碎念
今天是正式开始考研复习的第一天，有点紧张但也很兴奋。加油！`,
    mood: 'motivated' as MoodId,
    tags: [1],
    word_count: 156,
    images: [],
    created_at: '2024-03-06T09:00:00Z',
    updated_at: '2024-03-06T09:00:00Z'
  },
  {
    id: 2,
    date: '2024-03-05',
    title: '英语阅读理解技巧总结',
    content: `## 今日学了什么
- 阅读理解做题技巧
- 长难句分析方法
- 完成了5篇阅读真题

## 薄弱点 / 疑问
- 推理题正确率不高，只有60%
- 长难句的定语从句部分理解困难

## 明日计划
- 专门练习推理题
- 背诵50个核心词汇
- 复习今天的错题

## 感悟 / 碎碎念
英语阅读感觉有点吃力，需要多练习。`,
    mood: 'tired' as MoodId,
    tags: [2, 5],
    word_count: 132,
    images: [],
    created_at: '2024-03-05T20:30:00Z',
    updated_at: '2024-03-05T20:30:00Z'
  },
  {
    id: 3,
    date: '2024-03-04',
    title: '数学高数极限专题',
    content: `## 今日学了什么
- 极限的定义与性质
- 两个重要极限
- 无穷小的比较

## 薄弱点 / 疑问
- 洛必达法则的适用条件还需要巩固
- 等价无穷小替换容易出错

## 明日计划
- 做极限综合练习题30道
- 复习导数的定义
- 看视频课程第5讲

## 感悟 / 碎碎念
数学真的很难，但今天终于把极限的两个定理搞懂了！`,
    mood: 'happy' as MoodId,
    tags: [3],
    word_count: 128,
    images: [],
    created_at: '2024-03-04T19:15:00Z',
    updated_at: '2024-03-04T19:15:00Z'
  },
]

export const mockSettings: AppSettings = {
  theme: 'auto',
  examDate: '2024-12-23',
  countdownEvents: [
    {
      id: 'default-exam',
      title: '考研初试',
      date: '2024-12-23',
      type: 'exam',
      pinned: true,
    },
  ],
  dailyGoal: 8,
  autoSave: true,
  notifications: true,
  aiEndpoint: '',
  aiApiKeyMasked: null,
  aiApiKeyPresent: false,
  aiModel: 'gpt-3.5-turbo',
  pomodoroMinutes: 25,
  focusGuardEnabled: false,
  focusGuardIntervalSec: 5,
  focusWhitelist: [],
  autoBackup: false,
  backupPath: '',
}

export const mockSubjects: Subject[] = [
  { id: 1, name: '政治', color: '#C65A3A', order: 1 },
  { id: 2, name: '英语', color: '#0F766E', order: 2 },
  { id: 3, name: '数学', color: '#0D655E', order: 3 },
  { id: 4, name: '专业课', color: '#2F8F6B', order: 4 },
]

export const mockMistakes: Mistake[] = [
  {
    id: 1,
    subject_id: 3,
    question: '求极限 lim(x→0) (sin x / x)',
    answer: '答案是 1，这是重要极限公式之一',
    notes: '两个重要极限必须记住',
    mastered: false,
    created_at: '2024-03-04T10:00:00Z',
    ease_factor: 2.5,
    review_interval: 0,
    next_review_date: null,
    review_count: 0,
  },
  {
    id: 2,
    subject_id: 2,
    question: 'The book is _____ interesting that I can\'t put it down.',
    answer: '答案是 so，so...that 是固定搭配，表示"如此...以至于"',
    notes: 'such 后面接名词，so 后面接形容词',
    mastered: false,
    created_at: '2024-03-05T14:30:00Z',
    ease_factor: 2.5,
    review_interval: 0,
    next_review_date: null,
    review_count: 0,
  },
  {
    id: 3,
    subject_id: 1,
    question: '新民主主义革命的三大法宝是什么？',
    answer: '统一战线、武装斗争、党的建设',
    notes: '群众路线是党的建设的重要内容，不要记混',
    mastered: true,
    created_at: '2024-03-01T09:00:00Z',
    ease_factor: 2.5,
    review_interval: 1,
    next_review_date: null,
    review_count: 0,
  },
]

// localStorage keys
export const STORAGE_KEYS: StorageKeys = {
  ENTRIES: 'mindiary_entries',
  TAGS: 'mindiary_tags',
  SETTINGS: 'mindiary_settings',
  MISTAKES: 'mindiary_mistakes',
  SUBJECTS: 'mindiary_subjects',
}
