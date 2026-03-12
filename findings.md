# Phase 10 Audit Findings

## Critical Issues

### 1. App-wide Error Boundary 不足
- **文件**: `src/App.jsx`
- **问题**: 只有顶层 ErrorBoundary，单个组件崩溃会白屏整个 app
- **影响**: 用户体验灾难性中断

### 2. DiaryContext 初始化缺乏容错
- **文件**: `src/contexts/DiaryContext.jsx:34-51`
- **问题**: `Promise.all()` 中任一 API 失败导致部分未初始化，但 UI 不知情
- **影响**: 静默失败，用户看到空白区域无法理解

### 3. Dashboard 永久 Skeleton
- **文件**: `src/components/Dashboard.jsx:22-101`
- **问题**: `loadDashboardData()` 失败后 `.catch(() => [])` 静默吞掉错误，skeleton 永远转
- **影响**: 用户以为卡死

## High Severity

### 4. DiaryContext 过大 (490+ 行, 8+ API namespace)
- **文件**: `src/contexts/DiaryContext.jsx`
- **问题**: 单一 context 包含 entries/dashboard/search/pomodoro/subjects/mistakes/settings/attachments
- **影响**: 任何 state 变更导致全量 re-render

### 5. Settings 无防抖
- **文件**: `src/components/Settings.jsx:34-50`
- **问题**: 每次 onChange 立即触发 IPC 调用
- **影响**: 快速切换产生大量 IPC 请求

### 6. AI 请求无超时/取消
- **文件**: `electron/aiService.js`
- **问题**: fetch 无 timeout，用户无法中断
- **影响**: loading 状态无限持续

## Medium Severity

### 7. 大列表无分页
- **文件**: `MistakeBook.jsx`, `Dashboard.jsx`
- **问题**: 全量渲染所有条目
- **影响**: 数据量大时 UI 卡顿

### 8. MistakeBook 搜索无防抖
- **文件**: `src/components/MistakeBook.jsx:18`
- **问题**: 每次按键触发 `loadMistakes()`

### 9. CSP 过于宽松
- **文件**: `electron/main.js:63-68`
- **问题**: `'unsafe-inline'` 让 CSP 形同虚设

### 10. 图片路径遍历风险
- **文件**: `src/components/ImageGallery.jsx:164`
- **问题**: `file://${att.filepath}` 未验证路径安全性

### 11. Settings 导出不完整
- **文件**: `src/components/Settings.jsx:52-71`
- **问题**: 不导出 examDate, aiEndpoint, aiApiKey, aiModel

### 12. Editor lazy-load 缺失
- **文件**: `src/components/Editor.jsx:4`
- **问题**: `dom-to-image-more` 顶层 import 增大首屏 bundle

## Low Severity

### 13. 无障碍 (a11y) 缺失
- icon-only 按钮缺 aria-label
- mastered 状态仅靠颜色区分
- 无 focus-visible 样式

### 14. 无自动备份机制
- 用户必须手动导出

### 15. Pomodoro 设置变更不同步
- 运行中修改 pomodoroMinutes 不生效，也无提示
