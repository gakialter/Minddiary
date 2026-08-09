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
  version: '1.17.1',
  title: '本次更新',
  items: [
    '今日任务现在支持直接修改标题和预计时长，保存后会即时更新今日总预计时长。',
    '主目标名称和日期可以在设置中自定义，旧 examDate 和普通关键日期继续兼容。',
    '错题连续创建、编辑和失败重试更加稳定，手动备份中的错题批次会先完整校验并原子写入。',
    'Electron 已升级到 42.6.1，better-sqlite3 已升级到 12.11.1。',
    'renderer sandbox、导航与权限边界、ASAR integrity 和 Electron fuses 得到加强。',
    '修复 macOS 发布包验证的 Resources 路径判断，产品 updater 行为保持不变。',
    'SQLite schema 6 新增 study_task_action_receipts，用于 confirmed AI study task idempotency receipts；Windows 自动更新完整 E2E 仍待后续验收。',
  ],
}
