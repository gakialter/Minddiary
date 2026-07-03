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
  version: '1.13.3',
  title: '本次更新',
  items: [
    '附件单项删除与条目附件清理在 unlink 前执行 realpath containment。',
    '托管错题图片删除会阻止 junction / symlink 将目标重定向到托管目录之外。',
    '目标文件或托管目录缺失时保持兼容，其他文件系统错误继续上抛。',
    'schema unchanged / API unchanged / migration unchanged / dependency unchanged。',
  ],
}
