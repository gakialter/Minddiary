<p align="center">
  <img src="./public/images/app-icon.svg" alt="MindDiary" width="96" />
</p>

<h3 align="center">MindDiary</h3>

<p align="center" style="color: #0F172A">
  低压力 · 长周期 · 本地优先的考研学习伴侣
</p>

<p align="center">
  <a href="https://github.com/gakialter/Minddiary/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-passing-2F8F6B?style=flat&logo=githubactions&logoColor=white" alt="CI" /></a>
  <a href="https://github.com/gakialter/Minddiary/actions/workflows/release.yml"><img src="https://img.shields.io/badge/build-ready-0F766E?style=flat&logo=githubactions&logoColor=white" alt="Release" /></a>
  <a href="https://github.com/gakialter/Minddiary/releases/latest"><img src="https://img.shields.io/github/v/release/gakialter/Minddiary?color=0F766E&label=release" alt="Version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-C65A3A" alt="License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

---

## 设计原则

**Less but better. Action first, noise last.**

MindDiary 围绕"持续学习"这一核心动作，提供日记、番茄钟、错题管理三层结构化的记忆与追踪，辅以 AI 助教的低摩擦智囊支持。全部数据存储在本地 SQLite 中，无云端依赖。

## 功能

| 日记                                 | 番茄钟                         | 错题本                           |
| :----------------------------------- | :----------------------------- | :------------------------------- |
| Markdown 编辑，Ctrl+S 即时保存       | 按科目追踪累计专注时间         | 按科目分类，全文检索             |
| 自定义日记模板，AI 智能汇总          | 自定义时长，Web Audio 完工音效 | SM-2 间隔重复排期复习            |
| 分享卡片导出 (PNG)                   | 悬浮 Widget，拖拽自由定位      | AI 错题抽查与规律分析            |
| **学习仪表盘**                 | **AI 助教**              | **数据主权**               |
| 90 天热力图，多科耗时雷达图          | 兼容 OpenAI 标准接口，7 大国产供应商一键切换 | SQLite 全量本地化                |
| 考研倒计时，连续打卡统计             | Prompt 注入防护，请求超时熔断  | JSON 全量备份，敏感字段自动剔除  |
| 72h 风险池 / 知识净增量 / 专注转化率 | 支持本地 LLM 及云端模型        | PDF / Markdown / JSON 三格式导出 |

## 界面

<p align="center">
  <img src="./docs/assets/dashboard.png" width="45%" alt="今日看板"/>

  <img src="./docs/assets/editor.png" width="45%" alt="日记编辑器"/>
</p>

<p align="center">
  <img src="./docs/assets/pomodoro.png" width="45%" alt="番茄钟"/>

  <img src="./docs/assets/ai-assistant.png" width="45%" alt="AI 助手"/>
</p>

## 技术栈

| 层       | 选型                                                          |
| -------- | ------------------------------------------------------------- |
| 外壳     | Electron 34 · contextIsolation · 安全 IPC                   |
| 前端     | React 18 · TypeScript strict · Vite                         |
| 数据库   | better-sqlite3 (WAL 模式，外键约束)                           |
| 样式     | CSS Variables + Tailwind utilities · Zen Forest 设计语言     |
| 图标     | Lucide React ·`currentColor` 绑定                          |
| Markdown | react-markdown + remark-gfm · DOMPurify 消毒                 |
| 测试     | Vitest + React Testing Library · Playwright E2E              |
| CI/CD    | GitHub Actions — Type Check → Unit Test → Build → Release |

## 快速开始

```bash
git clone https://github.com/gakialter/Mind### v1.8.5 — 审计整改与品牌抛光 (2026-05-04)

**无障碍 (Accessibility)**：
- 全局 icon-only 按钮补齐 `aria-label` 与 `title`（错题编辑/删除/掌握切换、设置模型搜索清除）
- SVG 装饰图标标注 `aria-hidden`，屏幕阅读器不再误读

**性能优化 (Performance)**：
- 全项目 `<img>` 标签统一添加 `loading="lazy" decoding="async"`（MistakeItem/MistakeBook/ImageGallery/BreakReviewModal）
- 长列表图片不再一次性请求，消除卡顿

**主题系统合规 (Theming)**：
- `MoodIcon` 心情标签：6 种硬编码 hex/rgba 全部迁移为 `color-mix`，完美适配品牌色
- 暗色/亮色模式切换时心情图标自动无缝转换

**品牌净化 (Brand)**：
- 侧边栏移除冗余 Logo 图标和文字，极简回归
- 导航激活态：圆角缩减至 `--radius-sm`，背景色降低对比度
- Layout 关闭按钮 hover 改用 `color-mix` 配合 `--danger` token
- 移除未使用的依赖与残余代码

<details>
<summary>更早版本</summary>

### v1.8.4 — AI 助手设置改版 (2026-05-03)

**AI 供应商注册表**：
- 新增 `src/data/aiProviders.ts`：2026 年国产大模型供应商注册表，覆盖 DeepSeek V4、Qwen3、GLM-5.1、Kimi K2.6、豆包、SiliconFlow 共 7 大供应商 20+ 个模型
- 各供应商配有默认 API 端点和官网链接，支持一键跳转获取 API Key

**设置界面重设计**：
- 供应商选择器：纯文字芯片（Provider Chip）快速切换，选中后自动填充端点和推荐模型
- 模型选择器：卡片式下拉列表，带搜索功能和模型描述
- 保留"自定义"入口：手动输入任意 OpenAI 兼容的模型名称
- 默认模型从 `gpt-3.5-turbo` 更新为 `deepseek-v4-flash`

**品牌规范对齐（Zen Forest）**：
- 全面移除 UI 中的 Emoji，使用 Lucide 图标或纯文字
- 统一使用语义化 CSS Token（`var(--accent)`、`var(--radius)`、`var(--shadow-lg)`）
- 移除高饱和度供应商品牌色，选中态统一使用品牌松绿
- 清理未使用的 Lucide 导入和死代码

### v1.8.3 — 架构重构与性能起飞 (2026-05-02)

**核心重构**：
- **服务端分页**：错题本（`MistakeBook`）从全量加载切片重构为原生 SQLite `LIMIT/OFFSET` 分页，彻底解决大量错题导致的内存和渲染瓶颈。
- **状态流解耦**：移除 `DataContext` 启动时的急切状态初始化（`useState` 数组），全面改为按需代理的 IPC（Inter-Process Communication）接口，降低前端内存堆积。
- **性能优化**：将 `database.ts` 中的 `ORDER BY RANDOM()` 慢查询重构为 `LIMIT 1 OFFSET (RANDOM() % COUNT)`，消除全表扫描带来的高延迟。

**安全与工程规范**：
- **安全加固**：为 `SettingsContext` 实现严格的参数白名单及 `sanitizePatch` 过滤，收束 IPC 通信层风险。
- **代码净化**：全局清理 15 处 `any` 类型定义，并完成 58 处无序 `console.*` 到中心化 `logger.ts` 的接口迁移。
- **异常恢复**：为全局 `ErrorBoundary` 增加 `onReset` 路由重置机制，修复界面组件崩溃后的"重试"死循环。

### v1.8.2 — Bug 修复与安全加固 (2026-04-27)

**Bug 修复**：

- **生产模式黑屏修复（#3）**：`electron/main.ts` 路径解析错误，`__dirname` 编译后指向 `electron-dist/electron/`，`index.html` 与 `icon.png` 路径需上跳两层而非一层
- **错题图片删除失效**：`fileManager.deleteMistakeImage` 路径拼接双重，修改为通过 `fileURLToPath` 还原真实 fs 路径
- **窗口事件 null 崩溃**：`maximize/unmaximize` 回调补充 `mainWindow.isDestroyed()` 守卫，与其他 IPC handler 一致

**品牌合规**：

- `aiService` 错误文案移除 emoji（⏱️/🔌）

**工程整理**：

- 私人工作流文档（`TRI_AI_WORKFLOW_V2.md`、`CODE_REVIEW_HANDOFF.md`、`ARCH_DECISIONS.md`）迁移至独立私有目录，不再出现于公开仓库
- `.gitignore` 补全私人文档匹配规则

### v1.8.1 — UI 巩固与类型完善 (2026-04-26)

安全与性能：

- IPC 安全：AI API Key 永久驻留主进程，渲染进程零接触密钥
- CSP 加固：生产环境收束 `connect-src` 至 `'self'`，`local://` 协议限定 userData 目录
- 类型安全：`electron/main.ts` 全部 IPC handler 强类型化，消除 10+ 处 `any`
- `fileManager.ts` 完整类型签名，附件生命周期类型可追溯

性能与架构：

- PomodoroContext 拆分为 Timer / Data / Actions 三个独立 Context，消除每秒级连锁重渲染
- MarkdownRenderer 统一组件（react-markdown + remark-gfm），替换 3 处 `dangerouslySetInnerHTML`
- Zen Forest 排版样式集中管理，暗色模式自动适配

工程：

- `npm run typecheck` 主进程 + 渲染进程双通道零错误
- 52 项单元测试全量通过
- 私有文档归档至独立仓库

### v1.7.6 — Zen Forest 终版 (2026-04-20)

- 品牌视觉统一：Welcome 页与 CommanderHero 仪表盘重设，确立 Logo + Lucide 为基准的图标体系
- 番茄钟自定义时长接入核心循环流
- 样式架构分离：Tailwind 负责布局，CSS 变量负责语义

### v1.7.1 — 交互抛光 (2026-04-20)

- AI 快捷指令胶囊化（Pill 样式）
- 全架构验收：TypeScript + 52 项测试通过

### v1.7.0 — Zen Forest 品牌重塑 (2026-04-19)

- 色调从工具蓝转向 Zen Forest 低心智压力色系
- `<Logo />` 组件化，`docs/brand.md` 建立品牌 SSOT

### v1.6.x

- 自定义日记模板，番茄钟音效 + 弹窗提示
- Windows 窗口控件修复，跨平台 frameless titlebar

### v1.5.0 — 智能决策引擎

- 首页从 Bento 展示重构为指令决策面板
- 72h 风险池 / 知识净增量 / 专注转化率

### v1.4.0 — 引擎重构

- Electron 34 升级，主进程全量 TypeScript 化
- Vite + tsc 双构建管线

### v1.3.0 — 今日看板 + SM-2

- Bento 着陆页，SM-2 间隔重复，考研倒计时

### v1.2.0 — TypeScript 全量迁移

- 50 源文件 JS → TS strict，类型基础设施建立

### v1.1.0 — 稳定性里程碑

- 敏感字段过滤，GitHub Actions CI 建立

### v1.0.x

- 核心功能：日记、番茄钟、错题本、AI 助手、暗色模式

</details>

---

## 贡献

Pull Request 与 [Issue](https://github.com/gakialter/Minddiary/issues) 欢迎提交。

## 许可证

[MIT](./LICENSE)
