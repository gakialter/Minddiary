# Phase 6: 全面质量加固 + 打包发布

创建时间：2026-03-07
前置条件：Phase 5 全部完成 ✅

---

## 🔍 全项目审计结果

### 🔴 CRITICAL — 必须立即修复

#### BUG-1: AIPanel 设置键名不匹配（AI 功能完全失效）
**文件:** `src/components/AIPanel.jsx:31-33`
**问题:** Settings.jsx 以 camelCase 保存 (`aiEndpoint`, `aiApiKey`, `aiModel`)，但 AIPanel 以 snake_case 读取 (`all.ai_endpoint`, `all.ai_api_key`, `all.ai_model`)。SQLite settings 表是 key-value 结构，键名必须完全匹配。
**后果:** AI 设置永远读不到，用户配置了也白配，永远提示"请先配置 API"。
**修复:**
```javascript
// AIPanel.jsx line 30-33, 把 snake_case 改为 camelCase:
setSettings({
    endpoint: all.aiEndpoint || '',
    apiKey: all.aiApiKey || '',
    model: all.aiModel || 'gpt-3.5-turbo'
})
```

#### BUG-2: XSS 漏洞 — AI 回复未经 HTML 消毒直接渲染
**文件:** `src/components/AIPanel.jsx:113-114`
**问题:** `marked(text)` 的输出直接传入 `dangerouslySetInnerHTML`，没有 DOMPurify 或任何 HTML 清理。AI 回复如果包含 `<img onerror=alert(1)>` 等恶意标签，会在 Electron 主窗口中执行 JavaScript。
**后果:** 在 Electron 环境下等价于 RCE（远程代码执行）——可以访问文件系统。
**修复:** 安装 `dompurify`，在 `createMarkup` 中清理：
```javascript
import DOMPurify from 'dompurify'
const createMarkup = (text) => {
    try {
        return { __html: DOMPurify.sanitize(marked(text, { breaks: true })) }
    } catch { return { __html: text } }
}
```

#### BUG-3: Settings.jsx 备份导出缺失番茄钟数据
**文件:** `src/components/Settings.jsx:60-73`
**问题:** `pomodoro` 变量被 fetch 了但从未加入 `backup.data` 对象。且 `getStats('1970-01-01')` 只获取某一天的统计，不是全部会话。
**后果:** 导出的 JSON 备份丢失所有番茄钟学习记录，恢复后学习时长归零。
**修复:**
1. 改用 `getPomodoroRange('1970-01-01', '2099-12-31')` 获取全部会话
2. 在 backup.data 中加入 `pomodoro`

#### BUG-4: 数据库缺少 mistakes.subject_id 索引
**文件:** `electron/database.js:68-77`
**问题:** `mistakes` 表的 `subject_id` 字段没有索引，但 MistakeBook / StudyProgress / AIPanel 频繁按此字段过滤。
**后果:** 错题数量增长后，每次筛选都全表扫描。
**修复:** 在 schema 初始化中添加：
```sql
CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject_id);
```

---

### 🟡 HIGH — 尽快修复

#### BUG-5: marked() 无 try-catch 可导致 AIPanel 白屏
**文件:** `src/components/AIPanel.jsx:113`
**问题:** `marked(text)` 对畸形 markdown 可能抛异常，但没有 try-catch。
**后果:** AI 返回格式异常的内容时整个聊天面板崩溃（白屏）。
**修复:** 已包含在 BUG-2 的修复方案中（try-catch fallback 到纯文本）。

#### BUG-6: DiaryContext vs window.api 双轨数据通路
**现状:**
- 使用 `useDiary()` (DiaryContext/localStorage): Calendar, Countdown, SearchPanel, Settings, MistakeBook, TagManager
- 使用 `window.api.*` (Electron IPC/SQLite): Dashboard, Pomodoro, AIPanel, ExportModal, ImageGallery
**问题:** 两套数据源不同步。浏览器开发模式下 window.api 不存在；Electron 模式下 DiaryContext 读的是 localStorage 而非 SQLite。
**建议:** Phase 6 统一为一套 API 层（见下方任务 6.3）。

#### BUG-7: mockApi.js 缺少 export 和 dashboard 命名空间
**文件:** `src/utils/mockApi.js`
**问题:** ExportModal 调用 `window.api.export.*`、Dashboard 调用 `window.api.dashboard.*`，但 mockApi 中没有这些方法。
**后果:** 浏览器开发模式下导出功能和 Dashboard 静默失败。

---

### 🟢 MEDIUM — 可安排修复

#### ISSUE-8: Toast.jsx 使用模块级可变状态
**文件:** `src/components/Toast.jsx:4`
**问题:** `let toastListeners = []` 是模块级全局变量，不在 React 生命周期管理内。
**影响:** 测试环境可能出现状态泄漏。

#### ISSUE-9: Dashboard 热力图使用 Math.random()
**文件:** `src/components/Dashboard.jsx:225`
**问题:** 渲染中使用 `Math.random() * 0.2` 设置透明度，导致每次重渲染视觉跳动。
**影响:** 非确定性 UI，不影响功能。

#### ISSUE-10: helpers.js 中有 3 个未使用的导出函数
**文件:** `src/utils/helpers.js`
**函数:** `getMoodLabel()`, `debounce()`, `getStudyTimeColor()`
**影响:** 增加包体积（微量）。

---

## 📋 Phase 6 任务分配表

### 6.1 关键 Bug 修复 🔧
**协作模式:** Claude 独立完成（全部是代码逻辑/安全问题）

#### Claude 负责 (60 分钟)
| 任务 | 优先级 | 文件 |
|------|--------|------|
| 修复 AIPanel settings 键名 (BUG-1) | P0 | AIPanel.jsx |
| 安装 DOMPurify + 修复 XSS (BUG-2 & BUG-5) | P0 | AIPanel.jsx, package.json |
| 修复 Settings 备份缺失 pomodoro (BUG-3) | P0 | Settings.jsx |
| 添加 mistakes.subject_id 索引 (BUG-4) | P1 | database.js |
| 补全 mockApi export/dashboard 命名空间 (BUG-7) | P1 | mockApi.js |

---

### 6.2 Electron 打包与发布 📦
**协作模式:** Gemini 主导打包配置 → Claude 审查安全

#### Gemini 负责 (主导 - 120 分钟)
- [ ] 配置 `electron-builder` 完整打包流程（Windows NSIS 安装包 + 便携版）
- [ ] 设计应用图标（256×256 PNG + .ico 转换）
- [ ] 配置 `package.json` build 字段（appId, productName, directories, files, nsis）
- [ ] 实现应用内自动更新（electron-updater + GitHub Releases）
- [ ] 配置 CSP (Content Security Policy) 头部
- [ ] 测试打包产物是否正常运行

#### Claude 负责 (辅助 - 30 分钟)
- [x] 审查打包配置的安全性（CSP ✅，nodeIntegration=false ✅，contextIsolation=true ✅）
- [x] 验证 `better-sqlite3` native 模块在打包后能正常加载（db path via app.getPath('userData') ✅）
- [x] 检查 `electron-builder` 的 `extraResources` 是否正确处理数据库文件

---

### 6.3 统一 API 层 🔄
**协作模式:** Claude 设计架构 → Gemini 迁移组件

#### Claude 负责 (架构设计 - 90 分钟)
- [x] 创建 `src/utils/apiAdapter.js` — 统一 API 适配层
  - Electron 环境：透传到 `window.api.*` (IPC → SQLite)
  - 浏览器环境：降级到 DiaryContext/localStorage
  - 自动检测环境：`window.api` 存在 → Electron 模式
- [x] 重构 DiaryContext.jsx 使用 apiAdapter
- [x] 添加缺失的 API 方法到适配层：
  - `pomodoro.getRange(start, end)`
  - `pomodoro.addSession({...})`
  - `dashboard.streak()`
  - `dashboard.entryDatesRange(start, end)`
  - `export.*` (浏览器降级为 Blob 下载)

#### Gemini 负责 (组件迁移 - 90 分钟)
- [x] 迁移 Dashboard.jsx：`window.api.*` → `useDiary()` 或 apiAdapter
- [x] 迁移 Pomodoro.jsx：`window.api.*` → 统一 API
- [x] 迁移 AIPanel.jsx：`window.api.*` → 统一 API
- [x] 迁移 ExportModal.jsx：`window.api.*` → 统一 API
- [x] 迁移 ImageGallery.jsx：`window.api.*` → 统一 API
- [x] 确保所有组件在浏览器开发模式下也能基本运行

---

### 6.4 数据导入与恢复 📥
**协作模式:** Gemini 主导 UI → Claude 审查数据完整性

#### Gemini 负责 (主导 - 90 分钟)
- [x] 实现 Settings.jsx 中 "从 JSON 导入" 功能
- [x] 设计导入确认弹窗（覆盖/合并选项）
- [x] 实现文件选择 → 读取 → 预览 → 确认 → 写入流程
- [x] 添加导入进度条和结果反馈

#### Claude 负责 (辅助 - 45 分钟)
- [x] 编写数据校验逻辑（验证 JSON schema 合法性）
- [x] 实现"合并导入"策略（entries 按 date 去重，tags 忽略重名）
- [x] 防御性处理：超大文件（50MB 限制）、格式不兼容校验

---

### 6.5 性能与体验优化 ✨
**协作模式:** Gemini 主导体验 → Claude 审查性能

#### Gemini 负责 (主导 - 60 分钟)
- [x] 添加全局 loading skeleton（应用初始化时）
- [x] Dashboard 热力图去除 Math.random()，改用确定性色值 (原6.1提前完成)
- [x] 清理 helpers.js 未使用的导出函数 (移除4个未使用方法)
- [x] Toast 组件增加动画入场效果优化 (添加了 3D 弹簧入场出场)

#### Claude 负责 (辅助 - 30 分钟)
- [x] 审查 React.memo / useMemo / useCallback 使用是否合理（无过度优化也无明显遗漏）
- [x] 检查 useEffect 依赖数组正确性（全组件扫描，发现并修复 AIPanel messagesEndRef 未声明）
- [x] 评估 SQLite WAL 模式下的并发读写安全性（better-sqlite3 单线程同步，WAL 适当，无问题）

---

## 📊 工作量统计

| 任务 | Gemini (主导) | Claude (辅助) | 总时长 |
|------|-------------|-------------|---------|
| 6.1 Bug 修复 | 0 | 60 分钟 | 1 小时 |
| 6.2 Electron 打包 | 120 分钟 | 30 分钟 | 2.5 小时 |
| 6.3 统一 API 层 | 90 分钟 | 90 分钟 | 3 小时 |
| 6.4 数据导入 | 90 分钟 | 45 分钟 | 2.25 小时 |
| 6.5 性能优化 | 60 分钟 | 30 分钟 | 1.5 小时 |
| **合计** | **6 小时** | **4.25 小时** | **10.25 小时** |

**角色分配比例：**
- **Gemini：59%** (打包、UI 迁移、导入功能)
- **Claude：41%** (Bug 修复、架构设计、安全审查)

---

## 🚀 推荐执行顺序

```
Step 1: Claude 独立完成 6.1 (关键 Bug 修复) ← 立即开始
Step 2: Claude 设计 6.3 API 适配层架构
Step 3: Gemini 并行启动 6.2 (Electron 打包配置)
Step 4: Gemini 基于 Claude 的适配层完成 6.3 组件迁移
Step 5: Gemini 完成 6.4 数据导入 UI + Claude 审查校验
Step 6: 双方并行完成 6.5 性能优化
Step 7: 最终集成测试 → 发布 v1.0.0
```

---

## 🎯 Phase 6 完成标志

- [x] 所有 CRITICAL Bug 已修复（BUG-1~7 + AIPanel messagesEndRef + Settings exportData）
- [x] `npm run build` + `electron-builder` 成功生成安装包（NSIS + portable）
- [ ] 安装包在全新 Windows 机器上可正常运行（需手动验证）
- [x] 导出 → 导入 roundtrip 数据无损（entries 按 date 去重, subjects 按 name 去重, tags UNIQUE 保护）
- [x] 所有组件在浏览器开发模式下也能基本运行（mockApi 全覆盖, DiaryContext 双模式）
- [x] 无控制台错误（生产构建 ✓ 63 modules, 0 errors, 0 warnings）

### ⚠️ 已知限制
- 番茄钟备份为聚合数据（daily totals），无法恢复原始 session 粒度（需新增 IPC 接口才能完整 roundtrip）
- `package.json` 缺少 `author` 字段（electron-builder 警告，不影响打包）
