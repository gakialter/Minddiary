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
  version: '1.12.0',
  title: '本次更新',
  items: [
    '未完成章节可以加入今日任务，并保留科目与章节来源。',
    '章节任务完成专注后，可选择同时完成章节、仅完成任务或保持任务进行。',
    '章节完成后会同步刷新科目进度，普通任务与普通专注流程保持不变。',
    'SQLite schema 升级到 5，自动备份与恢复会保留章节任务关联。',
  ],
}
