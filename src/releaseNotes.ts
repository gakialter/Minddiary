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
  version: '1.13.1',
  title: '本次更新',
  items: [
    '补强 v1.13.0 章节任务 parity audit 与回归覆盖。',
    '强化 schema 4 → 5 迁移断言与兼容性验证，schema 仍为 5。',
    'README 与 release checklist 已同步到 v1.13.0 / schema 5 基线。',
    '修复 #114 错题本图片上传与保存稳定性。',
  ],
}
