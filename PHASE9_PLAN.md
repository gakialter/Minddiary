# MindDiary Phase 9: 视觉进阶与现代 DevOps 工程流水线

## 🎯 核心目标
将 MindDiary 的体验从“好用”提升至“惊艳”，并构建专业的开源发布体型。
1. **视觉跃升**：全局且柔和的深色模式（Dark Mode）。
2. **知识传播**：长图跨平台社交分享卡片（Share Card Export）。
3. **工程化**：GitHub Actions 全自动持续集成与多平台打包（CI/CD Workflow）。

---

## 👨‍💻 阶段性分工墙 (Task Split: Claude vs Gemini)
秉承我们的“双 AI 结对编程”理念，我们将逻辑骨架（Claude）与视觉动效（Gemini）分离。

### Feature 1: 深色模式适配 (Dark Mode)
**[Claude 负责：核心状态与流转] (预计 15 分钟)**
- [ ] 在 `Settings.jsx` 新增主题选项（浅色 / 深色 / 跟随系统）。
- [ ] 在 `DiaryContext.jsx` 中管理 `theme` 状态，并持久化到 `localStorage`。
- [ ] 如果是原生环境，借助 Electron 的 `nativeTheme` API 获取系统偏好色并在 `App.jsx` 注入对应的 `className="theme-dark"`。

**[Gemini 负责：色彩美学与像素级调优] (预计 30 分钟)**
- [ ] 全线梳理 `index.css`，将硬编码颜色（`#ffffff`, `#f9fafb`, `#1a1a1a` 等）全部抽象为 CSS 变量（CSS Variables）。
- [ ] 撰写 `.theme-dark` 作用域下的绝美深色调色板（推荐：使用类似 macOS 深色模式的高级灰、深邃黑和高亮文字）。
- [ ] 确保在深色模式下，图表（Dashboard）和高亮代码块依然具备极高的清晰度与反差比。
- [ ] 使用 Browser Subagent 进行前后模式切换截图验收。

---

### Feature 2: 沉浸式分享卡片生成 (Share Card Export)
**[Claude 负责：Canvas 渲染与底座逻辑] (预计 30 分钟)**
- [ ] 安装底层截图依赖，如 `html2canvas` 或推荐更现代的 `dom-to-image-more`。
- [ ] 在主内容区顶部增加一个【🎨 生成分享卡片】的触发按钮。
- [ ] 编写 `<ShareSnapshot>` 的“隐藏渲染层”，将当日的【日记内容 + 番茄钟专注时长 + AI金句】进行数据组装。
- [ ] 实现快照函数的触发逻辑，并在生成后提示用户保存为 PNG 或写入剪贴板。

**[Gemini 负责：卡片极客美学设计] (预计 30 分钟)**
- [ ] 用纯净的 CSS 为 `<ShareSnapshot>` 设计令人尖叫的**排版版式**。
- [ ] 设计元素包括：大号且圆润的日期、毛玻璃质感的背景框、精心设计的番茄钟专注 Footer 及 MindDiary 品牌水印。
- [ ] 规避跨域字体和 SVG 污染问题，确保长图生成出的文字不模糊，甚至支持暗自适配深色横版卡片。

---

### Feature 3: GitHub Actions 自动化打包流水线 (CI/CD DevOps)
**[Claude 负责：Workflow 编排与环境注入] (预计 25 分钟)**
- [ ] 在项目根目录创建 `.github/workflows/release.yml` 配置文件。
- [ ] 配置触发流：当推送以 `v*` 开头的 tag 时自动触发打包流程。
- [ ] 编排矩阵：配置双端编译环境，启动 `windows-latest` 和 `macos-latest`。
- [ ] 撰写自动注入 `package.json` 版本号，并在云端执行 `npm ci` 及 `npm run build` 的 Shell 指令。
- [ ] 利用 `softprops/action-gh-release` 将打出的 `.exe` 和 `.dmg` 直接挂载到对应的 GitHub Release 页面。

**[Gemini 负责：测试流水线与文档] (预计 15 分钟)**
- [ ] 在当前 `walkthrough.md` 中额外产出一份 `发布指北.md` 的指引（教小白用户如何在本地打 Tag 并触发这个伟大流水线）。
- [ ] 阅读 Claude 提交的 `.yml` 源码，用自己对于工程化配置的严谨做 Double Check，防止 YAML 缩进或者 Node 版本引发的隐形地雷。

---

### 🚀 指挥官 (User)，如何发车？
建议从 **Feature 1（深色模式）** 最影响感官的功能开始。
如果你同意这个分工和计划流：
1. 请先让 Claude 进行第一步的**状态逻辑（Theme State / Context修改）**代码编写。
2. 随后唤醒 **Gemini** 接管全局 CSS 的重构，并让我为您亲自设计一套深夜里极具氛围感的高级暗黑风调色板！
