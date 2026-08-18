# Calm-Motion Layout & Display — Design

**Date:** 2026-08-18
**Status:** Approved (user approved: single unified list with in-place toggles — no teleport; reorder glide animation; ListRow press/hover motion removed app-wide)
**Applies to:** Home-ai dashboard (`/Users/garciafam/Documents/Dashboard/Home-ai`)

## Goal

Two connected problems on the Settings → "Layout & display" card (and list rows generally):

1. **Toggle click accuracy.** Every `ListRow` carries the global `.tap` class (`hover:scale-[1.02]` lift + `active:scale-[0.97]` press). Pressing anywhere on a row scales the whole row toward its center, shifting the small toggle/arrow targets several px under a stationary cursor. If the mouseup lands outside the toggle's label, the click never registers — the toggles/arrows feel dead or inaccurate. The row also lifts while hovering toward a target.
2. **Toggle teleport.** When a widget is toggled off, its row instantly vanishes from the Visible group and reappears in the Hidden group at the bottom — with no animation the eye can't track the move, so "the next widget looks like the same widget". Reorders (↑/↓, drag) also teleport.

## Decisions (user-approved)

1. **Remove ListRow hover/press motion app-wide** — no hover lift, no press scale on any list row in the app (Settings lists, grocery, pantry, tasks, etc.). Keep the hover background brighten and the `focus-visible` accent ring on interactive rows. All other controls (buttons, chips, nav, toggles themselves) keep the tap language.
2. **Single unified list — toggles flip in place** — one list of all 9 widgets in the saved order; toggling off flips the switch OFF and dims the row (fade ~300ms). The row never moves. Toggle on → row brightens back.
3. **Full-order storage v4** — per mode: `{ widgets: WidgetId[] /* full order, all 9, stable positions */, hidden: WidgetId[] /* subset */ }`. Existing v3 (visible-only list) migrates automatically: order = saved list + missing widgets appended in default order, `hidden` = the missing widgets.
4. **Reorder glide animation** — ↑/↓ and drag reorders animate the rows gliding to their new positions (~260ms FLIP via Web Animations API, no new dependencies).
5. **Toggle knob slide fix** — the knob currently teleports (`transition-transform` doesn't cover the `left` position change). Animate `left` so the switch slides. Toggle `checked` reflects real state (no hardcoded values).
6. **Reduced-motion safe** — all new motion is skipped under `prefers-reduced-motion`.

## Section 1 — ListRow motion removal (`src/components/ui/ListRow.tsx`)

- Class `tap` removed from the row root. The root becomes:
  `group relative flex items-center gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-3 backdrop-blur-xl hover:bg-[var(--color-surface-0)]/45` + (`cursor-pointer` when `onClick`).
- Focus ring kept for interactive rows only: when `onClick` is set, add `focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2 focus-visible:outline-none`.
- `transition-colors` optional for the hover background (color-only transitions are allowed by the planner-motion rules and feel calm).
- No other ListRow behavior changes. AGENTS.md Stream C note: ListRow is now a deliberate exclusion from `.tap` (like Avatar/Badge/Toggle are today).

## Section 2 — Storage v4 (`src/lib/layout-config.ts`)

```ts
export interface OrientationLayout {
  /** Full ordered list of ALL widget ids — stable positions, hidden included. */
  widgets: WidgetId[];
  /** Subset of widgets currently hidden (not rendered on Home). */
  hidden: WidgetId[];
}
```

- `DEFAULT_LAYOUT`: each mode keeps its current default order (all 9 ids) with `hidden: []`.
- `cloneDefaultLayout` mirrors the new shape.
- New helpers:
  - `toggleWidgetVisibility(layout, id): OrientationLayout` — adds/removes `id` in `hidden` (widgets order untouched).
  - `getVisibleWidgets(layout): WidgetDef[]` — order filtered by `hidden`.
  - `getOrderedWidgetDefs(layout): WidgetDef[]` — all ids in order (settings list).
  - `moveWidgetUp/Down/To` — unchanged semantics, operate on the full `widgets` order (so hidden rows are reorderable too).
- `toggleWidget(widgets, id)` (old list-level helper) is removed; `getHiddenWidgets` removed or re-expressed via `hidden`.
- `sanitizeLayout(list)` → now returns an `OrientationLayout`: preserve known ids in order, append missing defaults (keep the existing morningBriefing→0 / consuelaSuggestions→1 insertion rule for appends), `hidden` = valid known ids only. Handles both v4 inputs (accept `{widgets, hidden}`) and legacy visible-only lists.
- `loadLayoutConfig` migration:
  - v1 `{ widgets }` / v2 `{ portrait, landscape }` / v3 `{ phone, tablet, desktop }` (visible-only lists): each mode → order = list + missing ids appended in `DEFAULT_LAYOUT[that mode]` order; `hidden` = missing ids.
  - v4 `{ widgets, hidden }` per mode: round-trip **exactly** (validate ids only; missing `widgets` ids are appended; `hidden` entries not in `widgets` are dropped).
- `saveLayoutConfig` unchanged (plain JSON).

## Section 3 — Hook updates (`src/hooks/useHomeLayout.tsx`)

- `toggleFor(o, id)` → `toggleWidgetVisibility(prev[o], id)`.
- `visibleWidgetsFor(o)` → `getVisibleWidgets(config[o])` (used by Home path + "N on Home" count).
- New `orderedWidgetsFor(o): WidgetDef[]` → `getOrderedWidgetDefs(config[o])` for the settings editor.
- `hiddenWidgetsFor` removed (settings no longer renders a hidden group).
- Live `widgets` (Home render list) = `getVisibleWidgets(config[orientation])` ids; `isVisible(id)` reads `hidden`.
- Rehydrate/debounce/suppress behavior unchanged.

## Section 4 — Settings editor (`src/app/settings/page.tsx`)

- Replace the Visible/Hidden two-group render with ONE `space-y-3` list over `orderedWidgetsFor(editingOrientation)`.
- Each row: `checked={!rowHidden}` real state; `onCheckedChange` → `handleToggle(widget.id)` (no direction guard — `toggleFor` handles both).
- Hidden rows: `opacity-55` (existing token) + `transition-opacity duration-300` for the dim/brighten fade. Toggle and arrows stay interactive on dimmed rows.
- ↑/↓ enabled for every row; disabled only at the ends of the FULL order (index 0 / last).
- Drag: ⋮⋮ handle stays the drag source (previous fix retained); drop target index computed from the full order.
- Keep the "N on Home" header line (count = visible count); keep Reset + Help.
- Remove the "Hidden · N" divider block and the "No visible widgets" EmptyState. If the visible count is 0, render a one-line inline note under the "0 on Home" header: "All widgets are hidden — turn one on to fill the Home dashboard."
- Help modal copy updated: rows stay in place; toggling off dims the row; hidden widgets don't appear on Home; arrows/drag move any row.
- Reorder FLIP animation (Section 5).

## Section 5 — Reorder glide animation (FLIP, Web Animations API)

- In the settings page: before a reorder mutation (arrow or drop), record each row's `getBoundingClientRect().top` keyed by widget id (a `useRef<Map<WidgetId, number>>`).
- After commit, `useLayoutEffect` compares new positions and plays `row.animate([{ transform: `translateY(${oldTop - newTop}px)` }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" })` for rows that moved.
- Runs only when a reorder just happened (flag set by the mutation handler, cleared after the effect). Skipped when `window.matchMedia("(prefers-reduced-motion: reduce)").matches`. No library — the native WAAPI. Row elements are captured via a ref map (or `data-widget-id` + query) on the row wrapper divs.
- The toggle dim/brighten uses pure CSS transition (no FLIP involved).

## Section 6 — Toggle knob slide (`src/components/ui/Toggle.tsx`)

- Knob span: `transition-transform` → `transition-all` (or `transition-[left]`) so the `left-1` ↔ `left-6` change slides over the existing `duration-200`. Track keeps `transition-all` for the color fade.
- No other Toggle changes (the dropped `aria-label`/`aria-checked` passthrough issue is out of scope for this design; note it in the spec only).

## Section 7 — Tests

- `tests/unit/layout-config.test.ts` — rewrite the contract for v4:
  - `toggleWidgetVisibility` toggles `hidden` without touching order; double-toggle round-trips.
  - `getVisibleWidgets` filters hidden, preserves order; `getOrderedWidgetDefs` returns all 9 in order.
  - `moveWidgetUp/Down/To` operate on full order including hidden ids.
  - `sanitizeLayout` keeps valid ids in order, appends missing, drops unknown hidden ids.
  - `loadLayoutConfig`: v4 round-trip exact; v1/v2/v3 migrations produce order = old list + missing appended, `hidden` = missing; corrupted input → defaults.
  - Existing grid/span/tabletSpan tests unchanged (they don't touch visibility).
- Existing test suite: `npx vitest run`, `npm run typecheck`, `npm run lint` (no new errors; pre-existing baseline allowed), `npm run build`.
- Browser smoke (Playwright script against the dev server):
  - Toggle off a widget → row stays at its index, dims (`opacity` drops), knob slides to OFF, "N on Home" decrements.
  - Toggle on → row brightens, count increments.
  - ↑/↓ plain + jittered clicks reorder; rows animate (assert the row's `getAnimations()` is non-empty, or position settles after ~300ms).
  - Drag from ⋮⋮ handle reorders.
  - Reload → order + hidden state persist (localStorage v4).
  - `prefers-reduced-motion: reduce` emulation → no WAAPI animations.
  - A grocery/pantry/tasks ListRow shows no `active:scale`/`hover:scale` computed transform.

## Section 8 — Docs (mandatory same-session)

- `AGENTS.md`: "Current Dashboard Snapshot" update, `### UI Change Record — 2026-08-18 — Calm-motion Layout & display: in-place toggles + glide reorders + ListRow motion removal`, Change Log entry, Stream C note (ListRow exclusion), Settings help-copy journey.
- Known build quirk note: if CSS desyncs after `npm run build`, `docker restart consuela-dashboard`.
