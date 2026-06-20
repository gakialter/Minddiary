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
  version: '1.11.3',
  title: '本次更新',
  items: [
    '新增应用内更新日志展示，可直接查看当前版本的更新内容。',
    '检查到新版本时展示远程更新摘要，无需登录 GitHub。',
    '网络或远程说明不可用时安全降级，不影响应用启动和更新流程。',
    'SQLite schema 保持为 4，备份与恢复格式不变。',
  ],
}
