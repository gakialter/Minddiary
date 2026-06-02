<p align="center">
  <img src="./public/images/app-icon.svg" alt="MindDiary" width="96" />
</p>

<h3 align="center">MindDiary</h3>

<p align="center">
  低压力 · 长周期 · 本地优先的考研学习伴侣
</p>

<p align="center">
  <a href="https://github.com/gakialter/Minddiary/actions/workflows/ci.yml"><img src="https://github.com/gakialter/Minddiary/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/gakialter/Minddiary/actions/workflows/release.yml"><img src="https://github.com/gakialter/Minddiary/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/gakialter/Minddiary/releases/latest"><img src="https://img.shields.io/github/v/release/gakialter/Minddiary?color=0F766E&label=release" alt="Version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-C65A3A" alt="License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

---

## 设计理念

**Less but better. Action first, noise last.**

MindDiary 是一个为考研备考者设计的桌面日记与效率工具。它围绕"持续学习"这一核心动作，提供日记、番茄钟、错题管理三层结构化记忆与追踪，辅以 AI 助教的低摩擦智囊支持。

学习数据存储在本地 SQLite 中，零云端依赖；AI 对话与自动更新仅在用户配置或触发时联网，用户拥有完整数据主权。

视觉语言采用 **Zen Forest（禅意森林）** 设计体系 — 低饱和度的大地色调、充足的留白、克制的装饰。工具退居幕后，让使用者的行动成为画面的主角。

## 界面预览

<p align="center">
  <img src="./docs/assets/dashboard.png" width="45%" alt="今日看板" />
  <img src="./docs/assets/editor.png" width="45%" alt="日记编辑器" />
</p>

<p align="center">
  <img src="./docs/assets/pomodoro.png" width="45%" alt="番茄钟" />
  <img src="./docs/assets/ai-assistant.png" width="45%" alt="AI 助手" />
</p>

<p align="center">
  <img src="./docs/assets/mistake-book.png" width="45%" alt="错题本" />
  <img src="./docs/assets/statistics.png" width="45%" alt="学习统计" />
</p>

## 用户指南

普通备考用户可以从 [MindDiary 用户指南](./docs/USER_GUIDE.md) 开始，里面按实际界面入口说明了写日记、贴标签、使用番茄钟和正计时、记录错题、查看 Dashboard、配置 AI 助手、备份与恢复的流程。

## 功能概览

### 日记系统

- 按日期写日记，标题可选，支持心情标记、字数统计、自动保存和 Ctrl/Cmd+S 手动保存。
- Markdown 编辑工具栏支持加粗、高亮、下划线和预设颜色语法；渲染使用白名单颜色语法，不启用原始 HTML/style 注入。
- 内置默认日记模板，并可在「管理模板」中新建、编辑和删除自定义模板。
- 标签分类：在「标签管理」创建带颜色、emoji / 短符号图标、展示样式和预设纹理的标签，编辑日记时选择标签，在「搜索」中按标签筛选和回顾；当前“自定义图案”指轻量图标 + 预设纹理，不包含图片上传、远程图片、自定义 SVG 或本地路径保存。
- 日记图片附件支持上传、拖拽、压缩存储、缩略图查看和点击放大；可将日记生成分享卡片 PNG。
- 配置 AI 后，可对当前日记发起「AI 汇总」。

### 番茄钟

- 支持专注、短休、长休、自定义倒计时和正计时模式。
- 专注和正计时都可关联科目并写入同一套专注统计；正计时至少 1 分钟后才能「结束并保存」。
- 设置页可配置默认番茄时长、结束音效、结束弹窗；自定义模式可在番茄钟页单独设置 1-120 分钟。
- 专注完成或有效正计时保存后，可选择写入今日日记、跳转添加错题，或仅保存专注记录。
- 提供可拖拽的悬浮 Widget、全屏 Zen 专注模式，以及 Windows 上的专注白名单提醒。

### 错题本

- 记录问题、答案/解析、备注和所属科目；备注支持与日记一致的 Markdown 工具栏。
- 支持上传、粘贴或拖拽错题图片，多图可点击放大预览。
- 支持关键词搜索、科目筛选、掌握状态筛选、今日待复习筛选和分页浏览。
- 通过 SM-2 间隔重复记录复习质量，自动安排下次复习日期；也可手动标记「已掌握」或重新加入计划。
- AI 助手可基于错题本进行「错题规律分析」和「考考我」。

### Dashboard 与学习进度

- 「今日决策」根据 72 小时风险池、稳定记忆净增、有效专注转化率给出下一步入口，并可展开查看系统依据。
- 「数据统计」展示连续专注天数、历史总专注时间、错题消灭率、今日待复习错题、关键日期倒计时、近 7 日专注趋势和近 90 天日记轨迹。
- 专注分布支持今日、近 7 天、近 30 天、单日和自定义起止日期范围；倒计时和正计时记录会进入同一统计。
- 日历月视图专注标记：30m+ / 60m+ / 120m+ 三级色彩指示，与日记心情共存，悬浮 tooltip 展示专注时长
- 多关键日期倒计时支持考研、报名、假期、截止日期和自定义节点。
- 「科目进度」支持创建科目、设置章节总量、更新完成章节，并汇总今日投入、未清错题和已掌握错题。
- 今日行动队列：在今日决策页创建、完成、跳过或删除今日任务，并可从待复习错题、缺少日记生成建议任务。

### AI 助教

- 小研 AI 支持自由对话、总结今日日记、错题规律分析、考考我、心理按摩和制定复习冲刺计划。
- 设置页提供 6 个预设供应商入口（DeepSeek、通义千问、智谱 GLM、Kimi、豆包、SiliconFlow）和自定义模型配置。
- AI 请求使用 OpenAI 兼容的 chat completions 格式；本地 LLM 或云端模型都需要提供兼容的 Endpoint、API Key 和模型名。
- 用户输入会经过常见 prompt 注入片段过滤；AI 请求有 30 秒超时处理。

### 数据主权

- SQLite 全量本地化，零云端依赖（AI 与更新检查仅在配置或触发时联网）
- 顶部「导出」支持 PDF、Markdown 和 JSON 文件；其中 JSON 面向日记、科目、错题数据快照，不等同于自动备份 ZIP。
- 设置页「导出为 JSON / 从 JSON 导入」用于手动备份和合并导入，敏感字段会在导出前剔除。
- 静默自动备份生成 MindDiary 专用 ZIP 灾备包，包含数据库快照和托管媒体目录；设置页可从该 ZIP 恢复并覆盖当前数据库、附件和错题图片。
- 导出路径、自动备份 ZIP 选择和恢复路径由主进程授权校验。

## 技术栈

| 层       | 选型                                                         |
| -------- | ------------------------------------------------------------ |
| 外壳     | Electron 34 · contextIsolation · 安全 IPC                    |
| 前端     | React 18 · TypeScript strict · Vite                          |
| 数据库   | better-sqlite3 (WAL 模式，外键约束)                          |
| 样式     | CSS Variables + Tailwind utilities · Zen Forest 设计语言      |
| 图标     | Lucide React · `currentColor` 绑定                           |
| Markdown | react-markdown + remark-gfm · 白名单颜色 / 文本格式扩展     |
| 测试     | Vitest + React Testing Library · Playwright E2E               |
| CI/CD    | GitHub Actions — Type Check → Unit Test → Build → Release    |

## 快速开始

```bash
git clone https://github.com/gakialter/Minddiary.git
cd Minddiary
npm install
npm run dev
```

构建安装包：

```bash
npm run build        # 当前平台
npm run build:win    # Windows
npm run build:mac    # macOS
```

### Windows 签名与自动更新发布说明

- 自动更新使用 `package.json` 中通过 `build.publish` 配置的 GitHub release feed。
- 本地构建时，Windows 代码签名是可选的。未签名的安装包可能会触发 Windows SmartScreen 警告。
- 基于 tag 的公开 Windows 发布必须在发布环境中提供 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。
- `npm run build` 必须在没有签名 secrets 的情况下继续工作；只有在存在证书变量时，才启用发布签名。
- 有关签名验证、更新元数据检查和 SmartScreen 的指导，请参见 [Release Checklist](./docs/release-checklist.md)。

### 自动备份与恢复范围

- 静默自动备份是 zip 格式的灾难恢复包，包含 `manifest.json`、`database.json` 以及托管的媒体目录，如 `attachments/` 和 `mistake_images/`。
- 可在桌面设置界面执行自动备份 ZIP 的恢复操作，该操作会覆盖当前的数据库、附件和错题图片。
- 在恢复之前，如果需要内置恢复事务之外的额外回滚点，请手动备份当前的 app data 目录。
- 恢复操作仅接受由 MindDiary 生成的、具有受支持的 `backupFormatVersion` 且非未来 `schemaVersion` 的自动备份 ZIP 文件。
- 损坏的 ZIP 文件、不支持的压缩方法、不安全的路径、手动修改的包以及 zip-slip 漏洞条目，都会在替换用户数据之前被拒绝。

## 项目结构

```
minddiary/
├── electron/          # 主进程（数据库、文件管理、AI 服务）
├── src/
│   ├── components/    # UI 组件
│   ├── contexts/      # React Context 状态管理
│   ├── data/          # 静态数据（AI 供应商注册表）
│   ├── hooks/         # 自定义 Hooks
│   ├── types/         # TypeScript 类型定义
│   └── utils/         # 工具函数
├── tests/             # 单元测试 + E2E 测试
├── docs/assets/       # 品牌规范与截图资源
└── public/images/     # Logo SVG 源文件
```

## 品牌规范

MindDiary 遵循 Zen Forest 品牌体系，详见 [Brand System](./docs/assets/brand.md)。

核心要点：

- 色彩以低饱和度大地色为基调，深松绿 (`#0F766E`) 为唯一强调色
- 暖灰白画布 (`#F6F7F4`) 代替纯白，降低视觉压力
- Lucide React 为唯一图标库；UI 文案不用 emoji，用户自定义标签图标可使用 emoji / 短符号
- 动画以 `transform` + `opacity` 为主，尊重 `prefers-reduced-motion`

## 更新日志

<details open>
<summary>v1.9.8 — 稳定性小版本 (2026-06-03)</summary>

- **Pomodoro 全屏导航锁**：Zen / fullscreen 模式激活时阻止切换页面，避免暂停后切到其它视图导致全屏状态被锁住。（#75）
- **IPC 运行时校验**：为 AI chat、Pomodoro session 写入、学习任务写入、错题复习和日记 create/update 等主进程 IPC 边界增加轻量 payload validation。（#76）
- **本轮范围**：无数据库 schema migration；不包含 V2-02、V2-04/V2-05、Pomodoro task binding 或其它 v2.0 功能。

</details>

<details>
<summary>v1.9.7 — 今日行动队列 (2026-06-01)</summary>

- **今日行动队列**：今日决策页新增轻量任务区域，用于把今日决策转化为可执行任务。
- **任务创建与状态**：支持手动新增 `review / focus / diary / mistake / custom` 任务，并跟踪 `todo / doing / done / skipped` 状态。
- **任务操作**：支持完成、跳过和删除任务，操作后自动刷新今日任务队列。
- **Dashboard 建议任务**：HomeDashboard 可根据风险池和今日日记状态生成错题复习 / 学习沉淀建议任务。
- **本地数据模型**：新增 `study_tasks` SQLite 表，并纳入自动 ZIP 备份恢复。
- **browser fallback**：localStorage 任务队列使用 `mindiary_study_tasks`，并对坏 TASKS localStorage 做容错恢复。
- **本轮限制**：本版本不包含 Pomodoro 任务选择联动，也不包含 AI 一键转任务。

</details>

<details>
<summary>v1.9.6 — 学习闭环增强 (2026-05-30)</summary>

- **Dashboard 范围统计性能优化**：自定义日期范围、今日、近 7 天、近 30 天和单日专注分布改为使用范围级科目聚合统计，避免长范围逐日触发大量 IPC 与数据库查询。
- **专注完成后的沉淀入口**：倒计时番茄完成和有效正计时保存后，提供“写入今日日记”“添加错题”“仅保存专注”的轻量动作入口。
- **风险池直达今日待复习**：首页高风险 CTA 进入错题本时默认启用今日待复习筛选，并可一键清除恢复全部错题。
- **今日决策解释增强**：系统依据中展示更明确的状态判断原因，便于理解风险池、专注转化率和冷启动建议。

</details>

<details>
<summary>v1.9.4 — 小版本更新 / Feature & UX Update (2026-05-23)</summary>

- **新功能**：新增 Dashboard 专注分布图表；日记与错题 notes 支持 Markdown 工具栏（加粗、高亮、下划线、预设颜色）；引入安全的 `{color:red}` 语法。
- **修复与优化**：修复今日决策 CTA，防止专注模式切换丢失 session，优化暗色模式文字对比度，以及修复 CI 中 SearchPanel 测试偶发超时。

</details>

<details>
<summary>v1.9.3 — 标签样式增强 (2026-05-19)</summary>

- **标签样式增强**：标签支持颜色、emoji / 短符号图标、展示样式和预设纹理。
- **标签管理**：TagManager 可在创建和编辑标签时配置样式字段。
- **统一展示**：Editor 与 SearchPanel 使用新的 TagBadge 呈现样式化标签。
- **兼容与边界**：SQLite / browser fallback 兼容旧标签数据；自定义图案仅限轻量符号与预设 CSS 纹理，不支持图片、远程资源、SVG 或本地路径。
- **跟进修复**：补齐空标签名提示、不存在标签 update 抛错，以及 Editor 标签按钮 focus-visible 可见焦点。

</details>

<details>
<summary>v1.9.2 — 搜索性能、今日决策刷新与 UI 层级整理 (2026-05-19)</summary>

- **图片预览重构**：抽取 ClickableImage 通用组件，统一日记、搜索、错题本、休息复习等图片入口。
- **搜索性能**：SearchPanel 标签与附件 metadata 改为 batch 查询，避免 2N 次逐条请求。
- **今日决策刷新**：错题复习完成后触发共享数据刷新，统一今日待复习错题数来源。
- **番茄钟模式文案**：专注、短休、长休、自定义模式显示对应开始按钮文案。
- **系统主题**：跟随系统模式正确响应 OS 深浅色变化。
- **UI 层级**：Modal / Overlay / Toast / Focus 层级改为语义化 z-index token，降低未来遮挡冲突风险。

</details>

<details>
<summary>v1.9.1 — 图片预览与搜索体验修复 (2026-05-18)</summary>

- **图片点击放大**：日记附件、搜索结果图片、错题本图片、错题编辑区图片、休息复习弹窗图片均支持点击放大预览
- **错题重新编辑体验**：点击错题“重新编辑”后自动滚动到编辑区域，并聚焦问题输入框
- **空白日记搜索清理**：搜索结果过滤真正空白的日记，同时保留只有图片或标签的有效日记
- **搜索结果删除**：搜索结果中的日记支持删除，并增加确认提示，降低误删风险
- **预览稳定性**：修复日记附件透明覆盖层拦截点击的问题，补充遮罩关闭、Esc 关闭、锁定背景滚动等交互细节

</details>

<details>
<summary>v1.9.0 — Focus Guard、Zen 专注与发布可靠性 (2026-05-18)</summary>

- **Focus Guard**：新增 Windows 专注白名单守护、违规提醒、平台不支持提示，并优化活动窗口检测稳定性
- **Zen 专注模式**：新增番茄钟全屏专注体验，并在计时完成时可靠退出 Zen 模式
- **AI 对话连续性**：侧边栏和页面导航切换后保留 AI 助手对话历史
- **图片上传可靠性**：加固错题图片上传、展示与本地资源路径处理
- **本地日期统计**：统一 Pomodoro 今日/统计查询的本地日期键，修复跨时区日期残留
- **发布阻塞修复**：固定 Windows installer artifact 命名，使 `latest.yml` 与 GitHub Release asset 名称一致；Release workflow 的 publish job 可读取 `RELEASE_NOTES.md`

</details>

<details>
<summary>v1.8.10 — 稳定性与可访问性加固 (2026-05-15)</summary>

- **Updater 状态缓存**：主进程持久化最新更新状态 (`lastUpdaterStatus`)，Settings 页挂载时通过 `updater:getStatus` 主动拉取，修复页面导航导致的进度丢失
- **日历容错降级**：数据聚合从 `Promise.all` 升级为 `Promise.allSettled`，日记与番茄钟任一数据源故障时另一维度仍正常渲染
- **本地时区修正**：`goToToday` 从 `toISOString()` 改为本地安全格式化 `toDateStr()`，修复 UTC+8 等时区下日期跳变
- **可访问性增强**：日历格增加 `title` 悬浮提示（如 "2023-10-15，已记录日记，专注 120 分钟"），120m+ 专注色从 `--danger` 更正为 `--accent-dark`
- **隐私文案修正**：Settings 隐私描述从绝对化的"无网络请求"精确改为"AI 与更新检查仅在配置或触发时联网"
- **代码清理**：移除 Calendar 未使用的 `DiaryEntry` 导入和 `loading` 状态
- **测试覆盖**：新增 <30m 边界、Promise.allSettled 容错、goToToday 本地日期、getStatus 缓存、unmount 清理共 6 项测试，全量 187 项通过

</details>

<details>
<summary>v1.8.9 — 日历专注标记与内联更新体验 (2026-05-14)</summary>

- **日历专注标记**：番茄钟专注成果直接展示在日历格子中，三级视觉区分（30m 森林绿 / 60m 琥珀橙 / 120m 强调色），通过 `color-mix` 与品牌 Token 挂钩，自动适配深色/浅色模式
- **日历数据聚合**：月视图改为批量请求日记 + 专注数据，防止 N+1 查询；引入 `isCancelled` 闭包锁防止快速翻月的竞态覆盖
- **内联更新体验**：检查更新从阻塞弹窗改为 Settings 页内联 Push 模型，展示检查中动画、下载进度条、下载速度和一键重启安装
- **IPC 安全加固**：Preload 层暴露最少权限 updater API，`onStatusChange` 返回清理函数，React 侧正确解绑避免内存泄漏
- **TypeScript 修复**：修复 Calendar 组件中未定义的 `DateMoodEntry` 类型和可空对象访问
- **测试覆盖**：新增日历组件 6 项 + 更新检查 7 项单元测试，全量 181 项测试通过

</details>

<details>
<summary>v1.8.8 — 关键日期倒计时与导出安全加固 (2026-05-14)</summary>

- **重要日期倒计时**：顶部倒计时从单一考研日期升级为多事件系统，支持考研初试、报名、假期、复试准备等关键节点
- **设置页管理**：新增关键日期管理，可新增、删除、置顶事件；保留 `examDate` 并自动同步为内置“考研初试”事件
- **统计页辅助提醒**：数据统计页新增“关键日期”卡片，最多展示 3 个最近未结束事件，保持低压力辅助信息定位
- **本地日期计算修复**：新增本地时区解析工具，避免 `YYYY-MM-DD` 被 UTC 隐式解析导致的倒计时 off-by-one
- **导出路径安全加固**：导出写入与 PDF 生成改为主进程一次性授权路径校验，拒绝未授权、相对路径、控制字符和目录目标
- **验证覆盖**：新增倒计时工具/组件/设置管理测试，以及导出路径授权测试

</details>

<details>
<summary>v1.8.7 — 日记标签系统 (2026-05-12)</summary>

- **端到端标签流程**：编辑器内联标签选择区，支持加载、选择、取消、清空，随自动保存 / Ctrl+S 一起保存 ([#4](https://github.com/gakialter/Minddiary/issues/4))
- **TagsContextAPI 补齐**：新增 `setEntryTags` / `getEntryTags`，浏览器 fallback 持久化 `entry.tags`
- **保存链路重构**：`App.saveEntry` 拆分 tags 独立保存，正确处理新建日记 id=0 场景
- **竞态防护**：`loadEntry` 新增 requestId 守卫，快速切换日期不再覆盖旧数据
- **测试覆盖**：新增 App / Editor 标签集成测试，DataContext 标签持久化全链路测试，共 18 项通过

</details>

<details>
<summary>v1.8.6 — 数据层重构与稳定性巩固 (2026-05-05)</summary>

- **状态管理重构**：完全拆分 `DataContext` 单体架构，将核心逻辑解耦为 12 个独立的 API 工厂函数（`entries`, `tags`, `pomodoro` 等）
- **性能与并发修复**：重写状态懒加载逻辑，利用 `useState` 惰性初始化与 `useMemo` 缓存彻底解决子组件（AppContent）初次渲染拿不到数据的竞态问题及依赖循环
- **类型安全**：消除 Vitest 及 React 生态带来的强类型拦截警告，测试覆盖率重回 100%

</details>

<details>
<summary>v1.8.5 — 审计整改与品牌抛光 (2026-05-04)</summary>

**无障碍**：全局 icon-only 按钮补齐 `aria-label`，SVG 装饰图标标注 `aria-hidden`

**性能**：全项目 `<img>` 标签统一添加 `loading="lazy" decoding="async"`

**主题合规**：`MoodIcon` 硬编码色值迁移为 `color-mix`，适配品牌色

**品牌净化**：侧边栏极简回归，导航激活态圆角/对比度调整，移除冗余代码

</details>

<details>
<summary>v1.8.4 — AI 助手设置改版 (2026-05-03)</summary>

- 新增国产大模型供应商注册表与自定义模型入口（DeepSeek、通义千问、智谱 GLM 等预设供应商）
- 供应商选择器重设计：纯文字芯片快速切换，模型卡片式下拉列表
- 默认模型更新为 `deepseek-v4-flash`
- 全面移除 UI 中的 Emoji，统一使用语义化 CSS Token

</details>

<details>
<summary>v1.8.3 — 架构重构与性能优化 (2026-05-02)</summary>

- 错题本服务端分页（SQLite `LIMIT/OFFSET`），解决大量错题的内存瓶颈
- 移除 `DataContext` 急切状态初始化，改为按需 IPC 代理
- `ORDER BY RANDOM()` 慢查询重构，消除全表扫描
- `SettingsContext` 参数白名单与 `sanitizePatch` 安全过滤
- 全局清理 15 处 `any` 类型，58 处 `console.*` 迁移至中心化 logger

</details>

<details>
<summary>v1.8.2 — Bug 修复与安全加固 (2026-04-27)</summary>

- 生产模式黑屏修复：`__dirname` 路径解析纠正
- 错题图片删除路径拼接修复
- 窗口事件 null 崩溃守卫
- 私人工作流文档迁移至独立私有目录

</details>

<details>
<summary>更早版本</summary>

**v1.8.1** — IPC 安全加固，PomodoroContext 三拆分，MarkdownRenderer 统一，52 项测试通过

**v1.7.6** — Zen Forest 终版：Welcome 页重设，Logo + Lucide 图标体系确立

**v1.7.0** — Zen Forest 品牌重塑：色调从工具蓝转向低心智压力色系

**v1.6.x** — 自定义日记模板，番茄钟音效，跨平台 frameless titlebar

**v1.5.0** — 智能决策引擎：72h 风险池 / 知识净增量 / 专注转化率

**v1.4.0** — Electron 34 升级，主进程 TypeScript 化

**v1.3.0** — Bento 着陆页，SM-2 间隔重复，考研倒计时

**v1.2.0** — 50 源文件 JS → TS strict 全量迁移

**v1.1.0** — 敏感字段过滤，GitHub Actions CI 建立

**v1.0.x** — 核心功能上线：日记、番茄钟、错题本、AI 助手、暗色模式

</details>

## 贡献

Pull Request 与 [Issue](https://github.com/gakialter/Minddiary/issues) 欢迎提交。

## 许可证

[MIT](./LICENSE)
