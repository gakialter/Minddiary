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
  version: '1.13.2',
  title: '本次更新',
  items: [
    '统一 Electron 与 browser fallback 的错题列表稳定排序。',
    '为 Pomodoro 科目聚合增加确定性 tie-breaker。',
    '修复 #119：连续更新今日章节任务或完成状态时保持列表位置。',
    'SQLite schema unchanged，仍为 schema 5。',
  ],
}
