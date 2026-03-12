# 双 AI 协同开发工作流模板

> 从 MindDiary 项目实战中提炼，可直接复用到任何新项目。

---

## 快速启动检查清单

开新项目前，先确认这 4 件事：

- [ ] Antigravity (Windsurf) 已打开项目目录
- [ ] Claude Code (CLI) 已 `cd` 到同一个项目目录
- [ ] Claude Code 的 MEMORY.md 已初始化（写入项目名称和技术栈）
- [ ] Git 仓库已初始化（`git init`），两个 AI 共享同一个 repo

---

## 第零阶段：架构规划（Antigravity Planning + Opus 4.6）

> **这是整个项目最关键的一步。** MindDiary 项目的多数 Bug（键名不一致、依赖分类错误、useRef 丢失）都源于开工前没有统一的架构规范。规划阶段 token 消耗极少，但对全局质量影响最大——这是 Opus 额度性价比最高的用法。

**执行者**：Antigravity 的 Planning 模式（切换到 Claude Opus 4.6）
**耗时**：通常 10~20 分钟
**Opus 额度消耗**：极低（规划阶段主要是文本输出，不写代码）

### 操作步骤

1. 在 Antigravity 中手动切换模型到 **Claude Opus 4.6**
2. 开启 **Planning 模式**（Agent 的规划能力）
3. 给出以下 Prompt：

```
我要开发一个 [项目名]。

技术栈：[如 Electron + React + Vite + SQLite]
核心功能：
1. [功能 A]
2. [功能 B]
3. [功能 C]

请你作为架构师，输出一份完整的项目规划文档，包含：

1. **目录结构**：每个文件夹的职责，精确到文件级别
2. **数据模型**：数据库表结构 / 状态管理的 shape，含字段类型和索引
3. **命名规范**：
   - 变量/函数命名风格（camelCase / snake_case）
   - 数据库字段命名风格
   - 前端状态 key 命名风格
   - **三者之间的映射关系**（这一条最重要，MindDiary 的 BUG-1 就栽在这里）
4. **依赖清单**：
   - dependencies（运行时必须）vs devDependencies（仅开发/构建）
   - 每个包的用途和放在哪一类的理由
5. **IPC / API 接口契约**：函数签名、参数类型、返回值
6. **安全规范**：哪些地方必须加 DOMPurify / 输入校验 / try-catch
7. **分阶段实施计划**：按优先级拆分为 Phase 1, 2, 3...

输出为 Markdown，存为 PROJECT_PLAN.md。
```

### 为什么用 Opus 而不是 Gemini

| 维度 | Gemini 3.1 Pro | Claude Opus 4.6 |
|------|---------------|-----------------|
| 架构一致性 | 容易前后矛盾（键名 camelCase/snake_case 混用） | 全局一致性极强 |
| 边界条件思考 | 容易遗漏（忘记 try-catch、忘记索引） | 主动考虑异常路径 |
| 安全意识 | 需要提醒才会加 DOMPurify | 默认会标注安全风险点 |
| 额度消耗 | 不限 | 少量（规划阶段文本为主） |

### 产出物

- `PROJECT_PLAN.md` — 作为后续所有阶段的"宪法"，Antigravity 和 Claude Code 都必须参照执行
- 同步写入 Claude Code 的 `MEMORY.md` — 让 Claude Code 从第一天就知道全貌

### 规划完成后切回 Gemini

规划结束后，**立刻把 Antigravity 切回 Gemini 3.1 Pro**！不要用 Opus 写实现代码，那是浪费额度。

---

## 第一阶段：骨架搭建（Antigravity 主攻）

**执行者**：Antigravity（切回 Gemini 3.1 Pro）
**Claude Code 状态**：待命
**参照文档**：`PROJECT_PLAN.md`（第零阶段产出）

### Antigravity 负责

1. **严格按照 PROJECT_PLAN.md** 初始化项目（脚手架、目录结构、依赖安装）
2. 核心架构搭建（路由、状态管理、数据库、API 层）
3. 全部 UI 组件的第一版实现
4. 基础功能联调，确保能跑起来

> 有了 Plan 的约束，Gemini 就不容易犯键名不一致、依赖分类错误这类问题。Plan 就是 Gemini 的"护栏"。

### 交接节点

当 Antigravity 说"骨架搭好了"或"基础功能可用了"时，执行交接：

```
给 Claude Code 的交接信息模板：

项目：[项目名]
技术栈：[如 Electron + React + Vite + SQLite]
目录结构：[贴 tree 命令输出或简述]
当前状态：[能跑 / 有已知 bug]
需要你做：[具体任务列表]
```

---

## 第二阶段：审计 + 精修（Claude Code 主攻）

**执行者**：Claude Code（Sonnet 4.6，复杂问题切 Opus 4.6）
**Antigravity 状态**：待命或做其他独立任务

### Claude Code 必做的 5 项审计

每次 Antigravity 交付一批代码后，Claude Code 都要跑这个清单：

```bash
# 1. 安全审计：检查 XSS / 注入风险
# 搜索所有 dangerouslySetInnerHTML，确认有 DOMPurify
grep -rn "dangerouslySetInnerHTML" src/

# 2. 引用完整性：检查所有 useRef 是否有对应声明
grep -rn "\.current" src/ | grep -v "node_modules"

# 3. API 调用规范：确认没有绕过抽象层的直接调用
grep -rn "window\.api\." src/ --include="*.jsx" --include="*.js"
# 只应出现在 context/adapter 层

# 4. 键名一致性：确认读写用同一个 key
# 手动对比 Settings 保存的 key 和其他组件读取的 key

# 5. 依赖分类：确认运行时依赖不在 devDependencies
# 检查 main process 的 require 是否都在 dependencies 里
```

### Claude Code 负责的典型任务

| 任务类型 | 推荐模型 | 示例 |
|---------|---------|------|
| 性能优化 | Sonnet 4.6 | O(n²) → O(n)、消除不必要的 re-render |
| 内存泄漏 | Sonnet 4.6 | useEffect 依赖修复、interval 清理 |
| 安全加固 | **Opus 4.6** | 注入防护、XSS 过滤、输入校验 |
| 架构级重构 | **Opus 4.6** | 双环境适配、全局状态重新设计 |
| 简单 Bug 修复 | Sonnet 4.6 | CSS 布局、缺失声明、拼写错误 |
| 文档撰写 | Sonnet 4.6 或 DeepSeek | README、复盘文档 |

---

## 第三阶段：功能迭代（双 AI 交替推进）

进入稳定开发节奏后，按任务性质分配：

### 分配决策树

```
收到新任务
  │
  ├─ 需要新建多个文件 / 大规模改动？
  │   └─ YES → Antigravity (Gemini)
  │             完成后 → Claude Code 审计 diff
  │
  ├─ 单文件内部优化 / 精准修复？
  │   └─ YES → Claude Code (Sonnet)
  │
  ├─ 框架底层疑难杂症？
  │   └─ YES → Claude Code (Opus)
  │
  ├─ CI/CD / DevOps 配置？
  │   └─ YES → Antigravity 写初版
  │             → Claude Code 审查 + 调试
  │
  └─ UI/UX 设计性工作？
      └─ YES → Claude Code + @ui-ux-pro-max-skill
               或 Antigravity 快速出原型
```

### 接力模式（同一个任务两人合作）

```
场景：Antigravity 写了一个功能但有 bug，调了几轮没修好

1. Antigravity 停下来，整理当前状态：
   - 错误截图 / 日志
   - 已尝试的修复方案
   - 相关文件路径

2. 用户把上下文贴给 Claude Code：
   "看一下 src/components/Foo.jsx，Antigravity 写的，
    报错是 [错误信息]，它试了 [方案] 没用"

3. Claude Code 读取文件、定位根因、精准修复

4. 修完后用户告诉 Antigravity：
   "Claude Code 已经修好了 Foo.jsx 的 [问题]，
    你继续推进下一个任务"
```

---

## 模型调度速查卡

### Antigravity 侧

| 模型 | 何时用 | 注意 |
|------|-------|------|
| Gemini 3.1 Pro（默认） | 95% 的时间 | 速度快、额度充足、适合大量代码生成 |
| Claude Opus 4.6（手动切） | 极端疑难 | **每天只有几次机会**，绝不拿来写 CRUD |

### Claude Code 侧

| 模型 | 切换命令 | 何时用 | 注意 |
|------|---------|-------|------|
| Sonnet 4.6（默认） | `/model sonnet` | 日常开发、简单 bug、审计扫描 | 速度快、性价比最高 |
| Opus 4.6 | `/model opus` | 安全审计、架构重构、深度推理 | 额度比 Antigravity 的 Opus 充裕，但也别浪费 |
| DeepSeek-V3.2 | `/model default` | 简单问答、文档草稿 | 免费但能力有限 |

### 限额对冲策略

```
黄金法则：Antigravity 用 Gemini 扛量，Claude Code 用 Opus 攻坚

                    ┌─────────────────────────────────────┐
  Antigravity       │  Gemini 3.1 Pro ████████████████ 95% │
  (Windsurf)        │  Claude Opus    █                 5% │
                    └─────────────────────────────────────┘
                    ┌─────────────────────────────────────┐
  Claude Code       │  Sonnet 4.6     ████████████     70% │
  (CLI)             │  Opus 4.6       ██████           25% │
                    │  DeepSeek       █                 5% │
                    └─────────────────────────────────────┘
```

---

## Skills 调用时机表

在 Claude Code 中，遇到以下场景时主动调用对应 Skill：

| 触发信号 | 调用 Skill | 效果 |
|---------|-----------|------|
| "这个 UI 太丑了" / 需要专业配色 | `@ui-ux-pro-max-skill` | 50 种风格 + 21 种配色 |
| 项目复杂度上升、怕丢上下文 | `@planning-with-files` | 自动创建 task_plan.md 跟踪进度 |
| 用到不熟悉的库 | `@context7` | 实时拉取最新文档 |
| React 组件 prop 爆炸 | `@composition-patterns` | 复合组件模式重构 |
| Bug 反复修不好 | `@systematic-debugging` | 结构化排查流程 |
| 准备提交代码 | `@commit-commands` | 规范化 commit |
| 要做 code review | `@code-review` | 自动审查安全/性能/最佳实践 |
| 多个独立任务要并行 | `@dispatching-parallel-agents` | 起子 Agent 并行处理 |

---

## Git 协作规范

两个 AI 写同一个 repo，遵守以下规则避免冲突：

### 提交规范

```
feat: 新功能
fix: Bug 修复
perf: 性能优化
security: 安全加固
refactor: 重构（不改变外部行为）
chore: 构建/CI/文档等杂务
```

### 避免冲突的方法

1. **不要同时改同一个文件**：Antigravity 改 A 文件时，Claude Code 去改 B 文件
2. **频繁提交**：每完成一个小功能就 commit，减小合并冲突的范围
3. **切换前先 pull**：切到另一个 AI 工作前，确认 git 状态是最新的
4. **各有领地**：
   - Antigravity 主要负责：组件文件、样式文件、配置文件
   - Claude Code 主要负责：utils 工具函数、安全模块、性能优化

---

## 发版流程（适用于 Electron 项目）

```bash
# 1. 确认所有改动已提交
git status

# 2. 更新 package.json 版本号
# 手动或让 AI 改

# 3. 提交版本号变更
git add package.json
git commit -m "chore: release vX.Y.Z"

# 4. 打 Tag 并推送（触发 CI 自动构建）
git tag vX.Y.Z && git push origin vX.Y.Z

# 5. 等待 GitHub Actions 完成
# 在 GitHub → Actions 页面查看进度
# 构建成功后，Release 页面自动出现安装包
```

### Electron 依赖分类红线

```
dependencies     → 会被打进 app.asar → 运行时需要的包
devDependencies  → 不会被打进去     → 只在开发/构建时用的包

错放 = 启动崩溃，没有任何提示只有一个弹窗报错
```

主进程 `require()` 的每个包都必须：
1. 在 `dependencies` 里（不是 `devDependencies`）
2. 用 try-catch 包裹（防止可选依赖缺失时崩溃）

---

## 新项目启动模板对话

### 对 Antigravity 说

```
我要开始一个新项目：[项目名]
技术栈：[如 Electron + React + Vite]
核心功能：[1. xxx  2. xxx  3. xxx]

请按以下顺序搭建：
1. 项目初始化 + 目录结构
2. 数据库/状态管理层
3. 核心 UI 组件
4. 基础功能联调

搭好后告诉我，我会让 Claude Code 做安全审计。
```

### 对 Claude Code 说

```
Antigravity 刚搭好了 [项目名] 的骨架。
技术栈：[xxx]
项目目录：[路径]

请你：
1. 读取项目结构，更新 MEMORY.md
2. 对所有组件做一遍安全审计（XSS、注入、依赖分类）
3. 列出发现的问题，按严重度排序
4. 逐个修复
```

---

## 复盘模板

每个项目阶段结束后，让 Claude Code 更新 MEMORY.md：

```markdown
## Phase X：[阶段名] ([日期] — DONE)

### 执行者与模型
- 主攻：[Antigravity/Gemini 或 Claude Code/Sonnet 或 Opus]
- 审计：[谁做的审计]

### 完成内容
- [具体改动 1]
- [具体改动 2]

### 发现的问题
- [Bug/坑点及根因]

### 经验教训
- [下次要注意什么]
```
