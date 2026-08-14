# Fill-the-Space Layout — Design

**Date:** 2026-08-14
**Status:** Approved (user approved: desktop auto-fit grid, cards stretch to row height, lone odd tablet widget fills its row)
**Applies to:** Home-ai dashboard (`/Users/garciafam/Documents/Dashboard/Home-ai`)

## Goal

Follow-up to the uniform 1×1 widget sizes (2026-08-14). Two remaining visual gaps: (1) on desktop landscape the sideways filmstrip wastes the screen — only ~4 uniform 360px cards are visible and the rest sit off-screen; (2) short cards (Ask Consuela) paired with taller cards leave empty space below them, and the lone odd widget on tablet sits half-width in its row with an empty half.

## Decisions (user-approved)

1. **Desktop = auto-fit tiling grid** — the filmstrip is replaced by a grid that fits as many uniform columns as the screen width allows. All widgets visible at once; vertical page scroll instead of horizontal.
2. **Cards stretch to row height** — every card in a row grows to the row's height (grid default stretch + `h-full` plumbing on the cards), so short cards have no empty space below them.
3. **Lone odd tablet widget fills its row** — when the visible widget count is odd, the last widget spans both columns (`col-span-2`).
4. **Phone unchanged** (single column already correct).

## Section 1 — Desktop auto-fit grid (`src/lib/layout-config.ts`)

- `homeGridClass("desktop")`: `"flex gap-6 overflow-x-auto pb-4 pt-6 items-start snap-x snap-proximity"` → `"grid gap-6 auto-rows-min grid-cols-[repeat(auto-fit,minmax(360px,1fr))]"`.
  - Auto-fit: column count = `floor((width + gap) / (360 + gap))`; all columns equal; grid fills the viewport width (3 cols ≈ 469px at 1440px, 6 cols ≈ 420px at 2560px, 2 cols ≈ 496px at 1024px landscape).
  - `pt-6`/`pb-4` no longer needed (no overflow clipping container); protruding icons render into the `gap-6` gutter exactly as they do on tablet.
- `widgetSpanClass(id, "desktop")`: `shrink-0 snap-start w-[360px]` → `""` (auto-fit sizes the columns).
- `homeFooterSpanClass("desktop")`: `"shrink-0 snap-start w-[360px]"` → `"col-span-full"` (This Week is the final full-width row, matching tablet).
- Delete `WIDGET_WIDTHS` (unused after this change).
- `HOME_GRID_FALLBACK`: `"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min"` → `"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-6 auto-rows-min"` so the SSR/pre-mount frame matches the live desktop grid (no flash).
- `WIDGET_SPANS` unchanged (all `col-span-1`).

## Section 2 — Row-height stretch (tablet + desktop)

- CSS grid children already stretch to the row height by default. The remaining gap comes from the card inside each item wrapper keeping its natural height.
- In `src/app/page.tsx`, each widget wrapper `<div className={span}>` gains `h-full`; each widget's outermost card element gains `h-full` (and `flex flex-col` where the card has internal header/body/footer structure so content distributes naturally rather than stretching awkwardly).
- Affected renderers: `WeatherWidget` (custom card — its wrapper is `relative z-10` + inner card), `MorningBriefingSlot`/`MorningBriefingWidget`, `HomeLeaderboardWidget`, `HomeSuggestionsWidget`, `SectionCard` (Today's Events / Tasks / This Week), `ScheduleDisplay`, `CurrentMealWidget`, aiQuickAsk `WidgetCard`. Where a widget already fills its wrapper, no change.
- `WidgetCard`/`SectionCard` are shared patterns — the `h-full` must not break their use on other pages (their parents are auto-height there, so `height: 100%` resolves to natural height; safe). Implementation detail: prefer adding `h-full` classes at the call sites in `page.tsx` rather than baking `height: 100%` into `.widget-card`, to avoid cross-page regressions; add `h-full` inside widget components only where the card root lives in the component.

## Section 3 — Lone odd tablet widget

- New pure helper in `src/lib/layout-config.ts`:

```ts
/** Tablet span for the widget at `index` of `count` visible widgets:
 *  the last widget of an odd count stretches to fill the row. */
export function tabletSpan(index: number, count: number): string {
  return index === count - 1 && count % 2 === 1 ? "col-span-2" : "col-span-1";
}
```

- `widgetSpanClass(id, "tablet")` stays `"col-span-1"` (pure per-id); `src/app/page.tsx` computes the span as: tablet → `tabletSpan(index, widgets.length)` where `index` comes from `widgets.map((id, index) => ...)` (currently `widgets.map((id) => ...)`). Desktop → `""`; phone → `""`.
- `homeFooterSpanClass("tablet")` stays `col-span-2`.

## Section 4 — Settings copy

- `src/app/settings/page.tsx` Layout & display help modal: replace "on desktop the widgets are uniform-width cards in a sideways filmstrip" with "on desktop the widgets tile into a grid that fills the screen".

## Section 5 — Tests

- `tests/unit/layout-config.test.ts`:
  - `homeGridClass("desktop")` asserts: contains `grid-cols-[repeat(auto-fit,minmax(360px,1fr))]`, `auto-rows-min`, `gap-6`; NOT `flex`, `overflow-x-auto`, `snap-x`.
  - `widgetSpanClass('weather', 'desktop')` → `""`; unknown-id desktop fallback → `""`.
  - `homeFooterSpanClass("desktop")` → `"col-span-full"`.
  - New `describe("tabletSpan")`: even count → all `col-span-1`; odd count → last index `col-span-2`, others `col-span-1`; single widget → `col-span-2`.
  - `WIDGET_WIDTHS` import/tests removed.
  - `HOME_GRID_FALLBACK` assertion updated to the auto-fit lg tier.
- Existing tablet `col-span-1` widgetSpanClass tests unchanged.

## Section 6 — Verification & docs

- `npx vitest run`, `npm run typecheck`, `npm run lint` (0 new errors; pre-existing baseline allowed), `npm run build`.
- Browser smoke: 1440px landscape → 3+ uniform columns filling the viewport, no horizontal page scroll, This Week full-width last row; 800px portrait → pairs with equal heights, lone 9th widget full-width; 390px portrait → unchanged single column, no overflow.
- `AGENTS.md` (mandatory same-session): snapshot + `### UI Change Record — 2026-08-14 — Fill-the-space layout: desktop auto-fit grid + row-height stretch` + Change Log entry.
- Known build quirk: if CSS desyncs after build, `docker restart consuela-dashboard`.
