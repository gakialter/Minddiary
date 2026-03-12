# Task Plan: Phase 10 — 全面质量提升

## Goal

基于代码审计结果，修复架构缺陷、性能问题、安全隐患和 UX 体验问题，将 MindDiary 从"能用"提升到"健壮"。

## Current Phase

Phase 1 (规划完成，待审批)

## 执行者分配原则

按 DUAL_AI_WORKFLOW_TEMPLATE.md 决策树：

- **Gemini (Antigravity)**: 需要新建多文件 / 大规模改动 / UI 组件重构
- **Claude Sonnet (Claude Code)**: 单文件内部优化 / 精准修复 / 性能调优
- **Claude Opus**: 安全审计 / 架构级重构（已在本次审计中完成规划）

---

## Phases

### Phase 10.1: Error Boundaries + 初始化容错 [CRITICAL]
>
> **执行者: Gemini (Antigravity)**
> 理由: 需要新建 ErrorBoundary 组件 + 改动多个文件的 JSX 结构

- [x] 创建细粒度 `ErrorBoundary` 组件（支持 fallback UI + retry 按钮）
- [x] 在 `App.jsx` 中为每个 view 包裹独立 ErrorBoundary（Dashboard / Editor / Pomodoro / MistakeBook / StudyProgress / Settings）
- [x] `DiaryContext.jsx` 初始化改为逐个 try-catch，记录 `initErrors` 状态，部分失败不阻塞全局
- [x] Dashboard.jsx 添加 error state + 重试按钮（替代永久 skeleton）
- **Status:** ✅ completed
- **验收**: 手动让某个 API 抛错 → 只有该区域显示 fallback，其他功能正常

### Phase 10.2: 性能优化 — 列表虚拟化 + 防抖 [HIGH]
>
> **执行者: Claude Sonnet (Claude Code)**
> 理由: 单文件内部优化，精准修改

- [x] `MistakeBook.jsx`: 搜索/过滤加 debounce (300ms)
- [x] `Settings.jsx`: 多个设置变更合并为 debounced save (500ms)
- [x] 大列表组件（MistakeBook）添加分页（每页 50 条）
- [x] `Editor.jsx`: lazy-load `dom-to-image-more`（动态 import，减少首屏 bundle）
- **Status:** ✅ completed
- **验收**: 1000+ 条数据下滚动流畅；快速切换设置只触发 1 次保存

### Phase 10.3: AI 面板健壮性 [HIGH]
>
> **执行者: Claude Sonnet (Claude Code)**
> 理由: 单文件精准修复

- [x] `aiService.js`: 添加 30 秒超时 + AbortController 支持
- [x] `AIPanel.jsx`: 添加"取消请求"按钮
- [x] `AIPanel.jsx`: 流式响应失败时显示 error toast 而非静默失败
- **Status:** ✅ completed
- **验收**: AI 请求超时后显示友好提示，用户可手动取消

### Phase 10.4: DiaryContext 拆分 [HIGH → 架构改善]
>
> **执行者: claude opus (Antigravity)**
> 理由: 大规模多文件重构，需要改动几乎所有组件的 import

- [ ] 将 `DiaryContext.jsx` (490+ 行) 拆分为：
  - `EntryContext` — entries, dashboard, search, tags
  - `SettingsContext` — settings, theme, isDarkMode
  - `AttachmentsContext` — 文件管理
- [x] 拆分 DiaryContext 为 SettingsContext + DataContext + 聚合层
- [x] 保持向后兼容（useDiary() 不变）
- [x] 不需要修改任何消费组件
- **Status:** ✅ completed
- **验收**: `npx vite build` 成功，全局 useDiary() 接口无任何破坏性变更 可独立 mock 测试

### Phase 10.5: 安全加固 [MEDIUM]
>
> **执行者: Claude opus (Claude Code)**
> 理由: 精准单文件修复 + 安全是 Claude 强项

- [x] `electron/main.js`: CSP 区分 dev/prod，添加 object-src 'none' + base-uri 'self'
- [x] `ImageGallery.jsx`: 验证 `att.filepath` 不含 `../`，防御路径遍历攻击
- [x] `Settings.jsx`: 导出数据时包含所有设置键
- **Status:** ✅ completed
- **验收**: `npx vite build` 成功；CSP 策略生效；路径遍历攻击被拦截

### Phase 10.6: UX 细节打磨 [MEDIUM]
>
> **执行者: Gemini (Antigravity)**
> 理由: UI/UX 改动涉及多组件多样式文件

- [x] 所有 icon-only 按钮添加 `aria-label`（Layout, Pomodoro, Sidebar, ImageGallery）
- [x] 颜色状态指示器加上文字标注（mastered 状态不仅靠颜色）
- [x] 自定义按钮添加 focus-visible 样式（键盘可访问）
- [x] 操作反馈：删除/编辑后显示 toast 提示
- **Status:** ✅ completed
- **验收**: Tab 键可遍历所有按钮；屏幕阅读器能读出按钮用途

### Phase 10.7: 数据安全 — 自动备份 [LOW]
>
> **执行者: Gemini (Antigravity) 写初版 → Claude Sonnet 审计
> 理由: 新功能 + 需要新建文件

- [x] Settings 中添加"自动备份"开关 + 备份路径选择
- [x] `electron/main.js` 添加定时任务（app ready 后每天一次）
- [x] 备份格式复用 `exportUtils.js` 的 `generateJSON()` (直接组装同构数据)
- [x] 保留最近 7 个备份，自动清理旧文件
- **Status:** ✅ completed (Awaiting Claude Sonnet Audit)
- **验收**: 开启后每天自动生成 JSON 备份；超过 7 个时旧备份被删除

---

## 优先级排序 & 依赖关系

```
10.1 Error Boundaries ─────┐
10.3 AI 面板健壮性 ─────────┤ (无依赖，可并行)
10.5 安全加固 ──────────────┘
         │
         ▼
10.2 性能优化 ─────────────┐ (等 10.1 完成，确保 error boundary 能兜底)
10.4 DiaryContext 拆分 ────┘ (最大改动，放在中间，前面的修复不受影响)
         │
         ▼
10.6 UX 细节打磨 ──────────┐ (最后做 UI 层)
10.7 自动备份 ─────────────┘
```

## 工作分配总览

| Phase | 执行者 | 模型 | 理由 |
|-------|--------|------|------|
| 10.1 Error Boundaries | Gemini | Gemini 3.1 Pro | 多文件新建+改动 |
| 10.2 性能优化 | Claude Code | Sonnet 4.6 | 单文件精准优化 |
| 10.3 AI 面板 | Claude Code | Sonnet 4.6 | 单文件修复 |
| 10.4 Context 拆分 | Gemini | Gemini 3.1 Pro | 大规模重构 |
| 10.5 安全加固 | Claude Code | Sonnet 4.6 | 安全是 Claude 强项 |
| 10.6 UX 打磨 | Gemini | Gemini 3.1 Pro | 多组件 UI 改动 |
| 10.7 自动备份 | Gemini 写 → Claude 审 | 混合 | 新功能+审计 |

## 并行执行建议

```
第一批（并行）：
  Gemini  → 10.1 Error Boundaries
  Claude  → 10.3 AI 面板 + 10.5 安全加固

第二批（并行）：
  Gemini  → 10.4 DiaryContext 拆分
  Claude  → 10.2 性能优化

第三批（并行）：
  Gemini  → 10.6 UX 打磨 + 10.7 自动备份（初版）
  Claude  → 10.7 审计
```

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 不引入 Redux/Zustand | 项目规模不需要外部状态管理库，Context 拆分即可 |
| 分页优先于虚拟滚动 | 实现简单，考研日记数据量级分页足够 |
| 保留 DiaryContext 作为聚合层 | 10.4 拆分后保持向后兼容，降低迁移风险 |
| CSP nonce 优先于样式抽取 | Electron 环境下 nonce 更灵活，不影响组件内联样式习惯 |

## Key Questions

1. 虚拟滚动是否必要？→ 先用分页，如果用户反馈慢再升级
2. Context 拆分后是否需要 Provider 嵌套优化？→ 观察 re-render 情况再决定
3. 自动备份是否需要增量？→ V1 全量备份即可，数据量小

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|

## Notes

- 每个 Phase 完成后更新 MEMORY.md
- Gemini 完成的代码必须经过 Claude Code 审计 diff
- 频繁 commit，每个 Phase 一个 commit
