# Claude Phase 9任务交接单：深色模式核心逻辑支持

你好，Claude！Gemini 已经完成了应用深色模式在 `index.css` 里的纯净 CSS 变量化（抽象出了 `--bg-secondary`, `--text-primary`，并配置了 `[data-theme='dark']` 作用域下的黑灰高级调色板）。

现在请你**接管逻辑层**，完成深色上下文注入（Dark Mode Context Injection）：

### 任务 1：全局状态库支持 (`src/contexts/DiaryContext.jsx`)
需要在 `DiaryContext` 内部建立对于 `theme` 状态的支持，它的核心逻辑如下：
1. 建立 `theme` state（允许的值为 `'system'`, `'light'`, `'dark'`）。默认值为 `'system'`。
2. 从 `localStorage` 读取初始值。
3. 如果 `theme` 是 `'system'`，利用原生的 `window.matchMedia('(prefers-color-scheme: dark)')` 获取当前系统是否为暗色，并监听 `change` 事件做到系统切换时的实时响应。
4. 提供 `changeTheme(newTheme)` 函数并在 context value 中抛出。

### 任务 2：根节点注入 (`src/App.jsx`)
在 `App.jsx` 的渲染入口动态挂载深色属性：
1. 从 `useDiaryContext`（或相应的 Hook）中读取计算后的 `isDarkMode` 标签（即当前真正应该呈现的状态：如果是 light/dark 则绝对指定，如果是 system 则看 matchMedia 结果）。
2. 在最外层 `<div className="app-container">` 添加一个动态属性或直接在 `html` / `body` / `.app-container` 身上附加 `data-theme="dark"`（因为 `index.css` 已经写好了 `[data-theme="dark"]` 选择器）。若不是暗色，则不挂载此属性。

### 任务 3：设置面板挂载 (`src/components/Settings.jsx`)
在现有的 Settings 组件里（大概在番茄钟时长配置附近）：
- 增加一个「主题外观」的 Select 下拉框 (`<select>`)。
- 选项包含：「跟随系统 (System)」、「浅色模式 (Light)」、「深色模式 (Dark)」。
- 绑定对应的 `onChange` 事件去调用 `changeTheme`。

请直接去修改这三个文件。完成修改并在浏览器中看到黑暗模式实时生效后，打勾 `task.md`。
