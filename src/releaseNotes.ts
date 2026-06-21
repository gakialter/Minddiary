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
  version: '1.13.0',
  title: '本次更新',
  items: [
    '今日首页升级为轻量今日执行入口。',
    '新增确定性“推荐下一步”，优先继续进行中任务、章节任务和普通任务。',
    '今日概览展示任务完成、专注时长、章节任务和日记状态。',
    '新增今日复盘入口，普通 Dashboard 与 Pomodoro 流程保持兼容。',
  ],
}
