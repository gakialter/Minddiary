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
  version: '1.19.1',
  title: '本次更新',
  items: [
    'v1.19.1 包含 v1.19.0 的全部功能，并修复错题本表单在异步状态与格式化工具栏交互时受控字段可能回退的问题。',
    '错题本挂载时移除冗余的数据加载，减少并发刷新，稳定错题本 Markdown 格式化选区行为。',
    '错题本分开提供到期复习与日常复盘；日常复盘按科目设置每日题量，使用不放回轮次，默认纳入已掌握错题，不改写 SM-2。',
    '日常复盘支持跨日续做和重启恢复，完成一轮后需明确开始下一轮。',
    '日记采用单一编辑面，实时预览加粗、下划线、高亮和文字颜色；编辑相关范围时显示语法标记，支持格式开关、快捷键和撤销／重做。',
    '原有 Markdown 仍为日记正文存储格式，已有内容保持兼容，无需日记 schema migration。',
    'AI 选区润色支持润色表达、精简、纠正语病、保持原意改写；仅向已配置 Provider 发送所选正文，候选需点击应用，原文变化时禁用应用，应用后可一步撤销。',
    '统一主导航、错题本、AI、番茄钟与次级工作区的布局和交互，改善浅色／深色主题与紧凑桌面窗口体验。',
    'SQLite schema 8 新增 subject_daily_review_state，保存各科当前复盘配置与轮次进度，不覆盖已有错题或 SM-2 状态；支持 Schema 7 → 8，正式 v1.17.1 数据沿 5 → 6 → 7 → 8 升级。',
  ],
}
