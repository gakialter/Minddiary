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
  version: '1.22.0',
  title: '本次更新',
  items: [
    '科目进度采用紧凑导航与独立章节工作区，支持搜索、筛选和章节管理；切换科目保留各自筛选、滚动位置和未提交草稿。',
    '章节可在原行加入今日、查看已加入状态和安全撤销，并同步今日安排数量；已开始、已修改或有重要关联的任务会保留，提示前往今日安排处理。',
    '错题支持“添加并继续”，保留科目并聚焦下一题；修复末页空列表和旧筛选结果覆盖，读取失败时保留结果并提供重试。',
    '首页集中展示今日进展，改善任务操作布局；计时器明确区分开始、继续和已暂停，快捷菜单与通知改善键盘和读屏操作。',
    '改善错题题目、答案中的公式和长内容显示，以及翻页定位和图片预览的焦点与按键处理。',
    'SQLite schema 8 保持不变，无新增数据迁移，继续使用现有本地数据目录。设置 JSON 不能替代完整 ZIP 备份，整次导入不支持自动回滚，再次导入会继续新增错题。',
  ],
}
