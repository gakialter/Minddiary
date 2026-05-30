# MindDiary v1.9.6

本次更新聚焦“学习闭环增强”：让 Dashboard 长范围专注统计更高效，并让专注结果更容易沉淀为日记和错题。

## 新增与优化

### Dashboard 范围统计性能优化
- 新增范围级 Pomodoro 科目统计能力，按科目聚合专注总时长、专注次数和颜色信息。
- Dashboard 专注分布在今日、近 7 天、近 30 天、单日和自定义范围下使用 `getStatsRange(start, end)`。
- 修复长自定义日期范围会逐日触发大量 renderer 到 Electron IPC 调用的问题。
- 倒计时番茄和正计时 stopwatch 记录都会进入同一范围聚合统计。

### 专注完成后的沉淀入口
- 倒计时番茄完成后显示轻量沉淀入口。
- 有效正计时 session 保存后显示同样的沉淀入口。
- 支持直接写入今日日记，并插入“本轮专注沉淀”模板。
- 支持直接跳转到错题本。
- “仅保存专注”会关闭提示，不影响既有 session 保存。

### 风险池直达今日待复习
- 首页高风险 CTA 进入错题本时默认启用“今日待复习”筛选。
- 筛选口径与今日风险池保持一致：未掌握，且 `next_review_date` 为空或不晚于今天。
- 用户可以清除筛选，回到全部错题。

### 今日决策解释增强
- HomeDashboard 的“查看系统依据”会展示更明确的判断原因。
- 判断解释覆盖高风险、低转化、冷启动和稳定推进状态。
- 解释逻辑放在 `useDashboardMasterState`，便于单元测试覆盖。

## 验证

- Typecheck 通过。
- Unit tests 通过。
- Build 通过。
- E2E tests 通过。
- GitHub CI 通过。

## 发布说明

- 本版本不新增依赖。
- 本版本不新增数据库表。
- 现有 `pomodoro_sessions` 数据结构保持兼容。
- 新增 IPC 仅用于只读范围统计聚合。
- Windows 安装包如果未进行代码签名，仍可能出现 Unknown Publisher 或 Windows SmartScreen 提示。
- PR #69 已合并。
- #67 已自动关闭为 completed。
