<p align="center">
  <img src="./public/images/app-icon.svg" alt="MindDiary" width="96" />
</p>

<h3 align="center">MindDiary</h3>

<p align="center">
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

## 设计理念

**Less but better. Action first, noise last.**

MindDiary 是一个为考研备考者设计的桌面日记与效率工具。它围绕"持续学习"这一核心动作，提供日记、番茄钟、错题管理三层结构化记忆与追踪，辅以 AI 助教的低摩擦智囊支持。

全部数据存储在本地 SQLite 中，无云端依赖，用户拥有完整数据主权。

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

## 功能概览

### 日记系统

- Markdown 编辑，Ctrl+S 即时保存
- 自定义日记模板，AI 智能汇总
- 分享卡片导出 (PNG)

### 番茄钟

- 按科目追踪累计专注时间
- 自定义时长，Web Audio 完工音效
- 悬浮 Widget，拖拽自由定位

### 错题本

- 按科目分类，全文检索
- SM-2 间隔重复排期复习
- AI 错题抽查与规律分析

### 学习仪表盘

- 90 天热力图，多科耗时雷达图
- 考研倒计时，连续打卡统计
- 72h 风险池 / 知识净增量 / 专注转化率

### AI 助教

- 兼容 OpenAI 标准接口，7 大国产供应商一键切换
- Prompt 注入防护，请求超时熔断
- 支持本地 LLM 及云端模型

### 数据主权

- SQLite 全量本地化，零云端依赖
- JSON 全量备份，敏感字段自动剔除
- PDF / Markdown / JSON 三格式导出

## 技术栈

| 层       | 选型                                                         |
| -------- | ------------------------------------------------------------ |
| 外壳     | Electron 34 · contextIsolation · 安全 IPC                    |
| 前端     | React 18 · TypeScript strict · Vite                          |
| 数据库   | better-sqlite3 (WAL 模式，外键约束)                          |
| 样式     | CSS Variables + Tailwind utilities · Zen Forest 设计语言      |
| 图标     | Lucide React · `currentColor` 绑定                           |
| Markdown | react-markdown + remark-gfm · DOMPurify 消毒                |
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
- Lucide React 为唯一图标库，禁止 emoji 出现在 UI 中
- 动画以 `transform` + `opacity` 为主，尊重 `prefers-reduced-motion`

## 更新日志

<details>
<summary>v1.8.5 — 审计整改与品牌抛光 (2026-05-04)</summary>

**无障碍**：全局 icon-only 按钮补齐 `aria-label`，SVG 装饰图标标注 `aria-hidden`

**性能**：全项目 `<img>` 标签统一添加 `loading="lazy" decoding="async"`

**主题合规**：`MoodIcon` 硬编码色值迁移为 `color-mix`，适配品牌色

**品牌净化**：侧边栏极简回归，导航激活态圆角/对比度调整，移除冗余代码

</details>

<details>
<summary>v1.8.4 — AI 助手设置改版 (2026-05-03)</summary>

- 新增 2026 年国产大模型供应商注册表（DeepSeek V4、Qwen3、GLM-5.1 等 7 大供应商 20+ 模型）
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
