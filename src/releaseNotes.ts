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
  version: '1.16.0',
  title: '本次更新',
  items: [
    'AI 今日行动现在会显示可解释的规划依据，并对模型候选执行更严格的本地解析、校验和预算限制。',
    '候选任务支持编辑、选择、stale-context 二次确认，以及部分失败后的单项重试。',
    '新增用户手动触发的每日复盘，可生成可编辑的下一日任务候选，确认前不会写入任务。',
    '每日复盘 AI 上下文排除日记正文、错题答案和笔记、图片与附件路径、API Key 及现有任务描述。',
    '修复复盘弹窗滚动定位、后台刷新状态丢失和本地日期切换时显示旧日统计的问题。',
    'schema unchanged / migration unchanged / dependency unchanged；仍使用 SQLite schema 5。',
  ],
}
