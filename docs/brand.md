# MindDiary Brand System

## 0. Purpose

MindDiary is a low-pressure, long-term learning companion.
Its visual system should feel calm, precise, and trustworthy.

Design principles:
- Less but better
- Low-pressure long-term companionship
- Action first, noise last

---

## 1. Single Source of Truth

### Logo
- UI source: `src/components/Logo.tsx`
- Static source: `public/images/app-icon.svg`

Rules:
- Do not recreate the logo inline in any component
- Do not fork multiple unsynced SVG variants
- App UI must import `<Logo />`
- App icon exports must derive from the static SVG source

### Brand docs
- This file is the only brand guideline entrypoint
- Any new visual rule should be added here before broad rollout

---

## 2. Core Tokens

### Brand colors
- Accent: `#0F766E`
- Canvas background: `#F6F7F4`
- Primary text: `#0F172A`
- Hover / selected light: `#DFF3EC`
- Hover / selected softer: `#ECF7F2`
- Danger: `#C65A3A`
- Success: `#2F8F6B`

### Token policy
Prefer semantic tokens over raw hex in components.

Recommended aliases:
- `--color-accent`
- `--color-bg-canvas`
- `--color-text-primary`
- `--color-state-danger`
- `--color-state-success`

Legacy tokens may remain temporarily, but all new code should prefer semantic naming.

---

## 3. Logo Rules

The logo should represent a quiet center of focus.

Rules:
- No text inside icon bounds
- No glow, chrome, or decorative rim
- Symbol should occupy ~62%–70% of icon frame
- Background should stay subtle and low-contrast
- Small-size readability must hold at 16 / 32 / 48 px

Default implementation requirements:
- Use `<Logo />` in product UI
- Preserve geometry and stroke proportions
- Accessibility: provide `title` when logo is meaningful content

---

## 4. UI Usage Rules

### Do
- Use accent color sparingly
- Use warm neutral canvas instead of pure white
- Keep cards and surfaces low-noise
- Reserve danger color for actual risk states
- Reserve success color for real positive outcomes

### Don’t
- Do not reintroduce generic tool blue
- Do not use alert red as a default risk color
- Do not add decorative gradients or heavy shadows casually
- Do not let navigation or badges overpower the main decision flow

---

## 5. Component Contract

### `<Logo />`
Supported props:
- `size`
- `color`
- `className`
- `title`

Requirements:
- Default to `currentColor`
- Scale proportionally
- Keep markup minimal and reusable
- Do not hardcode page-specific variants inside the component

---

## 6. Release QA Checklist

Before merge or release, verify:

- [ ] UI logo still comes from `<Logo />`
- [ ] App icon / installer icon / README icon still match the same symbol system
- [ ] No new views regress to generic tool blue
- [ ] Danger and success states still use semantic brand colors
- [ ] New buttons, badges, and navigation states still fit the low-pressure visual tone

---

## 7. Change Policy

If a visual change affects any of the following, update this file in the same PR:
- Logo geometry
- Brand colors
- Semantic token names
- Icon export rules
- QA checklist rules

---

## Appendix: Legacy Token Mapping

| Legacy token      | New semantic token     |
|-------------------|------------------------|
| `--accent`        | `--color-accent`       |
| `--bg-primary`    | `--color-bg-canvas`    |
| `--text-primary`  | `--color-text-primary` |
