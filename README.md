# MindDiary (考研日记) ✨

> 📚 **考研人的终极本地知识与时间管理枢纽**
> MindDiary 是一款专为重度学习者（考研、公考、长期备考）打造的桌面级本地 First 效率工具。它将**结构化日记、错题管理、番茄钟专属统计**以及**本地 AI 助教**融为一体。完全开源、数据本地加密存储、极致丝滑的跨平台体验。

![MindDiary App Icon](./build/icon.ico)

---

## 🌟 核心特性 (Features)

### 1. 📝 沉浸式知识编辑与总结
*   **富文本与 Markdown 双擎驱动**：支持语法高亮、快捷键 `Ctrl+K` 唤醒全局命令面板。
*   **考研专属模板**：内置「考研模板」、「精简复盘模板」，帮你在每天结束时快速复盘当日各科进度和情绪。
*   **本地图床支持**：所有的附件图片直接加密存入本地 SQLite，摆脱图床失效的烦恼。

### 2. 🍅 与日记深度绑定的番茄钟
*   **专注流线**：开始番茄钟时自动弹出悬浮 Widget，结束时可立刻一键将专注心得关联并记录到当天的日记中。
*   **多维度追踪**：支持工作区科目选择，自动统计单科累计专注时间。

### 3. 🧠 你的错题知识库
*   不再是乱糟糟的纸质本。为错题打上标签、科目，随时通过搜索面板（全局全文检索）或 AI 抽查来复习簿弱环节，通过状态机管理「未解决」到「已掌握」。

### 4. 📊 极客级数据透视
*   **GitHub 风格学习热力图**：直观展示长达 90 天的学习贡献度和疲劳点。
*   **多科耗时统计雷达**：一页看透你这周在英语、政治还是专课上花费了最多的时间。

### 5. 🤖 离线优先的 AI 助教
*   基于您配置的本地/云端 LLM 接口，MindDiary 提供了一位随时待命的 AI 辅导师。
*   **无需手动喂前置 Context**：它能自动读取你当天的日记、各科番茄钟数据和错题集，直接为你提供「心理按摩」、「错题规律分析」和「明日复习冲刺大纲」。

### 6. 🔒 数据主权绝对在握
*   **0 云端强制依赖**：通过 `better-sqlite3` 实现全量数据强本地化，不联网也可完全独立使用全部核心功能。
*   **灵活备份与导入导出**：支持标准 JSON 数据规范的全量合并与导入；支持任意日记 Markdown 和渲染 PDF 高清导出。

---

## 🛠️ 技术栈构架

这款现代桌面级 Web APP 采用了当今极为硬核和前沿的技术栈组合：
*   **Application Shell**: [Electron](https://www.electronjs.org/) (配合 `contextIsolation` 与原生双向 IPC 安全通信方案)
*   **Frontend Core**: [React 18](https://reactjs.org/) + [Vite](https://vitejs.dev/) (极速的 HMR 及构建体验)
*   **Database Engine**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (同步、高性能的本地 SQLite 引擎，完美胜任密集读写)
*   **UI/Styling**: 原生 Vanilla CSS3 变量驱动机制，构建了呼吸感的毛玻璃与 3D 弹簧动效。

---

## 🚀 本地开发与构建 (Getting Started)

### 环境要求
确保你已经安装了 `Node.js` (推荐 v18+)。目前项目仅支持通过 npm/yarn 进行依赖管理。

### 1. 克隆代码并安装依赖
```bash
git clone https://github.com/your-username/minddiary.git
cd minddiary

# 对于国内用户，建议使用 npm 淘宝镜像加速 Better-SQLite3 的预编译过程
npm install
```

### 2. 开发模式体验
使用 `npm run dev` 将通过 concurrently 机制同时启动 Vite 前端服务器以及 Electron 的主进程渲染。
```bash
npm run dev
```

### 3. 构建发布产物 (Windows/Mac)
运行如下命令，`electron-builder` 会自动针对当前操作系统输出独立的高压缩比安装包及便携 `exe`/`dmg`。
```bash
npm run build
```
输出目录位于 `/release/` 下。

---

## 💡 使用说明

1. **第一次运行**：打开软件后会自动进入全屏骨架屏完成底层数据库的初始化建表，之后你将进入首页引导。
2. **AI API 配置**：如需激活 AI 辅导员，请在设置 `⚙️` 面板填写标准 OpenAI 兼容的 URL 端点以及 Token。所有密钥将加密留存在本地环境。
3. **数据跨设备迁移**：如果你有多台设备，只需要点击 `导出为 JSON` 并在另一台机器选择 `从 JSON 导入`。导入算法将智能执行增量去重比对。

---

## 🤝 贡献说明 (Contributing)
如果你在备考的过程中发现了更好用的效率模式，或者想要修复一个视觉小 Bug，非常欢迎提交 Pull Request 或者 Issue。

## 📄 协议 (License)
本项目代码基于 [MIT License](LICENSE) 开源。祝所有的考研/公考学子顺利上岸！🚀
