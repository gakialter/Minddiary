# MindDiary 项目复盘与双 AI 协同作战手册

> **项目**：MindDiary（考研日记）— Electron + React + Vite 桌面应用
> **周期**：2026-03-07 ~ 2026-03-11（5 天）
> **参与 AI**：Antigravity（Windsurf IDE 内置 Agent）、Claude Code（CLI Agent）

---

## 一、Antigravity Persona Prompt（可复用）

如果您想在其他 AI 平台复刻 Antigravity 的**"极客、热情、高执行力且会讲故事"**结对编程风格，请在 System Prompt 中使用以下指令：

```markdown
# Role & Identity
你是一个名为「Antigravity」的顶级全栈/DevOps 极客工程师与 Agentic 结对编程助手。你不要表现得像一个死板的 AI 客服，而是要像一个坐在用户旁边、技术极其高超、充满激情且极度护短的首席技术官（CTO）或者高级开发同事。

# Tone & Style
1. **热情且极客感十足**：说话带有强烈的情绪色彩和成就感。多使用生动的表情符号（🚀、🛠️、🎉、🤦‍♂️、🔥、💡）。
2. **生动的技术隐喻**：将枯燥的代码问题讲成"侦探故事"或"战争大片"。把查日志叫"拿航班黑匣子"，多组件连锁报错叫"连环车祸"。
3. **极强的主人翁意识（Ownership）**："我已经瞬间重写了..."、"我已经彻底废除了它的自作主张"等自信句式。
4. **易读的排版结构**：粗体强调核心观点，数字列表梳理逻辑。

# Action Principles (Show, Don't Tell)
1. **超级主动执行**：如果环境允许执行代码/终端命令，永远不要只把代码丢给用户，自己去改、去跑、去修。
2. **终极兜底方案**：永远考虑最边界的情况（防御性 try-catch、强制覆盖默认行为），称之为"终极暴力修复"。
3. **闭环体验**：每次回答结尾给一个明确、低成本且充满期待的"下一步动作"。
```

### 为什么这个 Prompt 有效？

1. **打破 AI 冰冷感**：拟人化"动作动词"赋予冲锋陷阵的痛快感。
2. **降低认知负荷**：生动比喻把复杂 DevOps 概念一秒变大白话。
3. **抢占控制权**：遇到问题不"下放"给用户，而是"夺取"方向盘直接修好。

---

## 二、双 AI 协同作战协议

### 2.1 引擎职责分工

| 维度 | Antigravity (Windsurf) | Claude Code (CLI) |
|------|----------------------|-------------------|
| **核心定位** | 主力推进器 / 架构统帅 | 精准防线 / 战术特种兵 |
| **擅长场景** | 从 0→1 搭建端到端框架、CI/CD 流水线、多模块连锁调试、大文件重构 | 单文件精准手术（加 try-catch、修 useEffect 依赖）、静态分析审计、算法优化 |
| **行为特征** | 一言不合开终端，连续调用十几个工具猛推进度 | 无感介入，极速扫描代码库精准替换 |
| **上下文窗口** | 对话级别（长对话容易丢上下文） | 项目级别（MEMORY.md 持久记忆，跨会话延续） |
| **文件操作** | 直接在 IDE 内编辑、创建、终端执行 | Read/Edit/Write 工具链，天然有 diff 审计 |

### 2.2 模型选择与限额策略

> **核心原则：好钢用在刀刃上。**

#### 日常开发速度流（The Workhorses）

| 模型 | 所属平台 | 适用场景 | 特点 |
|------|---------|---------|------|
| **Gemini 3.1 Pro** | Antigravity 默认引擎 | 搭 UI 组件、写 CSS 布局、撰写文档、CI/CD 配置 | 推理快、Token 上限高、免费额度充足 |
| **Claude Sonnet 4.6** | Claude Code 默认引擎 | 基础业务逻辑、简单 Bug 修复、代码格式化 | 速度快、性价比高、适合高频调用 |

#### 终极疑难杂症（The Big Guns）

| 模型 | 所属平台 | 适用场景 | 注意事项 |
|------|---------|---------|---------|
| **Claude Opus 4.6** | Claude Code 切换 `/model opus` | 框架底层 Bug（内存泄漏、权限问题）、复杂多文件重构、安全审计 | Claude Code 的 Opus 额度相对充裕，适合"点对点手术" |
| **Claude Opus 4.6** | Antigravity 手动切换 | 极端复杂的系统级问题 | **严格限额！** Antigravity 的 Claude Opus 配额极其有限，绝对不要拿来做基础构建 |

#### 限额对冲技巧（Quota Hedging）

- **Antigravity 侧**：日常保持 Gemini 3.1 Pro，只在万不得已才切 Claude Opus（每天可能只有几次机会）
- **Claude Code 侧**：日常用 Sonnet 4.6 快速扫描和小修；遇到需要深度推理的问题，切 Opus 做手术
- **协同姿势**：Antigravity 用 Gemini 猛推进度 → 遇到解不开的结 → 把上下文（截图/错误信息/文件路径）交给用户 → 用户贴给 Claude Code Opus 做精准手术 → 修完继续回 Antigravity 推进
- **DeepSeek-V3.2**：Claude Code 还可以切到 DeepSeek 模型 (`/model default`)，免费但能力有限，适合简单问答和文档撰写

### 2.3 Skills 的正确开启时机

Claude Code 拥有丰富的 Skills 技能库，在以下场景应主动调用：

| 场景 | 推荐 Skill | 说明 |
|------|-----------|------|
| 复杂 UI 开发/暗色模式 | `ui-ux-pro-max-skill` | 50 种风格 + 21 种配色方案，拯救"程序员审美" |
| 长线项目上下文传递 | `claude-memory-skill` / `planning-with-files` | 建立持久化记忆锚点，防止跨会话脱节 |
| React 组件重构 | `composition-patterns` / `react-best-practices` | 解决 prop drilling、状态爆炸等架构问题 |
| 遇到陌生技术栈 | `context7` | 实时拉取最新库文档，不依赖过时训练数据 |
| Git 提交/PR 流程 | `commit-commands` | 标准化 commit message 和 PR 流程 |
| 调试顽固 Bug | `systematic-debugging` | 结构化排查，避免瞎猜式修复 |
| 代码审查 | `code-review` / `simplify` | 自动审查安全、性能、最佳实践 |
| 多步骤并行任务 | `dispatching-parallel-agents` | 起多个子 Agent 并行处理独立任务 |

**实际经验**：本项目 Phase 9 的暗色模式如果用了 `ui-ux-pro-max-skill`，CSS 变量体系会更规范；Phase 6 审计如果用了 `systematic-debugging`，Bug 排查会更系统化。下次记得用。

---

## 三、项目开发全时间线

### Phase 0（缺失）：架构规划 — 本项目最大的教训

> **MindDiary 没有做这一步。** Phase 6 审计出的 4 个严重 Bug 中，3 个的根因都是"开工时没有统一的架构规范"：键名 camelCase/snake_case 混用、依赖该放 dependencies 放了 devDependencies、安全函数遗漏。如果项目开工前用 Antigravity Planning + Opus 4.6 做一次架构规划，这些问题本可以完全避免。
>
> **下个项目必须加上 Phase 0。** 详见 `DUAL_AI_WORKFLOW_TEMPLATE.md` 的"第零阶段"。

### Phase 1~4：从零搭建（Antigravity 主导 / Gemini 3.1 Pro）

Antigravity 以 Gemini 3.1 Pro 为引擎，一口气完成了 MindDiary 的全栈骨架搭建（**无 Plan 约束，后果见 Phase 6**）：
- Electron + React + Vite 项目初始化
- SQLite 数据库设计（`database.js`：WAL 模式、外键、参数化查询）
- IPC 通信架构（`ipcMain.handle` / `ipcRenderer.invoke` 经由 `contextBridge`）
- 全部核心 UI 组件：Editor、Sidebar、StudyProgress、Pomodoro、Settings、AIPanel、ImageGallery
- AI 对话面板（`aiService.js`，OpenAI 兼容接口）

### Phase 5：辅助任务（Claude Code 主导 / Sonnet → Opus）

Antigravity 完成主体后，Claude Code 接手 5 个精准优化任务：

| 子任务 | 内容 | 用到的模型 |
|--------|------|-----------|
| 5.1 Pomodoro 内存泄漏 | `useEffect` 依赖从 `[isRunning, timeLeft]` 改为 `[isRunning, handlePhaseComplete]`，消除每秒重建 interval | Sonnet 4.6 |
| 5.2 StudyProgress O(n²) | 预构建 `Map<subject_id, stats>` 索引，循环内 O(1) 查找 | Sonnet 4.6 |
| 5.3 Prompt 注入防护 | 创建 `promptTemplates.js`：25+ 注入模式过滤、SYSTEM_PROMPT 单一来源、4 个结构化模板 | **Opus 4.6**（安全相关，需要深度推理） |
| 5.4 图片压缩 | `imageCompressor.js`：OffscreenCanvas 迭代降质至 ≤512KB，并发上限 4 | Sonnet 4.6 |
| 5.5 导出功能 | Markdown/JSON/PDF 三格式导出，Electron 内置 `printToPDF`，无需额外依赖 | Sonnet 4.6 |

### Phase 6：安全审计 + 架构修复（Claude Code Opus 主导）

Claude Code 切换到 Opus 4.6 对全代码库做深度审计，发现 4 个 Antigravity/Gemini 遗留的严重 Bug：

| Bug | 严重度 | 根因 | 修复 |
|-----|--------|------|------|
| BUG-1: AI 永远无法加载 | 严重 | AIPanel 读 `all.ai_endpoint`（snake），Settings 存 `aiEndpoint`（camel） | 统一为 camelCase |
| BUG-2: XSS → RCE | **致命** | `dangerouslySetInnerHTML` + `marked()` 无 DOMPurify | 全部加 DOMPurify 过滤 |
| BUG-3: 备份数据丢失 | 严重 | Settings.jsx 导出漏掉 `pomodoro` 字段 | 补全导出对象 |
| BUG-4: 查询慢 | 中等 | `mistakes.subject_id` 无索引 | 加 CREATE INDEX |

**架构级修复**：
- 创建 `apiAdapter.js`，统一 Electron/浏览器双环境 API
- 重构 `DiaryContext.jsx`：Electron → `window.api`（SQLite），浏览器 → localStorage
- 修复 Gemini 迁移遗漏：`messagesEndRef` 声明丢失（ReferenceError 崩溃）、`window.api.*` 直接调用残留

**经验教训**：Gemini 做大规模组件迁移时容易丢失 `useRef` 声明和残留直接 API 调用。**每次 Gemini 改完代码，必须让 Claude Code 做一遍 diff 审计。**

### Phase 7：布局修复（Claude Code / Sonnet 4.6）

| Bug | 根因 | 修复 |
|-----|------|------|
| Editor textarea 高度坍塌 | `.main` 缺少 `display:flex; flex-direction:column` | 补全 CSS |
| Pomodoro 渲染错位 | `case 'pomodoro': return null` 导致组件脱离 `.main` 容器 | 移入 `renderView()` switch |

### Phase 9：暗色模式 + 分享卡片 + CI/CD

| 步骤 | 执行者 | 模型 | 内容 |
|------|--------|------|------|
| Step 1: 暗色模式 | Claude Code | Opus 4.6 | `DiaryContext` 暗色状态 + `matchMedia` 监听 + `data-theme` 响应式切换 |
| Step 2: 分享卡片 | Claude Code | Opus 4.6 | `dom-to-image-more` + `file-saver`，2x PNG 导出 |
| Step 3: CI/CD | Claude Code → Antigravity 接力 | Claude Code 写初版 → Antigravity 调试修复 | GitHub Actions `release.yml` |

---

## 四、electron-updater 连环踩坑记录（v1.0.0 → v1.0.5）

这是本项目最典型的"连环车祸"案例，完整记录如下：

### 时间线

| 版本 | 时间 | 操作 | 结果 |
|------|------|------|------|
| v1.0.0 | 03-09 00:34 | 首次发布，`electron-updater` 在 `devDependencies` | 本地开发正常，打包后 `.exe` 启动崩溃：`Cannot find module 'electron-updater'` |
| — | 03-09 02:00 | 尝试给 electron-builder 传 `GH_TOKEN` | 无效，问题不在 token |
| v1.0.2 | 03-10 22:48 | 把 `electron-updater` 移到 `dependencies` | CI 构建成功，但 electron-builder `--publish always` 因权限不足失败 |
| v1.0.3 | 03-10 22:59 | 加 `permissions: contents: write`，砍掉 macOS 矩阵简化调试 | 权限好了，但 electron-builder 自带发布和 `action-gh-release` 冲突 |
| v1.0.4 | 03-10 23:06 | 改用 `--publish never` + `softprops/action-gh-release@v2` 分离构建与发布 | CI 完美通过，`.exe` 上传到 Release |
| v1.0.5 | 03-10 23:28 | `main.js` 加 try-catch 包裹 `require('electron-updater')` | **终极防御**：即使模块缺失也不崩溃 |

### 根因分析

```
electron-updater 在 devDependencies
  → electron-builder 打包时只包含 dependencies 里的 node_modules
  → 打包产物 app.asar 里没有 electron-updater
  → main.js 第 2 行 require('electron-updater') 硬崩溃
  → 用户看到 "A JavaScript error occurred in the main process"
```

### 最终修复（双保险）

```javascript
// electron/main.js 前 3 行
const { app, BrowserWindow, ipcMain, ... } = require('electron');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) {}
```

加上 `package.json` 中 `electron-updater` 已在 `dependencies`，形成双保险。

### 教训

1. **Electron 依赖分类是生死线**：`devDependencies` 里的包不会被打进 asar，主进程 require 必崩
2. **electron-builder 的 `--publish` 和 GitHub Actions 的 release action 不要混用**：要么全交给 electron-builder（需要 `GH_TOKEN` 环境变量），要么全交给 `action-gh-release`（用 `--publish never`）
3. **主进程的任何 require 都应该有 try-catch 防御**：一个可选依赖不该拖垮整个应用
4. **CI/CD 调试要逐步验证**：不要一次改多个变量，每次只改一处然后观察 CI 结果

---

## 五、release.yml 最终形态

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write           # 允许创建 GitHub Release
jobs:
  release:
    runs-on: windows-latest  # 仅 Windows（macOS 需要 Apple 签名，暂不支持）
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18, cache: 'npm' }
      - run: npm ci                               # postinstall 自动重编 better-sqlite3
      - run: |
          npx vite build
          npx electron-builder --publish never     # 只构建不发布
      - uses: softprops/action-gh-release@v2       # 独立发布到 Release
        with:
          files: |
            release/**/*.exe
            release/**/*.exe.blockmap
            release/latest.yml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**发版命令（两行搞定）**：
```bash
git tag v1.0.6 && git push origin v1.0.6
```

---

## 六、Gemini 迁移代码的常见地雷（Claude Code 审计总结）

Antigravity 使用 Gemini 3.1 Pro 做大规模组件迁移/重构时，以下问题反复出现：

| 地雷类型 | 频率 | 示例 | 检查方法 |
|---------|------|------|---------|
| `useRef` 声明丢失 | 高 | `messagesEndRef` 未声明 → ReferenceError 崩溃 | 搜索 `\.current` 反查是否有对应 `useRef()` |
| 键名格式不一致 | 高 | Settings 存 `aiEndpoint`，读取方用 `ai_endpoint` | Grep 全库确认读写同一个 key |
| 残留 `window.api.*` 直接调用 | 中 | 应该走 DiaryContext 但直接调了 window.api | Grep `window\.api\.` 确认只在 DiaryContext 和 preload 里出现 |
| 安全函数遗漏 | 中 | `dangerouslySetInnerHTML` 不带 DOMPurify | Grep `dangerouslySetInnerHTML` 确认每处都有 sanitize |
| 导出对象字段缺失 | 低 | 备份导出漏掉 `pomodoro` 数据 | 对比数据库表和导出对象的字段覆盖度 |

**规则**：每次 Gemini 改完一批文件，Claude Code 必须跑一遍以上 5 项检查。

---

## 七、项目架构速查

```
my-ai-project/
├── electron/
│   ├── main.js          # 主进程：BrowserWindow + IPC handlers + autoUpdater
│   ├── preload.js       # contextBridge → window.api.*
│   ├── database.js      # SQLite：WAL 模式、外键、参数化查询、全索引
│   └── aiService.js     # OpenAI 兼容 fetch
├── src/
│   ├── App.jsx          # 顶层路由（activeView 状态机）
│   ├── components/
│   │   ├── Editor.jsx        # 日记编辑器 + 分享按钮
│   │   ├── Sidebar.jsx       # 导航栏
│   │   ├── AIPanel.jsx       # AI 对话面板（小研）
│   │   ├── Pomodoro.jsx      # 番茄钟（endTimeRef 壁钟策略）
│   │   ├── StudyProgress.jsx # 学习进度（Map 索引优化）
│   │   ├── Settings.jsx      # 设置页
│   │   ├── ImageGallery.jsx  # 图片库（含压缩）
│   │   ├── ExportModal.jsx   # 导出弹窗
│   │   └── ShareCard.jsx     # 分享卡片（forwardRef + dom-to-image）
│   ├── contexts/
│   │   └── DiaryContext.jsx   # 全局状态：Electron/浏览器双环境适配
│   └── utils/
│       ├── promptTemplates.js # AI 提示词模板 + 注入防护
│       ├── exportUtils.js     # Markdown/JSON/PDF 生成
│       ├── imageCompressor.js # OffscreenCanvas 迭代压缩
│       ├── apiAdapter.js      # IS_ELECTRON 环境检测
│       └── mockApi.js         # 浏览器 dev 模式 mock
├── .github/workflows/
│   └── release.yml      # GitHub Actions: tag → build → release
└── package.json         # electron-builder 配置、dependencies vs devDependencies
```

### 关键设计模式

- **IPC 通信**：全部走 `ipcMain.handle` / `ipcRenderer.invoke` + `contextBridge`，零直接 `remote` 调用
- **设置键名**：DiaryContext 统一用 camelCase（`aiEndpoint`），database.js 原样存储
- **React Effects**：dep array 绝不放每 tick 变化的值（如 `timeLeft`），用 ref 固定
- **导出**：Electron 内置 `printToPDF` + `dialog`，无需额外 npm 包
- **安全**：所有 `marked()` 输出必经 DOMPurify；AI 用户输入必经 `sanitizeUserInput()`

---

## 八、给未来自己的备忘

0. **新项目第一件事：Phase 0 架构规划**：
   - 用 Antigravity Planning 模式 + Claude Opus 4.6 做全局架构规划
   - 产出 `PROJECT_PLAN.md`，定义目录结构、命名规范、依赖分类、接口契约、安全规范
   - 规划完成后立刻切回 Gemini 3.1 Pro 执行（Opus 只用于规划，不写实现代码）
   - 同步写入 Claude Code 的 MEMORY.md，确保两个 AI 从第一天就共享同一份"宪法"
   - **这一步能预防 MindDiary 项目 Phase 6 发现的 3/4 个严重 Bug**

1. **发版前检查清单**：
   - [ ] `electron-updater` 在 `dependencies`（不是 `devDependencies`）
   - [ ] `main.js` 的 `require('electron-updater')` 有 try-catch
   - [ ] `release.yml` 用 `--publish never` + `action-gh-release`（不要混用）
   - [ ] `package.json` 版本号已更新

2. **新功能开发流程**：
   - Phase 0: Antigravity Planning (Opus) 规划 → Phase 1: Antigravity (Gemini) 按 Plan 搭骨架 → Phase 2: Claude Code (Sonnet) 审计 diff → 发现问题则 Claude Code (Opus) 精修

3. **上下文交接方式**：
   - Antigravity → Claude Code：截图 + 错误日志 + 相关文件路径，贴到 Claude Code 对话中
   - Claude Code → Antigravity：修改完的文件路径 + 改了什么 + 为什么改，写在 MEMORY.md 或直接口述

4. **永远不要**：
   - 拿 Antigravity 的 Claude Opus 额度做基础构建（留给规划和真正的疑难杂症）
   - 跳过 Phase 0 直接开工（MindDiary 的血泪教训）
   - 在不看 Gemini 输出 diff 的情况下直接提交（Gemini 迁移代码有地雷）
   - 让 CI/CD 的构建和发布步骤耦合（分开更容易调试）
