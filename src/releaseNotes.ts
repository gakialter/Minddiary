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
  version: '1.21.1',
  title: '本次更新',
  items: [
    '日记页可选择日期、回到今天，并切换同一天的多篇日记；搜索打开和保存具体记录更准确，返回写日记时保留历史日期。',
    '未发送的 AI 文字草稿和附件、日记润色候选在同次运行中跨页保留，刷新或重启后清空；润色仍需确认应用，正文变化后旧候选失效，应用后可撤销。',
    '今日任务可直接开始专注并关联任务及科目；新建或重命名科目后，专注选项及时更新。新用户首页提供设置日期、创建科目和添加任务的入口。',
    'AI 配置问题提供具体提示；快捷入口只填草稿，由用户在对话中提供资料后主动发送，不自动读取本机日记或错题。',
    '减少普通知识问句和“不要给答案”等回答要求被误拦截，明确的数据、传输和工具限制仍生效。',
    '改善长日记选区工具栏和数学公式显示，支持 AI 回复、错题备注、复习弹窗及日记 AI 汇总中的公式；日记正文暂不提供公式实时预览。',
    '设置 JSON 只处理日记文字、标签、科目汇总和错题，不能替代完整 ZIP 备份；整次导入不支持自动回滚，再次导入会继续新增错题。',
    'SQLite schema 8 保持不变，无新增数据迁移，继续使用现有本地数据目录。',
  ],
}
