# MindDiary (考研日记) ✨

> 📚 **考研人的终极本地知识与时间管理枢纽**
> MindDiary 是一款专为重度学习者（考研、公考、长期备考）打造的桌面级本地 First 效率工具。它将**结构化日记、错题管理、番茄钟专属统计**以及**本地 AI 助教**融为一体。完全开源、数据本地存储、极致丝滑的跨平台体验。

![MindDiary App Icon](./build/icon.ico)

[![CI](https://github.com/gakialter/Minddiary/actions/workflows/ci.yml/badge.svg)](https://github.com/gakialter/Minddiary/actions/workflows/ci.yml)
[![Release](https://github.com/gakialter/Minddiary/actions/workflows/release.yml/badge.svg)](https://github.com/gakialter/Minddiary/actions/workflows/release.yml)
[![Version](https://img.shields.io/badge/version-1.1.0-blueviolet)](https://github.com/gakialter/Minddiary/releases/tag/v1.1.0)

---

## 🌟 核心特性 (Features)

### 1. 📝 沉浸式知识编辑与总结
*   **富文本与 Markdown 双擎驱动**：支持语法高亮、快捷键 `Ctrl+K` 唤醒全局命令面板。
*   **考研专属模板**：内置「考研模板」、「精简复盘模板」，帮你在每天结束时快速复盘当日各科进度和情绪。
*   **本地图床支持**：所有的附件图片直接存入本地 SQLite，摆脱图床失效的烦恼。

### 2. 🍅 与日记深度绑定的番茄钟
*   **专注流线**：开始番茄钟时自动弹出悬浮 Widget，结束时可立刻一键将专注心得关联并记录到当天的日记中。
*   **多维度追踪**：支持工作区科目选择，自动统计单科累计专注时间。

### 3. 🧠 你的错题知识库
*   不再是乱糟糟的纸质本。为错题打上标签、科目，随时通过搜索面板（全局全文检索）或 AI 抽查来复习薄弱环节，通过状态机管理「未解决」到「已掌握」。

### 4. 📊 极客级数据透视
*   **GitHub 风格学习热力图**：直观展示长达 90 天的学习贡献度和疲劳点。
*   **多科耗时统计雷达**：一页看透你这周在英语、政治还是专课上花费了最多的时间。

### 5. 🤖 离线优先的 AI 助教
*   基于您配置的本地/云端 LLM 接口，MindDiary 提供了一位随时待命的 AI 辅导师。
*   **无需手动喂前置 Context**：它能自动读取你当天的日记、各科番茄钟数据和错题集，直接为你提供「心理按摩」、「错题规律分析」和「明日复习冲刺大纲」。

### 6. 🔒 数据主权绝对在握
*   **0 云端强制依赖**：通过 `better-sqlite3` 实现全量数据强本地化，不联网也可完全独立使用全部核心功能。
*   **导出安全加固**：导出 JSON 备份时自动剔除 AI API Key 等敏感字段，防止密钥意外泄露。
*   **灵活备份与导入导出**：支持 JSON 全量备份与增量合并导入；支持 Markdown 和高清 PDF 导出。

---

## 🛠️ 技术栈构架

| 层次 | 技术 |
|------|------|
| **Application Shell** | [Electron](https://www.electronjs.org/) + `contextIsolation` 安全 IPC |
| **Frontend Core** | [React 18](https://reactjs.org/) + [Vite](https://vitejs.dev/) |
| **Database Engine** | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 同步本地 SQLite |
| **UI/Styling** | 原生 Vanilla CSS3 变量 + 毛玻璃动效 |
| **Testing** | [Vitest](https://vitest.dev/) + [@testing-library/react](https://testing-library.com/) |
| **CI/CD** | GitHub Actions (自动跑测试 + 自动打包 Windows .exe) |

---

## 🚀 本地开发与构建 (Getting Started)

### 环境要求
确保你已经安装了 `Node.js`（推荐 v18+）。

### 1. 克隆代码并安装依赖
```bash
git clone https://github.com/gakialter/Minddiary.git
cd Minddiary
npm install
```

### 2. 开发模式体验
```bash
npm run dev
```
将同时启动 Vite 前端服务器与 Electron 主进程。

### 3. 运行单元测试
```bash
npx vitest run
```

### 4. 构建发布产物 (Windows)
```bash
npm run build
```
输出目录位于 `/release/` 下。也可以直接从 [Releases](https://github.com/gakialter/Minddiary/releases) 页面下载最新安装包。

---

## 💡 使用说明

1. **第一次运行**：打开软件后会进入新手引导，完成后即可开始记录。
2. **AI API 配置**：在设置 `⚙️` 面板填写标准 OpenAI 兼容的 URL 端点以及 Token（仅存于本地，不会被导出）。
3. **数据跨设备迁移**：点击 `导出为 JSON` 并在另一台机器选择 `从 JSON 导入`，导入算法将智能执行增量去重比对。

---

## 📋 更新日志 (Changelog)

### v1.1.0 (2026-03-22) — Phase 11 稳定性与安全里程碑
*   ✅ **安全加固**：JSON 备份导出时自动剔除 `aiApiKey` 等敏感字段（新增 `sanitize.js` 工具模块）。
*   🏗️ **架构重构**：抽离 `useNavigation` 和 `useGlobalKeyboard` 自定义 Hook，`App.jsx` 精简化。
*   🧪 **完善测试**：建立单元测试骨架（Vitest + React Testing Library），共 29 个测试全部通过。
*   🤖 **CI/CD**：新增 GitHub Actions CI 工作流，每次 PR 自动验证测试通过。

### v1.0.7 及更早
*   日记编辑、番茄钟、错题本、AI 助手、数据统计等核心功能建立与打磨。

---

## 🤝 贡献说明 (Contributing)
如果你在备考的过程中发现了更好用的效率模式，或者想要修复一个视觉小 Bug，非常欢迎提交 Pull Request 或者 Issue。

## 📄 协议 (License)
本项目代码基于 [MIT License](LICENSE) 开源。祝所有的考研/公考学子顺利上岸！🚀
