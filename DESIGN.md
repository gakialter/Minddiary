# MindDiary Design Contract

Status: C8.3 production direction locked (Parent-selected C8.2 hybrid)

Authoritative base: 60d5c24e90a7573c09537973ca3cc8322821b901

This document is the compact implementation contract for C8 visual and interaction work.
It records the Parent-selected C8.2 visual direction and defines how later C8 work is judged.
It does not authorize product-flow changes, dependency additions, or production implementation outside an explicitly approved C8 stage.

Normative words such as MUST, SHOULD, and MAY describe conformance requirements.
Existing product behavior remains authoritative unless a later approved task explicitly changes it.

## 1. Stable system and direction gate

The stable layer locks roles, relationships, behavior, accessibility thresholds, and product hierarchy.
The direction-sensitive layer selects the visual expression of those rules.

Stable C8 invariants are content-first hierarchy, one obvious primary task, restrained desktop density, semantic roles, accessible sibling themes, complete component/focus/keyboard states, purposeful motion, comprehensible reduced motion, restrained AI identification, limited card use, and preservation of existing workflows.

The C8.2 direction gate is closed. The selected production identity is the controlled hybrid defined below. Implementation-level optical tuning remains permitted only where this contract explicitly allows it and only without changing the selected identity family.

### 1.1 Selected visual direction

- **Base — Direction A, Quiet Study Folio / 静页.** MindDiary uses A's calm, warm, open-canvas identity, restrained shell personality, limited-card surface model, Editor direction, sibling light/dark relationship, and quiet interaction character.
- **Import from Direction B — data discipline only.** Statistics and evidence views use tabular numerals, aligned numeric columns, compact evidence/metric rows, explicit units and periods, disciplined axes/grid/labels, and direct data labels where useful. They MUST NOT inherit B's dark L-frame, dense workbench grid, border-heavy ERP treatment, sub-11 px routine copy, or cyan enterprise identity.
- **Import from Direction C — Daily Review information hierarchy only.** Review content reads as evidence → deterministic understanding → suggestions and candidates → user decision, with selective candidate boundaries, a persistent recovery area, and a strong final confirmation location.
- **No wizard semantics.** A review index, if later implemented, MAY label existing content sections or existing real application states only. It MUST NOT gate sections, require sequential completion, create a stepper state machine or persistence, change task semantics, or imply an event that existing state does not prove.

This direction resolves visual expression only. Existing workflows, state, semantics, data ownership, and Electron boundaries remain authoritative.

## 2. Product design principles

Keep this set small enough to use during implementation and review.

1. **Content before chrome.** Learning material, diary text, review evidence, tasks, and decisions outrank decoration.
2. **One clear primary hierarchy.** The screen's main job and next action must be obvious before secondary tools or metrics.
3. **Structure without dashboardification.** Use alignment, type, spacing, and separators before adding another card.
4. **Intelligence without AI theater.** Identify AI output and uncertainty, but never make AI the brightest layer by default.
5. **Desktop efficiency.** Design for sustained keyboard-and-pointer work, not a mobile layout enlarged to fill a window.
6. **State is visible.** Selection, focus, hover, press, disabled, loading, validation, and recovery are deliberate and distinguishable.
7. **Motion explains change.** Motion may connect, confirm, explain, or soften a change; otherwise omit it.
8. **Light and dark are sibling designs.** Both themes express the same hierarchy through separately validated values.

MindDiary should feel calm, focused, thoughtful, structured, modern, polished, trustworthy, and visually quiet without becoming inert.

## 3. Semantic color system

The taxonomy below is a **LOCKED C8 INVARIANT**.
The warm Quiet Study Folio palette family and its identity anchors are **SELECTED AT C8.2**. Small optical or contrast adjustments are allowed only to preserve hierarchy and the contrast contract; a material hue-family change requires Parent approval.

Product screens MUST express system-level color decisions through semantic roles.
Raw families such as gray-500, slate-300, green-200, or blue-600 MUST NOT define product meaning at call sites.

### 3.1 Core role families

| Family | Required roles | Contract |
| --- | --- | --- |
| Canvas | --color-canvas | Application background and space outside working surfaces |
| Surface | --color-surface-base, -subtle, -raised, -interactive, -selected | Primary work, quiet grouping, true elevation, real interaction, and current selection |
| Text | --color-text-primary, -secondary, -muted, -disabled, -inverse | Main content through unavailable content and verified text on strong backgrounds |
| Border | --color-border-subtle, -default, -strong, -interactive | Quiet separation through deliberate or interactive emphasis |
| Focus | --color-focus-ring | Consistent keyboard focus indicator |
| Accent | --color-accent, -hover, -pressed, -subtle, --color-on-accent | Primary action/current emphasis and its complete state pairings |

Do not add surface levels merely to make adjacent sections different.
Canvas, base, subtle, and raised MUST remain visibly ordered in both themes.
Muted is a hierarchy role, not permission for low contrast; placeholder is separate from labels and entered values.
Borders MUST not carry state meaning alone, and accent does not mean every clickable element.
Each on-accent pairing MUST be validated independently in light and dark themes.

### 3.2 Semantic states

Each state family MUST expose foreground and subtle-background roles; add a border role only where the state needs a visible boundary:

| State | Foreground | Subtle background | Border when needed |
| --- | --- | --- | --- |
| Success | --color-success-fg | --color-success-bg-subtle | --color-success-border |
| Warning | --color-warning-fg | --color-warning-bg-subtle | --color-warning-border |
| Danger | --color-danger-fg | --color-danger-bg-subtle | --color-danger-border |
| Info | --color-info-fg | --color-info-bg-subtle | --color-info-border |

State foreground is for status copy and icons, not arbitrary decorative color.
Danger is reserved for errors, destructive actions, and serious risk.
Warning describes attention or uncertainty without implying failure.
Success is used for confirmed outcomes, not generic positive decoration.

### 3.3 Controls, overlays, data, and AI

The shared system also provides:

- --color-control-disabled-bg, --color-control-disabled-fg, and --color-control-disabled-border;
- --color-control-selected-bg, --color-control-selected-fg, and --color-control-selected-border;
- --color-overlay-backdrop for modal background separation;
- --color-chart-grid, --color-chart-axis, and --color-chart-highlight;
- a restrained --color-data-series-1 through --color-data-series-5 set only where multiple series require it.

Data series MUST have stable legend labels within a visualization.
Series order alone MUST NOT imply success, danger, or priority.

AI normally reuses base surfaces, text, borders, accent-subtle, and status roles.
An optional --color-ai-identifier MAY support a small provenance label only when the general accent cannot do so clearly.
There is no rainbow AI palette.

### 3.4 Use and migration rules

- Theme files map semantic roles to values; feature screens consume roles.
- Short-term aliases from current variables MAY support migration, but the semantic role is authoritative.
- color-mix MAY derive a state only from semantic inputs and only when contrast is still verified.
- Raw colors are acceptable only inside semantic token definitions or isolated content/illustration assets; page geometry is not an exception.
- Repeated raw decisions MUST migrate into a token or shared primitive.

### 3.5 Selected identity anchors

| Theme | Canvas | Base | Accent | Primary text |
| --- | --- | --- | --- | --- |
| Light | #F4F0E8 | #FCFAF5 | #28654F | #20251F |
| Dark | #171A17 | #1E221E | #78B997 | #F1F1EA |

Supporting surface, border, text, state, and chart values are independently tuned siblings around these anchors. The palette MUST NOT drift to Direction B cyan/blue, Direction C terracotta/coral, a purple AI identity, or a generic slate SaaS palette.

## 4. Contrast contract

Contrast is a **LOCKED C8 INVARIANT** and is verified in both themes.

- Normal body and interface text targets WCAG AA contrast of at least 4.5:1.
- Large text may use the applicable threshold of at least 3:1.
- Important control boundaries, focus indicators, and meaningful graphics target at least 3:1 where WCAG requires it.
- Text on accent, selected, success, warning, danger, and info backgrounds is tested as a separate pairing in each theme and interaction state.
- Muted text remains readable; it is not decorative low-contrast text.
- Disabled text may be reduced but must remain understandable in context.
- Placeholder text is never the only persistent label for an important field.
- Charts provide labels, shape, position, pattern, or a text equivalent in addition to color.
- Focus indication remains visible against both the control and its surrounding surface.

Current failing color values are not design inputs for the future palette.

## 5. Typography

Role structure is a **LOCKED C8 INVARIANT**.
The type personality is **SELECTED AT C8.2**: system sans for UI, body, navigation, forms, and Editor prose; tabular numerals where alignment matters; and monospace only for technical/code/path/keycap purposes. Exact optical metrics MAY be tuned within the role targets during screen migration.

The existing system-font infrastructure remains a valid implementation path.
No font dependency is approved.
An externally loaded font MUST be intentionally used and justified; it is not retained merely because it already loads.
A restrained system-serif accent MAY be used only for the Editor diary title and the Statistics Dashboard primary insight sentence. It is not the ordinary page-title face. If the target Windows system cannot produce a high-quality Chinese serif from available system fonts, those roles use the normal system sans. No font may be added, downloaded, or bundled to preserve the experiment.

| Role | Purpose | Selected working target |
| --- | --- | --- |
| Application/page title | Current workspace identity | 20–24 px, compact line height, strong but not display-like |
| Section title | Major content division | 17–20 px, semibold |
| Subsection title | Nested group or panel heading | 15–17 px, semibold |
| Body | Normal reading and interface copy | 14–16 px, 1.5–1.65 line height |
| Compact body | Dense rows, toolbars, and controls | 13–14 px, 1.4–1.55 line height |
| Label | Persistent form and control label | 12–14 px, medium |
| Metadata | Dates, provenance, counts, secondary facts | 12–13 px, readable muted color |
| Caption | Supplemental explanation with low hierarchy | 11–12 px, never essential at illegible size |
| Numerical/statistical display | High-value measures | 24–32 px, tabular numerals where alignment matters |
| Editor body | Sustained writing and review | 15–17 px, 1.7–1.85 line height |
| Monospace | Code, paths, Markdown syntax, and keycaps only | Slightly smaller optical size if needed |

Headings create hierarchy without consuming excessive vertical space.
Diary and editor prose use a reading face, not monospace merely because Markdown is stored underneath.
Numerical display never outranks the screen's primary decision without a product reason.

Markdown rendering MUST define consistent roles for headings, paragraphs, lists, links, quotes, tables, code, and emphasis.
Markdown colors remain theme-aware and must satisfy the same contrast contract.
Rendered structure and editor syntax must remain semantically equivalent.

## 6. Spacing and rhythm

The 4 px-oriented spacing architecture and semantic relationships are a **LOCKED C8 INVARIANT**.
The selected spacing bias is reading-standard with compact shell/toolbars, a 4 px-oriented scale, and 24–32 px section rhythm. Component-specific optical assignments remain implementation-validated within this architecture.

Use a compact 4 px-oriented scale compatible with the current foundation:

| Step | Migration value | Typical use |
| --- | --- | --- |
| space-1 | 4 px | icon-to-label micro gap, tight inset |
| space-2 | 8 px | inline gap, compact control padding |
| space-3 | 12 px | ordinary control inset, compact stack |
| space-4 | 16 px | normal stack and group padding |
| space-5 | 20 px | dense section or standard modal inset |
| space-6 | 24 px | section separation and comfortable panel inset |
| space-8 | 32 px | page section rhythm |
| space-10 | 40 px | large page gap used sparingly |

Semantic relationships matter more than token count:

- control internal spacing uses space-2 through space-4;
- an inline gap is usually space-1 or space-2;
- a compact stack is usually space-2 or space-3;
- a normal stack is usually space-4;
- a section gap is usually space-6 or space-8;
- a page gap is usually space-8 or space-10;
- modal padding is usually space-5 or space-6.

Repeated spatial relationships MUST come from shared tokens or shared layout primitives.
Arbitrary spacing is allowed only for real layout geometry, optical correction, or an external asset constraint.
Not every pixel value needs a token; every repeated design decision does.

## 7. Density

Density context is a **LOCKED C8 INVARIANT**.
The final density bias is **SELECTED AT C8.2**: reading-standard content with compact navigation, toolbars, metadata, and dense evidence rows. Standard decisions and forms retain a comfortable 36–40 px control anchor.

| Context | Use | Behavior |
| --- | --- | --- |
| Compact | Navigation, toolbars, metadata, dense action rows | Short controls, tight stacks, clear grouping; never compressed labels |
| Standard | Settings, dashboard rows, Daily Review decisions, ordinary forms | Comfortable 36–40 px control anchor and normal section rhythm |
| Reading/focus | Diary editor, long Markdown, evidence review | Wider line height, controlled measure, lower chrome density |

Density comes from control height, vertical gap, line height, grouping, and content width together.
It is not achieved by shrinking fonts.
Different screens MAY use different contexts; a single screen SHOULD avoid more than two density contexts without a clear hierarchy.

## 8. Radius

Radius roles and production anchors are **SELECTED AT C8.2**.

- Controls use the small role at approximately 6 px.
- Decision objects and standard bounded surfaces use the medium role at approximately 8 px.
- Dialogs and genuinely large surfaces use the large role at approximately 12 px.
- Pills are reserved for tags, chips, compact statuses, and capsules whose shape conveys their role.
- Ordinary sections are not rounded by default.

Material changes to the 6 / 8 / 12 relationship require Parent approval.

## 9. Elevation and borders

MindDiary establishes hierarchy in this order:

1. spacing;
2. surface tone;
3. border;
4. shadow.

The hierarchy and open-surface expression are **SELECTED AT C8.2**. Shadows are reserved for true raised/overlapping surfaces and overlays by default; exact shadow opacity MAY receive small theme-specific optical tuning.

| Level | Contract |
| --- | --- |
| Flat | Canvas or base surface, usually no shadow |
| Raised | Popover, actionable floating surface, or a surface that truly overlaps another |
| Overlay/modal | Strongest approved separation, still restrained and bounded |

Static content cards MUST NOT gain hover elevation.
Hover elevation implies real interactivity.
Do not put a shadow on every container or use dramatic floating-card effects.
Borders should separate content without producing a grid of boxes.

## 10. Desktop layout

The Electron window architecture and native/custom titlebar behavior remain unchanged.
The layout contract targets the existing minimum window near 960 × 600, typical window near 1280 × 800, and larger desktop windows.
The selected navigation expression is quiet and content-subordinate. The later C8.4 shell target is approximately 184 px expanded and 60 px collapsed; C8.3 does not implement that migration. Other responsive geometry remains implementation-validated inside the minimum-window contract.

### 10.1 Application shell

- The shell contains titlebar, collapsible sidebar, page header, and one predictable page-level scroll owner; bounded overlays and specialized panes may scroll internally.
- Sidebar destinations and VIEW_CONFIG navigation semantics remain authoritative.
- Collapsing navigation changes presentation, never names, ordering, destinations, or current-state semantics.
- The page header identifies the current workspace and hosts only truly global or page-level actions.
- Persistent utilities must not crowd the primary page heading.

### 10.2 Content frames

- Reading/prose surfaces target a controlled measure rather than full-window width.
- Form and Settings content typically uses a medium frame around 720–880 px.
- Insight and dashboard surfaces may use a wider frame around 1040–1200 px.
- Editor MAY use a specialized full-height content-plus-attachment layout.
- These are implementation-validated working ranges within the selected direction, not a rule that every page shares one width.

### 10.3 Window behavior

At the minimum desktop window, reduce gutters before type, permit compact navigation without hiding destinations, keep the primary task and recovery visible, and reflow a secondary region only when its column becomes unusable; never switch to generic mobile navigation.

At the typical desktop window, keep the primary task, current state, and first supporting evidence in the initial 1280 × 800 viewport where content permits; retain useful two-column relationships and avoid equal-weight card grids.

At larger desktop windows, cap reading/form widths and add deliberate breathing room; data views use extra width only when it improves comparison or scanning.

Responsive behavior is driven by available space and task utility, not by mobile-first stacking.

## 11. Surface philosophy

Not every section belongs inside a card.

| Surface | Use |
| --- | --- |
| Canvas | Shell background and unbounded workspace |
| Section | Ordinary document structure expressed through type and spacing |
| Bordered group | Related controls or evidence needing a shared boundary |
| Card | Discrete object, actionable unit, bounded state, or independently scannable summary |
| Raised surface | Content that overlaps or temporarily sits above its parent |
| Modal | Blocking decision or workflow that makes background interaction invalid |
| Popover | Anchored, non-modal supplemental controls or information |

Prefer sections, alignment, whitespace, and separators for ordinary page structure.
Use a card only when the container itself communicates meaning.
Nested cards require a clear object or state relationship and should be rare.

## 12. Component state contract

Every state below is mandatory when the component can enter it.
State MUST NOT be encoded by color alone.

### 12.1 Buttons

- Default communicates variant: primary, secondary, quiet, or destructive.
- Hover changes only properties that clarify interactivity.
- Pressed gives immediate feedback without moving surrounding layout.
- focus-visible uses the shared focus ring and remains visible over hover/pressed styles.
- Disabled removes activation, uses disabled roles, and preserves label comprehension.
- Loading prevents duplicate activation, exposes busy state, and keeps the action identifiable.
- Destructive styling is reserved for destructive or difficult-to-recover outcomes.
- An icon-only button has a stable accessible name.

Only one primary button normally appears in a local action group.

### 12.2 Inputs

- Every important field has a persistent programmatic and visible label.
- Description/help text is associated with the field when needed.
- Default, useful hover, focus, disabled, readonly, and validation-error states are defined.
- Success state appears only when confirmation helps the task.
- Error state includes text, semantics, and recovery; it is not a red border alone.
- Placeholder gives an example or hint, never the only label.
- Disabled and readonly look distinct because their behavior differs.

### 12.3 Navigation and tabs

- Default, hover, selected/current, focus-visible, and disabled states are defined.
- Current location uses semantics such as aria-current where applicable.
- Selected state uses at least two cues, such as surface plus text weight or indicator.
- Hover never becomes the only way to discover a destination or label.

### 12.4 Cards and rows

- Static surfaces have no pointer cursor, press motion, hover elevation, or control-like focus.
- Selectable surfaces expose selected state and expected selection semantics.
- Actionable surfaces use a real link/button seam or provide an equivalent keyboard action.
- Mixed rows keep row selection separate from nested destructive or secondary controls.

### 12.5 Async states

- Loading explains what is pending and prevents unsafe duplicate actions.
- Empty states explain what is absent and offer a relevant next step when one exists.
- Errors remain near the affected work and expose retry or recovery.
- Success confirmation is proportional to the action and does not interrupt routine flow.
- Stale, partial, replayed, uncertain, and recovery states remain explicit where the product already models them.

## 13. Focus and keyboard

Keyboard and focus parity are a **LOCKED C8 INVARIANT**.

- Every interactive element has a stable accessible name.
- Icon-only controls use aria-label or equivalent visible association.
- Tooltip text supplements an accessible name; it never substitutes for one.
- True actions use buttons and navigation uses links/buttons, not clickable generic elements.
- Expected Enter and Space activation works without requiring pointer events.
- Focus-visible appearance is consistent, high contrast, and never intentionally removed without an equivalent.
- DOM order follows reading and task order.
- Focus does not jump because content updates unless the workflow intentionally moves it and announces why.

Collapsed Sidebar requirements:

- every destination retains the same accessible name as in expanded mode;
- the visual tooltip may provide sighted context on hover and focus;
- current destination remains explicit through aria-current or the appropriate equivalent;
- the collapse control itself has an accurate state-dependent name and expanded state.

Editor formatting requirements:

- formatting controls preserve or restore the textarea selection;
- pointer handling MAY snapshot selection without stealing textarea focus;
- activation MUST also work through normal keyboard button behavior;
- mouse-down-only activation is non-conforming;
- applying formatting returns focus and a meaningful selection/caret to the editor.

## 14. Dialogs and overlays

The Today Action dialog is the positive internal reference for focus lifecycle, not a source of business code to extract.

Every true modal dialog normally provides:

- role=dialog and aria-modal=true;
- an accessible title through aria-labelledby or an equivalent name;
- intentional initial focus on the safest useful control;
- contained Tab and Shift+Tab navigation;
- Escape close when closing is safe;
- focus restoration to the invoking control;
- background interaction and document scrolling management;
- deterministic layer tokens and a consistent backdrop;
- a desktop-constrained width and height;
- internal scrolling instead of viewport overflow;
- visible pending states when close is temporarily unsafe.

Overlay type is determined by interaction, not appearance:

| Type | Interaction contract |
| --- | --- |
| Modal dialog | Blocks background, traps focus, restores focus on close |
| Popover | Anchored supplement, non-modal, dismisses on Escape/outside interaction as appropriate |
| Menu | Anchored action list with menu keyboard navigation and trigger focus restoration |
| Tooltip | Non-interactive supplemental label/help, available on hover and focus |
| Toast | Non-blocking live status, never a modal and never a focus trap |

Popover transform origin, placement, and dismissal follow the trigger relationship.
Tooltip content must not contain required actions.
Do not treat every overlay as a modal.

## 15. Status and toast feedback

- Use inline status for field validation, local async progress, and outcomes that affect nearby work.
- Use toast for brief, non-blocking confirmation or low-risk information.
- Use a persistent error/recovery panel for critical, uncertain, partial, or user-actionable failures.
- Critical errors MUST NOT exist only in an auto-disappearing toast.
- Toasts are exposed through an appropriate polite or assertive live region.
- Toast motion is restrained; routine save and sync feedback has no 3D rotation, overshoot, or celebration.
- A toast that cannot be understood before timeout is persistent or explicitly dismissible.

## 16. Icons

Lucide is the current and approved icon foundation.
No second icon library is approved by the C8.2 direction gate.

- Use a compact family around 14 px for inline metadata, 16 px for controls, 20 px for navigation/section identity, and 24 px for rare high-emphasis use.
- Exact optical sizing and stroke weight remain implementation-validated, but siblings remain consistent.
- Icons inherit semantic currentColor unless the icon itself communicates a validated state.
- Icon plus label uses a shared inline gap and the label carries primary meaning.
- Decorative icons are hidden from assistive technology.
- Icon-only buttons meet naming, focus, target-size, and tooltip rules.
- Do not add sparkle icons to generic AI content or decorate text already clear without an icon.

## 17. Light and dark themes

The semantic role graph is shared; its light and dark values are independently designed.
The warm Quiet Study Folio family and the identity anchors in section 3.5 are **SELECTED AT C8.2**.

Each theme MUST define:

- canvas-to-base-to-raised surface hierarchy;
- primary, secondary, muted, disabled, and inverse text;
- subtle, default, strong, interactive, and focus borders;
- selected and disabled controls;
- success, warning, danger, and info families;
- accent, hover, pressed, subtle, and on-accent;
- overlay backdrop and modal separation;
- chart grid, axes, series, and highlights.

Dark mode is not an inversion of light mode.
Avoid pure black canvas and pure white text everywhere unless a specific contrast need warrants them.
Dark surfaces need enough tonal separation to show hierarchy without excessive borders.
Light surfaces need enough contrast that hierarchy does not depend on shadow.
Both themes are checked in default, hover, pressed, focus, selected, disabled, and validation states.

Desired startup outcome: when a theme preference is known, normal startup has no perceptible incorrect-theme flash.
Theme persistence and prepaint implementation remain outside the visual-direction contract unless a later C8 stage explicitly authorizes them.

## 18. Motion vocabulary

Purpose and frequency categories are a **LOCKED C8 INVARIANT**.
The quiet, quick, low-amplitude motion personality and the role ranges below are **SELECTED AT C8.2**.

| Category | Examples | Contract | Selected range |
| --- | --- | --- | --- |
| Instant/high-frequency | Keyboard navigation, focus, press, hover | Immediate or nearly immediate; no spatial delay | about 70 ms |
| Selection/current | Current navigation, tab indicator, small selection changes | Short, interruptible, and restrained | 120–140 ms |
| Standard UI transition | Popover and compact disclosure | Short, interruptible, and restrained | about 160 ms |
| Context transition | Dialog appearance, meaningful expansion, low-frequency state change | May explain context with small opacity/transform change | 190–210 ms |
| Status/toast | Brief non-blocking confirmation | Restrained opacity or very small translation | 160–180 ms |

The selected standard easing is `cubic-bezier(0.2, 0.8, 0.2, 1)`. Low-frequency settling may use `cubic-bezier(0.16, 1, 0.3, 1)`. Neither curve overshoots; usage remains role-based rather than universal.

Every animation has a named purpose: spatial continuity, state feedback, explanation, or softening a disruptive change.
Frequency reduces motion allowance; keyboard-initiated high-frequency actions are immediate.
Animation never delays input or blocks interaction.

CSS is the default implementation path.
No motion dependency is approved.
Transitions specify only intended properties, such as opacity, transform, background-color, color, border-color, or box-shadow.
Avoid transition: all, whole-page blur, large overshoot, repeated scale effects, parallax, and decorative layout movement.
Routine page navigation must not replay elaborate translate/scale/blur choreography.
Hover motion is not required; hover state clarity is.

## 19. Reduced motion

Reduced motion preserves comprehension rather than applying a blanket 0.01 ms override.

Remove or reduce:

- large translation, scale, blur, parallax, and layout movement;
- overshoot, spring, decorative sequencing, and repeated entrance motion;
- spatial page, chart, and overlay choreography.

Preserve when useful:

- immediate color and border changes;
- focus-ring and selected-state clarity;
- progress indication that does not depend on spatial travel;
- short opacity feedback when it is non-disorienting.

The reduced-motion version MUST still communicate loading, selection, focus, success, error, and completion.

## 20. AI content treatment

AI is a source and recommendation state, not a separate visual universe.
The AI role is **SELECTED AT C8.2**: a small semantic provenance identifier using ordinary product typography and existing accent/text/border/state roles. It does not receive a separate hue family by default.

- Identify AI provenance in text or a restrained label.
- Distinguish suggestion from confirmed action.
- Show confidence or uncertainty only where the existing product exposes it.
- Keep local evidence, deterministic summaries, and user decisions visually primary.
- Use ordinary surfaces plus limited accent/state roles.
- Preserve current provenance, candidate validation, confirmation, stale-context, replay, uncertain-result, and recovery semantics.
- Preserve the existing privacy projection and Electron-owned provider networking/secrets.
- Model output remains untrusted candidate data; local validation and explicit user confirmation precede any state change.
- Never imply that generated content is a recorded fact.

Avoid giant gradient surfaces, neon, rainbow borders, repeated sparkle language, and special AI-only typography.

## 21. Anchor screen patterns

These patterns govern hierarchy while preserving existing behavior.

### 21.1 Today Action / HomeDashboard

Primary job: decide and execute what matters now.

Hierarchy:

1. what matters now;
2. recommended next action and one primary CTA;
3. current learning/task state;
4. supporting evidence and details.

Do not repeat the same measures in multiple equal-weight cards.
Task rows remain operational, with edit/complete/skip/delete states clearly separated.
AI planning remains an optional secondary action with provenance and confirmation.
The Today Action screen is not merged with the statistics Dashboard.
No Today Action deterministic next-action priority, master-state threshold, planning, idempotency, task-source, focus-session, or recovery semantics change.

### 21.2 Statistics Dashboard

Primary job: insight and trend scanning, not generic KPI decoration.

- Lead with the most useful current insight and its time context.
- Use supporting metrics to explain the insight, not four identical headline cards by default.
- Give the main trend visualization more visual weight than decorative totals.
- State time range, units, and comparison baseline.
- At 1280 × 800, the primary insight and main trend should be scannable without hunting.
- At narrow desktop width, preserve insight order; reflow secondary metrics before degrading the main chart.
- Empty data explains what is missing and what activity will populate it.
- Chart marks have labels or an accessible equivalent; pointer hover is not the only detail path.
- Native title text alone is not the final contract for important chart data.

No chart dependency is approved by the C8.2 direction gate.

### 21.3 Daily Review

Primary job: review evidence → understand suggestions → make decisions.

Progressive hierarchy:

1. local evidence and date/context;
2. deterministic summary;
3. AI request provenance and suggestions;
4. validated editable candidates;
5. explicit confirmation and per-candidate outcomes;
6. retry, stale, partial, uncertain, and recovery handling.

This selected hierarchy imports Direction C's reading orientation only. All sections remain concurrently reachable. Any visible review index is descriptive, never a wizard: it MUST NOT gate sections, require sequence completion, create a stepper state machine or persistence, alter task semantics, or imply an unproven event. Recovery remains persistent near the decision area, and the existing final confirmation remains the single strong action location.

Local evidence, AI interpretation, and confirmed outcomes must look distinct without using separate visual universes.
The dialog eventually conforms to the global focus and overlay contract.
Existing local-evidence, provider projection, candidate validation, planning history, confirmation, replay, and recovery behavior remains authoritative.
The UI never implies automatic retry or confirmed creation while a result is uncertain.
Do not redesign the planning workflow.

### 21.4 Editor

Primary job: sustained writing.

Hierarchy:

1. writing content;
2. title and date/context;
3. essential formatting and save state;
4. metadata such as tags and word count;
5. templates, share, and other secondary utilities;
6. AI assistance.

The later Editor migration targets approximately 680–704 px of prose measure with reading/focus rhythm. C8.3 provides the foundation only and does not migrate the Editor.
Toolbar groups use separators and hierarchy so formatting, templates, status, share, and AI do not compete equally.
Saving state is visible but quiet; failure remains recoverable near the editor.
AI summary is identifiable and subordinate to the diary text.
The ImageGallery relationship may be visually refined while retaining the content-plus-attachment contract.

Autosave, manual save, Markdown syntax/rendering, tag data, attachments, pending inserts, dirty-state navigation behavior, and AI summary semantics remain unchanged.

### 21.5 Settings

Primary job: understand and deliberately change durable preferences.

- Use clear section headings, persistent labels, descriptions, and stable form grouping.
- Prefer one readable vertical flow or meaningful columns over a grid of equal cards.
- Do not wrap each setting in a separate card.
- Keep label/control/help/error relationships programmatic and visible.
- Save, reset, loading, and dirty outcomes are clear and consistent.
- Risky, credential-clearing, import/restore, update-install, or destructive actions are distinguishable without making the whole page alarming.
- Long paths, provider/model lists, and backup status remain usable at minimum desktop width.

Settings persistence, validation, security, backup/restore, updater, and provider behavior remain unchanged.

## 22. Data visualization

- Use semantic data roles that work in light and dark themes.
- Keep grids and axes quieter than the data while retaining required contrast.
- Use color plus labels, position, shape, pattern, or direct annotation.
- Provide a readable text/table summary for important non-text insight.
- Interactive marks are keyboard reachable and expose the same information as pointer interaction.
- State units, date ranges, and zero baselines honestly; distinguish a measured zero from missing/no data.
- Empty and error states occupy the chart's hierarchy rather than leaving an unexplained blank.
- Reduce visual noise before adding animation or more series.

MindDiary is not an analytics platform; add only the visualization needed for the learning decision.

## 23. Do / Don't

### Do

- Put content hierarchy and the primary task first.
- Use semantic roles for system decisions.
- Provide keyboard, focus, and pointer parity.
- Implement complete, consistent component states.
- Choose density deliberately for the task.
- Verify light and dark themes separately.
- Use motion only for a named purpose.
- Use explicit, documented exceptions for genuinely specialized layouts.
- Keep AI provenance and user confirmation visible.
- Preserve existing business hooks, context, state machines, and data contracts.

### Don't

- No blanket glassmorphism or excessive blur.
- No giant gradients across routine product surfaces.
- No decorative animation everywhere.
- No random rounded cards or a card around every section.
- No excessive shadows or huge radii everywhere.
- No low-contrast minimalism.
- No mobile UI stretched onto desktop.
- No hover-only discoverability.
- No generic AI sparkle language.
- No transition: all.
- No raw color utilities for system-level semantic decisions.
- No visual redesign coupled to a business refactor.
- No static surface that pretends to be clickable.
- No dark theme produced by simple inversion.
- No new UI, font, motion, chart, or icon dependency without Parent approval.

## 24. Engineering guidance

- Evolve the current React, Tailwind, and CSS custom-property infrastructure first.
- Keep the shared styling interface small and deep: semantic tokens, repeated layout relationships, and complete state contracts.
- Centralize repeated semantic decisions enough to produce leverage and locality across screens.
- Do not build an over-abstracted design-system framework or speculative component layer.
- Page-specific geometry may remain local when it is truly specific to that page.
- Repeated interaction and state styling should migrate toward shared primitives.
- Existing hooks, contexts, state machines, IPC contracts, and business workflows remain authoritative.
- No dependency is added without Parent approval.

This guidance is not an implementation schedule for later C8 stages.

## 25. Decision status

| Decision | Status | Reason / Next Gate |
| --- | --- | --- |
| Content-first hierarchy and eight principles | LOCKED C8 INVARIANT | Governs every direction |
| Semantic token taxonomy and role relationships | LOCKED C8 INVARIANT | Shared implementation contract |
| Accessible contrast thresholds in both themes | LOCKED C8 INVARIANT | Objective acceptance requirement |
| Typography roles and readable editor/Markdown behavior | LOCKED C8 INVARIANT | Functional content hierarchy |
| 4 px rhythm, density contexts, surface/radius/elevation roles, and card-use rules | LOCKED C8 INVARIANT | Coherence without freezing the skin |
| Complete component, async, focus, and keyboard states | LOCKED C8 INVARIANT | Interaction correctness |
| Dialog lifecycle and overlay distinctions | LOCKED C8 INVARIANT | Accessibility and behavior |
| Light/dark semantic parity and no-wrong-theme-flash outcome | LOCKED C8 INVARIANT | Theme behavior and acceptance |
| Purpose/frequency motion vocabulary | LOCKED C8 INVARIANT | Prevents decorative or delaying motion |
| Reduced-motion comprehension | LOCKED C8 INVARIANT | Accessibility requirement |
| AI provenance and suggestion/confirmation distinction | LOCKED C8 INVARIANT | Trust and product hierarchy |
| Controlled hybrid: A identity + B data discipline + C Daily Review hierarchy | SELECTED AT C8.2 | Production visual direction; imports are narrowly bounded by section 1.1 |
| Palette family, identity anchors, and warm surface temperature | SELECTED AT C8.2 | Quiet Study Folio values in section 3.5; only small optical tuning allowed |
| System-sans typography personality and role metrics | SELECTED AT C8.2 | Exact optical metrics remain implementation-validated within the selected roles |
| Serif accent scope | SELECTED AT C8.2 | Editor diary title and Statistics primary insight only; no dependency |
| Whitespace and density bias | SELECTED AT C8.2 | Reading-standard content, compact shell/toolbars, 24–32 px section rhythm |
| Radius, border, surface, and shadow expression | SELECTED AT C8.2 | 6 / 8 / 12 px roles; open canvas; overlays receive shadow by default |
| Navigation visual emphasis | SELECTED AT C8.2 | Quiet rail; later target approximately 184 px expanded / 60 px collapsed |
| Motion durations, easing, and personality | SELECTED AT C8.2 | Quick, low-amplitude role ranges in section 18 |
| React, Tailwind, and CSS custom-property foundation | EXISTING STRUCTURE TO PRESERVE | Evolve current infrastructure first |
| Lucide icon foundation | EXISTING STRUCTURE TO PRESERVE | Current approved icon system |
| VIEW_CONFIG destinations and navigation semantics | EXISTING STRUCTURE TO PRESERVE | Product structure, not visual scope |
| Today Action and statistics Dashboard separation | EXISTING STRUCTURE TO PRESERVE | Distinct action and insight jobs |
| Today Action planning/task semantics | EXISTING STRUCTURE TO PRESERVE | No business-flow change |
| Daily Review evidence/candidate/confirmation/recovery flow | EXISTING STRUCTURE TO PRESERVE | No planning-flow change |
| Editor save, Markdown, tag, attachment, and AI-summary semantics | EXISTING STRUCTURE TO PRESERVE | No content/data-contract change |
| Settings persistence, backup, updater, and provider behavior | EXISTING STRUCTURE TO PRESERVE | No durable-behavior change |
| New UI, font, icon, motion, or chart library | PARENT APPROVAL REQUIRED | Dependency and system-level decision |
| Business, data, AI, or Electron architecture refactor coupled to visual work | PARENT APPROVAL REQUIRED | Outside C8 visual scope |
