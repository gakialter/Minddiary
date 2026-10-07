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
  version: '1.20.0',
  title: '本次更新',
  items: [
    'AI 助手支持添加 PNG、JPEG、WebP 图片，或通过文件选择、拖入和 Ctrl+V 添加；单次最多 5 个附件，其中最多 3 张图片，当前模型必须支持视觉输入。',
    '可在本机提取文字型 PDF 内容并随当前消息发送给 AI；每份 PDF 最多 10 MiB、50 页，PDF 与文本文件提取文字合计最多 20,000 字符。扫描版 PDF 不支持 OCR，PDF 图片和页面视觉内容不会被理解。',
    '日记选区润色可先编辑 AI 候选再明确应用；重新生成失败时保留现有候选，正文或选区变化时旧候选失效，应用后可撤销。',
    '更新 DeepSeek、通义千问、GLM、Kimi、豆包精选模型目录，并保留自定义 Provider。',
    '修复中文正常表达被误判为限制指令、较早的自动保存覆盖较新日记内容，以及不完整 AI 回复被当作成功结果等问题。',
    'AI 附件只用于当前发送；PDF 二进制、本地路径和附件正文不会写入聊天历史或本地持久化记录。',
    'SQLite schema 8 保持不变，无新增数据迁移，继续使用现有本地数据与备份恢复格式。',
  ],
}
