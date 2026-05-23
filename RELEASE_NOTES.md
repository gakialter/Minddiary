# MindDiary v1.9.4

本次更新带来了更完整的日记 / 错题笔记编辑体验，以及新的专注数据洞察能力，同时修复了若干使用体验问题。

## 新功能

### Dashboard 专注分布图表
- 新增专注时间分布图，按科目展示投入时间占比。
- 支持“今日 / 近 7 天 / 近 30 天”范围切换。
- 支持空状态和暗色模式显示。

### 日记与错题笔记 Markdown 工具栏
- 日记编辑器支持快捷插入：
  - 加粗
  - 高亮
  - 下划线
  - 预设文字颜色
- 错题 notes 字段支持同样的基础格式能力。
- 题目和答案仍保持原有 LaTeX 渲染逻辑。

### 安全的预设颜色语法
- 支持 `{color:red}文字{/color}` 等预设颜色语法。
- 仅允许 red / orange / yellow / green / blue / purple / gray。
- 不支持任意 CSS、HEX 或 HTML 注入。

## 修复与优化

- 修复今日决策 CTA 始终显示“第 1 个有效番茄”的问题。
- 防止专注计时中切换模式导致当前 session 丢失。
- 优化暗色模式下引导文字和说明文字的可读性。
- 修复 SearchPanel 测试在 CI 中偶发超时的问题。

## 发布说明

- Windows 安装包如未进行代码签名，可能出现 Unknown Publisher 或 Windows SmartScreen 提示。
- macOS 构建由 GitHub Actions 自动生成。
