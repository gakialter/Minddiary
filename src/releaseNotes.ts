export interface LocalReleaseNotes {
  version: string
  title: string
  items: readonly string[]
}

/**
 * Bundled with the renderer so the installed app can explain the current
 * release without GitHub access or a network connection.
 */
export const CURRENT_RELEASE_NOTES: LocalReleaseNotes = {
  version: '1.18.0',
  title: '本次更新',
  items: [
    '今日任务（Today Action）和 Daily Review 新增规划策略、候选解释与确认结果记录，创建任务前更容易核对。',
    '新增本地 Planning History，可回看最近 30 天、最多 100 次规划，并可随时清空。',
    'Today Action 可选择历史任务结果作为规划参考，并使用有界、只读的章节进度上下文。',
    '错题本新增 AI 错题复习规划，从到期错题生成建议，确认后才创建任务。',
    '已确认的 AI 学习任务使用幂等 receipt 与本地恢复区，降低重复创建和不确定结果风险。',
    'SQLite schema 7 新增持久化规划历史；现有有序 migration 支持 Schema 6 → 7，正式 v1.17.1 数据沿 5 → 6 → 7 升级。',
    'Windows 安装版 updater 已加入真实下载、安装、重启与数据保留的 CI 端到端覆盖。',
  ],
}
