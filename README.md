<p align="center">
  <img src="./public/images/app-icon.svg" alt="MindDiary" width="120" />
</p>

<h1 align="center">MindDiary · 考研日记</h1>

<p align="center">
  <strong>考研人的终极本地知识与时间管理枢纽</strong><br/>
  结构化日记 · 番茄钟 · 错题管理 · AI 助教 — 全部数据本地存储
</p>

<p align="center">
  <a href="https://github.com/gakialter/Minddiary/actions/workflows/ci.yml"><img src="https://github.com/gakialter/Minddiary/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/gakialter/Minddiary/actions/workflows/release.yml"><img src="https://github.com/gakialter/Minddiary/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/gakialter/Minddiary/releases/latest"><img src="https://img.shields.io/github/v/release/gakialter/Minddiary?color=blueviolet" alt="Version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

---

## ✨ 功能亮点

<table>
<tr>
<td width="50%">

### 📝 沉浸式日记编辑
- Markdown 语法支持，`Ctrl+S` 一键保存
- **自定义日记模板** (v1.6.0): 内置 3 套默认模板 + 无限自定义模板管理
- 心情追踪 + 字数统计 + 分享卡片导出

</td>
<td width="50%">

### 🍅 深度绑定的番茄钟
- 专注时自动弹出悬浮 Widget
- 按科目追踪累计专注时间
- **声音 + 弹窗提示** (v1.6.0): 适合看网课时使用，完成后展示专注统计
- 完成后一键将心得写入当天日记

</td>
</tr>
<tr>
<td>

### 🧠 结构化错题管理
- 按科目分类，标签化管理
- 状态机驱动「未解决 → 已掌握」
- 全文检索 + AI 抽查复习

</td>
<td>

### 📊 学习轨迹可视化
- GitHub 风格 90 天学习热力图
- 多科耗时雷达图
- 连续打卡天数统计

</td>
</tr>
<tr>
<td>

### 🤖 离线优先 AI 助教
- 兼容 OpenAI 标准接口（本地/云端 LLM）
- 自动读取日记、番茄钟、错题集生成建议
- 内置 Prompt 注入防护

</td>
<td>

### 🔒 数据主权在握
- SQLite 全量本地化，无云端依赖
- JSON 全量备份 + 增量合并导入
- 导出时自动剔除 API Key 等敏感信息

</td>
</tr>
<tr>
<td>

### 🏠 智能决策引擎 (v1.5.0 NEW)
- **动作直达**：首页从数据全量展示变为“单指令决策”，优先推荐当前应处理的学习任务
- **数据佐证**：大字号直观展示 3 个核心指标，为行动建议提供底层数据支撑
- **动态干预**：根据学习负荷自动识别状态（如复习预警、疲劳提示），动态调整推荐策略
- **专注体验**：减少非关键图表对首屏视野的干扰，保持界面清爽清晰

</td>
<td>

### 🔁 结果导向核心指标 (v1.5.0 NEW)
- 摒弃虚荣统计，围绕“真实学习结果”建立全新的分析引擎
- **72小时风险池**：精准追踪即将到达遗忘临界点的知识，优先安排抢救
- **知识净增量**：过滤无效复习，仅统计真正转化为“已掌握”状态的坚实成果
- **专注转化率**：计算番茄钟时长与产出的日记/错题比例，衡量真实学习效率

</td>
</tr>
</table>

---

## 📸 界面预览

<p align="center">
  <img src="./docs/assets/editor.png" width="45%" alt="日记编辑器"/>
  &nbsp;&nbsp;
  <img src="./docs/assets/dashboard.png" width="45%" alt="数据统计面板"/>
</p>

<p align="center">
  <img src="./docs/assets/pomodoro.png" width="45%" alt="番茄钟"/>
  &nbsp;&nbsp;
  <img src="./docs/assets/mistake-book.png" width="45%" alt="错题本"/>
</p>

---

## 🛠️ 技术栈

| 层次 | 技术 |
|------|------|
| **应用外壳** | [Electron 34](https://www.electronjs.org/) + `contextIsolation` 安全 IPC |
| **前端** | [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/) (strict) + [Vite](https://vitejs.dev/) |
| **数据库** | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)（WAL 模式） |
| **样式** | CSS Variables + [Tailwind](https://tailwindcss.com/) utilities + 毛玻璃动效，Apple HIG 设计风格 |
| **图标** | [Lucide React](https://lucide.dev/) |
| **类型安全** | 完整 `strict` 模式，55+ 个源文件全量类型化 |
| **测试** | [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/)，52+ unit tests + [Playwright](https://playwright.dev/) E2E |
| **CI/CD** | GitHub Actions（Type Check → Unit Test → Build → Release） |

---

## 🚀 快速开始

### 环境要求
- **Node.js** 20+
- **npm** 或 **pnpm**

### 安装与开发

```bash
# 克隆并安装
git clone https://github.com/gakialter/Minddiary.git
cd Minddiary
npm install

# 启动开发模式（Vite + Electron 同时运行）
npm run dev

# 类型检查
npm run typecheck

# 运行测试
npm run test

# 构建发布包（当前平台）
npm run build

# 仅构建 macOS 发布包
npm run build:mac

# 仅构建 Windows 发布包
npm run build:win

# 默认产物输出到 release/
# Windows 生成 NSIS 安装包 / portable；macOS 生成 .dmg / .zip
```

也可以直接在 [Releases](https://github.com/gakialter/Minddiary/releases) 页面下载安装包。

---

## 💡 使用指南

1. **首次运行** — 完成新手引导后即可开始记录
2. **AI 配置** — 在设置 `⚙️` 中填写 OpenAI 兼容端点和 Token（仅存于本地）
3. **快捷键** — `Ctrl/Cmd+S` 保存 · `Ctrl/Cmd+K` 打开命令面板
4. **数据迁移** — 「导出为 JSON」→ 换机后「从 JSON 导入」，支持智能增量去重

---

## 📂 项目结构

```
docs/
└── brand.md        # 品牌与视觉识别规范 (单一信源)

src/
├── components/     # React UI 组件 (.tsx)
├── contexts/       # 状态管理 — Settings / Data / Diary / Pomodoro
├── hooks/          # Custom Hooks
├── types/          # TypeScript 类型定义（数据模型 + API 签名）
├── utils/          # 纯函数工具库
└── data/           # Mock 数据（浏览器开发模式）

electron/
├── main.ts         # Electron 主进程
├── preload.ts      # IPC Bridge (contextIsolation)
├── database.ts     # SQLite CRUD
├── fileManager.ts  # 附件文件管理
└── aiService.ts    # AI API 代理

tests/              # Vitest 单元测试 + 组件测试
```

---

## 📋 更新日志

### v1.7.0 — Zen Forest 品牌重塑 (2026-04-19)
- 🎨 **纯净感知环境** — 将整体色调从“通用工具蓝”重构为更具沉浸感、更低心智压力的 **「深林冥想 (Zen Forest)」** 色系。
- 🔗 **确立品牌单一信源 (SSOT)** — 将全局 Logo 抽象为独立 `<Logo />` 组件，并建立 `docs/brand.md` 约束化规范。
- 📦 **桌面环境适配** — 去除桌面、安装包图标的冗余文字，重构由“极简绝对原点”构筑的高清 SVG -> PNG 图标系统。
- 🛡️ **质量防劣化流程** — 引入针对状态色、设计规范的发版前自动化架构稽核与视觉验收体系。

### v1.6.1 — 热修复
- 🩹 **修复最小化按钮** — 修复了 Windows 平台下由于点击区域过小导致最小化按钮无响应的问题。

### v1.6.0 — 用户反馈优化
- 🐛 **Windows 窗口控件修复** — 修复 Win11 上最小化/最大化按钮不工作的致命 bug（`frame:false` + `titleBarStyle:'hidden'` 冲突），按平台分别配置
- 📝 **自定义日记模板** — 新增模板管理系统，支持创建/编辑/删除自定义模板，内置 3 个默认模板，数据持久化到 SQLite
- 🔔 **番茄钟声音 + 弹窗提示** — 计时结束播放双音铃声（Web Audio API, 零依赖）+ 全屏统计弹窗，适合看网课时使用，可在设置中独立开关
- 🖥️ **跨平台窗口适配** — Windows 自定义 frameless titlebar / macOS 原生 hiddenInset 红绿灯
- 🔄 **窗口状态实时同步** — maximize/unmaximize 事件推送，Win11 Snap Layout 下图标状态保持一致

### v1.5.0 — 引入智能决策引擎
- 🎯 **首页信息架构重构**：将平铺展示的看图模式（Bento-grid）优化升级为“指令决策面板”。减弱静态数据陈列的权重，以自然语言推送当前更值得投入的学习任务。
- 📈 **三大核心指标重塑**：精简常规统计维度，引入“72 小时风险池”、“知识净增量”、“专注转化率”构成数据核验体系，客观反映学习成效。
- 🤖 **动态状态推导**：内部逻辑根据当天的学习负荷、转化进度及待复习量综合推算状态机，动态调整推荐策略。
- 🔒 **纯净交付构建**：剥离内部计划性文稿与私有概念图，实现发行版本的纯净与标准化。
- 🕒 **系统级日期感知** — 顶部日期栏自动同步主机真实时间，告别显示滞后错乱
- 🔧 **版本号动态化** — “关于”页自动对齐 `package.json` 版本规范，避免硬编码隐患
- 🖼️ **资源加载修正** — 修正由于相对/绝对路径策略引起的小研 AI 助手离线头像丢失问题

### v1.4.0 — 引擎重构与类型安全
- 🛡️ **安全加固** — 升级至 Electron 34，彻底修复旧版遗留漏洞，重构已被废弃的 protocol 接口
- 🔷 **主进程全量 TypeScript 化** — Electron 主进程 (main/preload/database等) 100% 迁移至 TS `strict` 模式（注：目前仓库的极少数残留 JS 均为外围脚本，如 `scripts/create-icon.js`，核心业务 100% TS 化）
- 📦 **依赖精简** — 剔除独立的 `katex` 顶层依赖，统一收拢到 `react-latex-next` 内聚管理
- ✨ **双构建管线** — Vite + tsc 分离编译，确立渲染层与系统层的安全防护边界

### v1.3.0 — 今日看板 + 间隔重复

- 🏠 **全新 Bento 看板着陆页** — 番茄钟/日记/错题/连续打卡一屏总览，4 枚快捷入口
- 🧠 **SM-2 间隔重复** — 错题自动排期复习，番茄钟结束弹出待复习列表
- ✨ **AI 每日寄语** — 30 条考研励志格言确定性轮播
- 🎯 **考研倒计时** — 基于设置中的考研日期实时显示
- 🏗️ **后端批量查询** — 单事务 6 合 1 `getTodayDashboard()` 消除数据瀑布
- 🧪 新增 13 个 HomeDashboard 组件测试，总测试 60+
- 🔒 安全审计：零 XSS 向量，IPC 输入校验，snake→camel 一致性通过

### v1.2.0 — TypeScript 全量迁移

- 🔷 **Renderer 层全量 TypeScript 化** — 50 个源文件从 JS/JSX 迁移至 TS/TSX，启用 `strict` 模式
- 🏗️ 建立完整类型基础设施 — `src/types/` 包含数据模型接口、ElectronAPI 签名、全局类型声明
- 🧹 仓库卫生治理 — 清除 22 个调试截图、临时脚本、内部规划文档
- ⚡ CI 增加 `typecheck` 步骤，类型错误在合并前即被拦截
- 📝 Node.js 最低版本要求提升至 20+

### v1.1.0 — 稳定性与安全里程碑
- ✅ JSON 备份导出时自动剔除敏感字段
- 🏗️ App 架构重构：抽离 `useNavigation` / `useGlobalKeyboard` Custom Hooks
- 🧪 建立单元测试骨架（Vitest + React Testing Library）
- 🤖 新增 GitHub Actions CI 工作流

<details>
<summary>更早版本</summary>

### v1.0.x
- 日记编辑、番茄钟、错题本、AI 助手等核心功能建立与打磨
- 暗色模式、分享卡片、自动备份
- CSP 安全策略、Prompt 注入防护

</details>

---

## 🤝 贡献

欢迎提交 Pull Request 或 [Issue](https://github.com/gakialter/Minddiary/issues)。

## 📄 许可证

[MIT License](./LICENSE) — 祝所有考研 / 公考学子顺利上岸！🚀
