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
  version: '1.21.0',
  title: '本次更新',
  items: [
    '日记编辑新增“清除格式”，改善选区格式操作和继续输入时的格式衔接。',
    '学习助手保留当前应用中未发送的文字草稿，切换页面后可继续输入；只保留文字，附件需重新添加，刷新或重启后草稿清空。',
    '已完成或已跳过的今日任务可恢复为待办，原有专注记录继续保留。',
    '改善导出弹窗的键盘操作与焦点恢复，统一操作名称、提示和错误说明。',
    '修复输入后立即离开日记时最新修改可能未保存、并发 PDF 导出互相影响，以及较早的 API Key 保存干扰新输入的问题；留空编辑不会清除已有 Key。',
    'JSON 合并导入先检查字段、科目引用和章节冲突，保留科目完成数量；中途失败时如实提示已完成的操作。修复设置 JSON 导出读取失败时仍生成空数据文件的问题。',
    '设置 JSON 只处理日记文字、标签、科目汇总和错题，不能替代完整 ZIP 备份；整次导入不支持自动回滚，再次导入会继续新增错题。',
    'SQLite schema 8 保持不变，无新增数据迁移，继续使用现有本地数据目录。',
  ],
}
