# MindDiary Brand System

> **Single Source of Truth (SSOT)**
> This document is the definitive brand guideline for MindDiary.
> Any visual change must be reflected here before broad rollout.

---

## 0. Brand Story & Philosophy

### Name

**MindDiary** — 心智日记。记录学习思考的轨迹，而非仅仅记录事件。

### Core Metaphor: Zen Forest 禅意森林

MindDiary 的视觉语言源于一片安静的森林：低饱和度的大地色调、充足的留白、克制的装饰。工具退居幕后，让使用者的行动成为画面的主角。

### Target User

考研备考者 — 面对长周期（6–18 个月）、高压力的学习场景。使用环境涵盖宿舍、图书馆、深夜书桌。他们需要的不是一个炫技的工具，而是一个安静可靠的陪伴者。

### Design Principles

| # | Principle | 含义 |
|---|-----------|------|
| 1 | **Less but better** | 每个元素必须值得存在。删除不确定的，保留不可替代的 |
| 2 | **Low-pressure companionship** | 不制造焦虑，不用排名和红点施压。鼓励持续，而非冲刺 |
| 3 | **Action first, noise last** | 用户的行动（写日记、启动番茄钟、复习错题）优先于界面装饰 |

### Brand Voice

在所有文案场景中（AI 回复、空状态、错误提示），保持：

- **克制而温暖** — 不过度兴奋，不冷冰冰
- **具体而简短** — 说明发生了什么、该做什么，不废话
- **无 emoji** — UI 文案中禁止 emoji，保持专业克制感

---

## 1. Logo System

### Logo Identity: The Core

Logo 名为 **The Core（绝对原点）**，由一个实心圆和三段弧线组成。寓意：专注的核心被保护层环绕。

```
构成：
  ● 实心圆 (r=16) — 专注核心
  ⌒ 三段弧线 (r=32, strokeWidth=6) — 保护/成长层
```

### Source Files

| 用途 | 路径 | 说明 |
|------|------|------|
| UI 组件 | `src/components/Logo.tsx` | 产品 UI 中必须使用 `<Logo />` |
| 静态源 | `public/images/app-icon.svg` | 应用图标导出的唯一源 |
| 纯 Logo | `public/images/logo.svg` | 不含背景的纯 Logo SVG |

### Usage Rules

**最小尺寸**

| 尺寸 | 用途 | 要求 |
|------|------|------|
| 16px | Favicon, tab icon | 弧线可辨识即可 |
| 32px | Sidebar icon, badge | 弧线间隔清晰 |
| 48px+ | 页面展示 | 完整呈现 |

**安全区 (Clear Zone)**

Logo 外围保留 **≥ 1/4 Logo 直径** 的空白区域，不得被其他元素侵入。

**背景用法**

| 背景 | Logo 颜色 | 示例 |
|------|-----------|------|
| 浅色 (Light canvas) | `#0F766E` (accent) | 默认用法 |
| 深色 (Dark canvas) | `#14B8A6` (accent-dark) | 暗色模式 |
| 品牌色背景 | `#FFFFFF` | 反白 |

**禁止变体**

- ✗ 拉伸或压缩 — 必须等比缩放
- ✗ 旋转 — 保持正位
- ✗ 添加阴影、光晕、装饰边框
- ✗ 在 Logo 内部放置文字
- ✗ 修改弧线间距或圆心比例
- ✗ 在组件中内联重建 SVG（必须 import `<Logo />`）

### `<Logo />` Component Contract

```typescript
interface LogoProps {
  size?: number | string;  // 统一缩放
  color?: string;          // 默认 'currentColor'
  className?: string;      // 透传样式类
  title?: string;          // 无障碍标题
}
```

Requirements:
- 默认 `currentColor`，跟随父元素颜色
- 等比缩放，不允许独立设置 width/height
- 保持 markup 最小化，不在组件内硬编码页面特定变体

---

## 2. Color System

### Philosophy

Zen Forest 色彩体系以低饱和度的大地色为基调，accent 色（深松绿）作为唯一的高饱和度点缀，遵循 **60-30-10 视觉权重分配**：

- **60%** — 中性色表面 (canvas, cards)
- **30%** — 次级文本与边框
- **10%** — Accent 强调色（因稀缺而有力）

### Brand Colors

#### Light Mode (`:root`)

| Token | Hex | 用途 |
|-------|-----|------|
| `--bg-primary` | `#F6F7F4` | 画布底色（暖灰白） |
| `--bg-secondary` | `#FFFFFF` | 卡片/面板背景 |
| `--bg-tertiary` | `#ECF7F2` | Hover / 次级表面 |
| `--bg-overlay` | `rgba(0,0,0,0.4)` | 遮罩层 |
| `--bg-glass` | `rgba(255,255,255,0.75)` | 毛玻璃面板 |
| `--text-primary` | `#0F172A` | 主文本（深石板色） |
| `--text-secondary` | `#64748B` | 次级文本 |
| `--text-muted` | `#94A3B8` | 弱化文本 |
| `--border` | `rgba(15,23,42,0.08)` | 标准边框 |
| `--border-light` | `rgba(15,23,42,0.04)` | 极淡边框 |
| `--accent` | `#0F766E` | 主强调色（深松绿） |
| `--accent-light` | `#DFF3EC` | 选中项浅背景 |
| `--accent-dark` | `#0D655E` | 按钮 hover 加深 |
| `--success` | `#2F8F6B` | 成功状态 |
| `--warning` | `#D97706` | 警告状态 |
| `--danger` | `#C65A3A` | 危险状态（陶红） |
| `--info` | `#0F766E` | 信息提示（同 accent） |

#### Dark Mode (`[data-theme="dark"]`)

| Token | Hex | 变化说明 |
|-------|-----|----------|
| `--bg-primary` | `#111413` | 深松绿调暗底 |
| `--bg-secondary` | `#191E1C` | 卡片 |
| `--bg-tertiary` | `#202724` | Hover 表面 |
| `--bg-overlay` | `rgba(0,0,0,0.7)` | 更深遮罩 |
| `--bg-glass` | `rgba(25,30,28,0.75)` | 暗色毛玻璃 |
| `--text-primary` | `#ECF0EE` | 主文本（暖白） |
| `--text-secondary` | `#90A09A` | 次级文本 |
| `--text-muted` | `#64746A` | 弱化文本 |
| `--border` | `rgba(255,255,255,0.1)` | 边框 |
| `--border-light` | `rgba(255,255,255,0.05)` | 极淡边框 |
| `--accent` | `#14B8A6` | 提亮松绿（暗底需更高亮度） |
| `--accent-light` | `rgba(20,184,166,0.15)` | 选中项半透明 |
| `--accent-dark` | `#0D9488` | Hover 加深 |
| `--success` | `#34D399` | 提亮 |
| `--warning` | `#F59E0B` | 提亮 |
| `--danger` | `#E06C4F` | 提亮陶红 |
| `--info` | `#14B8A6` | 同 accent |

### Semantic Aliases

所有新代码必须使用语义 token，禁止直接引用原始变量：

| Semantic Token | Maps To | 用途 |
|----------------|---------|------|
| `--color-accent` | `var(--accent)` | 品牌主色 |
| `--color-bg-canvas` | `var(--bg-primary)` | 页面底色 |
| `--color-text-primary` | `var(--text-primary)` | 主文本 |
| `--color-state-danger` | `var(--danger)` | 危险状态 |
| `--color-state-success` | `var(--success)` | 成功状态 |

### Color Usage Rules

**Do:**
- 使用 accent 色时保持克制 — 它的力量源于稀缺
- 暖灰白画布代替纯白 (`#F6F7F4`, not `#FFFFFF`)
- 中性色带品牌色调 tint（暗色模式的背景均偏绿调）

**Don't:**
- ✗ 使用纯黑 `#000` 或纯白 `#FFF` 作为背景/文本
- ✗ 重新引入工具蓝 (generic tool blue)
- ✗ 将 danger 色用于非风险场景
- ✗ 添加装饰性渐变或高饱和度色块

### WCAG AA Contrast

| 组合 | 对比度 | 状态 |
|------|--------|------|
| `--text-primary` on `--bg-primary` (Light) | ≈ 14.5:1 | ✅ AAA |
| `--text-secondary` on `--bg-primary` (Light) | ≈ 4.9:1 | ✅ AA |
| `--accent` on `--bg-primary` (Light) | ≈ 4.8:1 | ✅ AA |
| `--text-primary` on `--bg-primary` (Dark) | ≈ 14.2:1 | ✅ AAA |
| `--accent` on `--bg-primary` (Dark) | ≈ 6.1:1 | ✅ AA |

---

## 3. Typography

### Font Stacks

```css
--font-sans: -apple-system, BlinkMacSystemFont,
             "PingFang SC", "Noto Sans SC", "Microsoft YaHei",
             "SF Pro Text", "Helvetica Neue", Arial, sans-serif;

--font-mono: "SF Mono", "Menlo", "Monaco", "Consolas", monospace;
```

**设计意图**：优先使用系统字体，保证原生渲染质量和零加载延迟。中文优先 PingFang SC（macOS）和 Microsoft YaHei（Windows）。

### Type Scale

| 用途 | 大小 | 字重 | 行高 |
|------|------|------|------|
| 超大标题 | 28px | 800 | 1.3 |
| 大标题 | 24px | 700 | 1.3 |
| 标题 | 18px | 600 | 1.4 |
| 正文（基准） | 15px | 400 | 1.6 |
| 辅助文本 | 14px | 400/500 | 1.5 |
| 小字 | 13px | 400 | 1.5 |
| 微标签 | 12px | 500 | 1.4 |

### Typography Rules

- 正文行宽不超过 **65–75ch**
- 标题使用负 letter-spacing（-0.5px ~ -0.3px）增加紧凑感
- 暗色模式下行高增加 0.05（浅色文字视觉更轻，需更多呼吸空间）
- 中文与英文/数字之间自动留半角空格（由组件层处理）
- 禁止全大写用于长段正文，仅限短标签和日期

---

## 4. Spacing & Layout

### Spacing Scale (4pt base)

| Token | Value | 用途 |
|-------|-------|------|
| `--space-xs` | 4px | 图标与文字间距、紧凑内边距 |
| `--space-sm` | 8px | 按钮内边距、列表项间距 |
| `--space` | 12px | 默认间距 |
| `--space-md` | 16px | 卡片内边距、区块间距 |
| `--space-lg` | 20px | 区段间距 |
| `--space-xl` | 28px | 大区块分隔 |
| `--space-2xl` | 40px | 页面级留白 |

### Border Radius

| Token | Value | 用途 |
|-------|-------|------|
| `--radius-sm` | 8px | 按钮、输入框、小元素 |
| `--radius` | 12px | 卡片、面板 |
| `--radius-lg` | 16px | 大面板、模态框 |

### Shadows

| Token | Value | 用途 |
|-------|-------|------|
| `--shadow-sm` | `0 2px 10px rgba(0,0,0,0.04)` | 静态卡片 |
| `--shadow` | `0 4px 20px rgba(0,0,0,0.08)` | Hover 卡片 |
| `--shadow-lg` | `0 10px 40px rgba(0,0,0,0.12)` | 浮层、模态框 |

> 暗色模式下阴影透明度分别为 0.2 / 0.4 / 0.6，以在深色背景上保持可见。

### Grid

- **App 布局**：`grid-template-columns: var(--sidebar-width, 240px) 1fr`
- **Sidebar**：固定 240px（可收缩）
- **Main content**：fluid，内边距 `--space`
- **卡片网格**：使用 `repeat(auto-fill, minmax(200px, 1fr))`

---

## 5. Iconography

### Icon Source

**Lucide React** 是 MindDiary 的唯一图标库。

### Specification

| 属性 | 值 | 说明 |
|------|-----|------|
| 默认尺寸 | 16 / 20 / 24px | 根据上下文选择 |
| 描边宽度 | 1.5px (Lucide 默认) | 禁止修改 |
| 颜色 | `currentColor` | 跟随父元素，禁止硬编码色值 |
| 对齐 | 与文字基线对齐 | 使用 `vertical-align` 或 flex 对齐 |

### Rules

- ✓ 所有 UI 图标使用 Lucide React 组件
- ✗ 禁止在 UI 中使用 emoji（emoji 仅限用户生成内容）
- ✗ 禁止混用其他图标库
- ✗ 禁止在图标外包裹圆角矩形色块（除非有明确的状态语义）

---

## 6. Motion

### Duration Tokens

| Token | Value | 用途 |
|-------|-------|------|
| `--duration-fast` | 150ms | Hover、toggle、微交互 |
| `--duration-normal` | 250ms | 页面切换、面板展开 |
| `--duration-slow` | 400ms | 模态出现、复杂过渡 |

### Easing Tokens

| Token | Value | 用途 |
|-------|-------|------|
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | 标准减速退出（主用） |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性效果（谨慎使用） |

### Keyframe Animations

| 名称 | 用途 | 描述 |
|------|------|------|
| `page-fade-in` | 页面切换 | fade + translateY(8px) + blur(8px) → 清晰 |
| `toast-in` | Toast 入场 | 底部弹入 + 微缩放 + 3D rotateX |
| `toast-out` | Toast 退场 | 下沉淡出 |
| `skeleton-shimmer` | 骨架屏 | opacity 0.5 → 1 → 0.5 循环 |
| `logo-pulse` | Logo 呼吸 | 微缩放 + 阴影变化 |

### Motion Rules

- 仅动画 `transform` 和 `opacity`，不动画 layout 属性
- 使用 ease-out 为主，避免 bounce / elastic
- 尊重 `prefers-reduced-motion`：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 7. Component Patterns

### Button System

| 层级 | Class | 外观 |
|------|-------|------|
| Primary | `.button-primary` | 实心 accent 背景，白色文字 |
| Default | `.button` | 白色背景，边框，标准文字 |
| Secondary | `.button-secondary` | 半透明背景，无边框 |

**Hover 行为**：`translateY(-1px)` + 加深阴影（禁止缩放或弹跳）

### Card

- 单层结构，**禁止卡片嵌套**
- 背景 `--bg-secondary`，边框 `--border`
- Hover 时阴影从 `--shadow-sm` 升至 `--shadow`
- 禁止装饰性渐变背景

### Input

- 焦点环：`0 0 0 3px rgba(15,118,110,0.25)` + accent 边框色
- placeholder 使用 `--text-muted`
- 内阴影 `inset 0 1px 2px rgba(0,0,0,0.02)` 增加凹陷感

### Glass Panel

- `backdrop-filter: blur(20px)` + 半透明背景
- 仅用于浮动工具栏、命令面板等临时覆盖层
- 禁止作为常规卡片的替代方案

### Toast

- 入场动画 `toast-in`（底部弹入 + 3D 旋转）
- 退场动画 `toast-out`
- 不使用 border-left 色条标记类型

---

## 8. Accessibility Contract

### WCAG AA Minimum

- 所有文本对比度 ≥ 4.5:1（正文）或 3:1（大文本 ≥ 18px bold）
- 交互元素对比度 ≥ 3:1

### Focus Visibility

```css
button:focus-visible,
[role="button"]:focus-visible,
a:focus-visible,
.input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.2);
}
```

鼠标点击时隐藏 outline（`:focus:not(:focus-visible)`），仅键盘导航时显示。

### Color Independence

颜色不作为传达信息的唯一手段。所有状态（success / warning / danger）必须同时有文字标签或图标辅助。

### Reduced Motion

尊重 `prefers-reduced-motion: reduce`，见 §6 Motion Rules。

### Text Selection

- 内容区域（日记、错题）启用 `user-select: text`
- UI 控件保持 `user-select: none`

---

## 9. UI Usage Rules

### Do

- ✓ accent 色用于主 CTA 和焦点状态，保持克制
- ✓ 暖灰白画布（`#F6F7F4`）代替纯白
- ✓ 卡片和表面保持低噪音
- ✓ danger 色仅用于真实风险状态（删除、不可逆操作）
- ✓ success 色仅用于真实正向结果（保存成功、完成复习）
- ✓ 使用 Lucide 图标，`currentColor` 绑定

### Don't

- ✗ 重新引入工具蓝 (generic tool blue)
- ✗ 使用 alert red 作为默认风险色（用 `--danger` 陶红）
- ✗ 添加装饰性渐变或重阴影
- ✗ 让导航或 badge 压过主决策流
- ✗ 在 UI 文案中使用 emoji
- ✗ 在 Logo 组件外内联重建 SVG
- ✗ 使用 border-left 色条作为卡片状态标记
- ✗ 使用渐变文字效果

---

## 10. Release QA Checklist

Before merge or release, verify:

- [ ] UI Logo 仍来自 `<Logo />`
- [ ] 应用图标 / 安装包图标 / README 图标仍匹配同一符号系统
- [ ] 无新视图回退到工具蓝
- [ ] danger / success 状态仍使用语义品牌色
- [ ] 新按钮、badge、导航状态符合低压力视觉调性
- [ ] 所有新增 CSS 变量已在本文档记录
- [ ] 焦点可见性 (focus-visible) 在新交互元素上生效
- [ ] 暗色模式下新增元素视觉正常
- [ ] `prefers-reduced-motion` 回退已验证
- [ ] 新增图标均使用 Lucide React

---

## 11. Change Policy

If a visual change affects any of the following, update this file in the same PR:

- Logo geometry
- Brand colors (新增/修改任何色值)
- Semantic token names
- Icon export rules
- Font stack
- Spacing / radius / shadow tokens
- Motion tokens
- QA checklist rules
- Accessibility contract

---

## Appendix A: Legacy Token Mapping

| Legacy Token | Semantic Token |
|--------------|----------------|
| `--accent` | `--color-accent` |
| `--bg-primary` | `--color-bg-canvas` |
| `--text-primary` | `--color-text-primary` |
| `--danger` | `--color-state-danger` |
| `--success` | `--color-state-success` |

> Legacy tokens may remain temporarily for backward compatibility.
> All new code **must** use semantic naming.

---

## Appendix B: Tailwind Bridge

Tailwind config (`tailwind.config.js`) 将 CSS 变量桥接为 utility classes：

| Tailwind Class Prefix | CSS Variable |
|-----------------------|-------------|
| `accent` | `--color-accent` |
| `accent-dark` | `--accent-dark` |
| `accent-light` | `--accent-light` |
| `canvas` | `--color-bg-canvas` |
| `text-primary` | `--color-text-primary` |
| `text-secondary` | `--text-secondary` |
| `text-muted` | `--text-muted` |
| `danger` | `--color-state-danger` |
| `success` | `--color-state-success` |
| `warning` | `--warning` |
| `border` | `--border` |
| `border-light` | `--border-light` |

**Architecture rule**: Tailwind 负责布局 utilities，CSS 变量负责语义颜色。禁止在 Tailwind classes 中硬编码色值。
