# Responsive Window Adaptation — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-06-responsive-window-adaptation-design.md` (approved)
**Branch:** `summer-weather-visuals`
**Workflow:** one commit per task below; typecheck after every task; full gates at the end.

## Current state (verified)

| File | Line | Today | Target |
|---|---|---|---|
| `src/components/ui/PageShell.tsx` | 12 | `min-h-screen bg-[var(--color-canvas)] max-w-lg md:max-w-3xl mx-auto relative overflow-hidden` | `max-w-lg sm:max-w-full mx-auto px-4 sm:px-6 lg:px-8` (rest unchanged) |
| `src/app/globals.css` | 291 | `body { background-color; color; font-family; -webkit-font-smoothing; transition }` | add `overflow-x-hidden;` |
| `src/components/ui/BottomNav.tsx` | 131 | `w-full max-w-lg mx-auto pb-safe` | `w-full max-w-lg sm:max-w-xl lg:max-w-2xl mx-auto pb-safe` |
| `src/app/chat/page.tsx` | 336 | `min-h-screen max-w-lg mx-auto flex flex-col relative bg-surface-0` | `min-h-screen max-w-lg sm:max-w-full mx-auto flex flex-col relative bg-surface-0 px-4 sm:px-6 lg:px-8` |
| `src/app/chat/page.tsx` | 410 | messages scroller `flex-1 overflow-y-auto px-4 py-4 space-y-4` | drop `px-4` (root now pads) |
| `src/app/chat/page.tsx` | 618 | input `sticky bottom-0 z-50 px-4 pb-20 pt-2` | drop `px-4` (root now pads); keep inline paddingBottom `7rem` |
| `src/app/page.tsx` | 309 | `grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-min` | `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min` |
| `src/app/page.tsx` | 419 | `lg:col-span-3` (This Week) | `md:col-span-2 lg:col-span-3` |
| `src/app/page.tsx` | 224 | header `relative z-10 px-4 pt-10 pb-6` | `relative z-10 pt-10 pb-6` |
| `src/app/page.tsx` | 302 | `<div className="px-4 space-y-6 relative z-10">` | `<div className="space-y-6 relative z-10">` |
| `src/lib/layout-config.ts` | 71–81 | `WIDGET_SPANS` = `lg:` only | add `md:` variants: weather `md:col-span-2`, consuelaSuggestions `md:col-span-2`, all others `md:col-span-1`; `lg:` values unchanged |
| `src/app/page.tsx` | ~312 | fallback `WIDGET_SPANS[id] ?? "lg:col-span-1"` | `?? "md:col-span-1 lg:col-span-1"` |
| `src/app/tasks/page.tsx` | 1015 | `px-4 space-y-5 pb-8` | `space-y-5 pb-8` |
| `src/app/calendar/page.tsx` | 569 | `px-4 mt-4 space-y-4` | `mt-4` + 2-col tier (below) |
| `src/app/calendar/page.tsx` | 650 | `<div className="space-y-4">` (calendar tab body) | `<div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4 lg:space-y-0">` |
| `src/app/calendar/page.tsx` | 651 | `<Card className="calendar-grid-card !p-0">` | + `lg:row-span-2` (keep `!p-0`) so panels at 706/808 stack in the right column |
| `src/app/settings/page.tsx` | 448 | `px-4 space-y-6 pb-8` | `space-y-6 pb-8` |
| `src/app/settings/page.tsx` | 789 | member cards `grid gap-3 sm:grid-cols-1` | `grid gap-3 sm:grid-cols-1 lg:grid-cols-2` |
| `src/app/more/page.tsx` | 12 | `px-4 space-y-4 pb-8` | `space-y-4 pb-8` |
| `src/app/suggestions/page.tsx` | 162 | `px-4 pb-8 space-y-5` | `pb-8 space-y-5` |
| `src/app/emergency/page.tsx` | 110 | `px-4 space-y-6 mt-4 relative z-10 pb-6` | `space-y-6 mt-4 relative z-10 pb-6` |
| `src/app/meals/page.tsx` | 316 | `px-4 space-y-5 pb-8` | `space-y-5 pb-8` |
| `src/components/meals/GroceryTab.tsx` | 195 | `grid grid-cols-1 gap-5 xl:grid-cols-[1fr_280px]` | `grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px] 2xl:grid-cols-[1fr_360px]` |
| `src/components/meals/GroceryTab.tsx` | 628–631 | mobile bulk bar `xl:hidden sticky bottom-28 z-30` > inner `rounded-2xl ...` | inner: `mx-auto max-w-lg sm:max-w-full` — verify; bar only shows < xl so at sm–lg it must fill the now-full shell |
| `src/components/meals/MealsTab.tsx` | 221 | `lg:grid-cols-[1fr_320px]` | unchanged (already 2-col at lg) — verify readability at 1440/2560 only |
| `src/components/meals/PantryTab.tsx` | 148 | `lg:grid-cols-[1fr_320px]` | unchanged — verify only |
| `src/components/meals/RecipesTab.tsx` | 115 | `sm:grid-cols-2 xl:grid-cols-3` | unchanged |
| `src/app/design-system/page.tsx` | 89 | `px-4 py-8 pb-24` (own main, no shell) | `px-4 sm:px-6 lg:px-8 py-8 pb-24` |
| `src/app/_design-system/page.tsx` | 102 | `px-4 space-y-10` (full-width root at 84) | `px-4 sm:px-6 lg:px-8 space-y-10` |
| `src/app/meals/archive/page.tsx` | 76 | `px-4 sm:px-6 space-y-3` | unchanged (already responsive) |

Deliberately unchanged: Home stat tiles `grid grid-cols-3 gap-3` (page.tsx:302–306), Tasks stat tiles `sm:grid-cols-3` (tasks:1016), Tasks form grids `sm:grid-cols-2` (tasks:1068/1096/1117/1362/1437/1470/1594), Tasks leaderboard/podium (single col until xl), Settings `sm:grid-cols-5` (473) + `sm:grid-cols-2` (495), calendar schedule tab (854 `space-y-4` untouched), Chat bubbles `max-w-[75%]`, chat top bar (340) + input (618) inner margins, BottomNav grid-cols-6 buttons, Kitchen sticky mobile bars' layout logic.

---

## Task 1 — Global shell, nav, safety net

1. `PageShell.tsx:12`: `max-w-lg md:max-w-3xl mx-auto` → `max-w-lg sm:max-w-full mx-auto px-4 sm:px-6 lg:px-8`.
2. `globals.css:291` `body`: add `overflow-x-hidden;`.
3. `BottomNav.tsx:131`: `max-w-lg` → `max-w-lg sm:max-w-xl lg:max-w-2xl`.

**Verify:** typecheck; dev server; at 390/768/1024/1440 px check shell edges touch viewport (except 390), nav pill grows, no horizontal scroll. Commit: `feat(ui): responsive shell — window-filling PageShell + growing nav + overflow safety net`.

## Task 2 — Chat root widening

1. `chat/page.tsx:336`: add `px-4 sm:px-6 lg:px-8` + `max-w-lg sm:max-w-full`.
2. Drop duplicate `px-4` at 410 (scroller) and 618 (input).

**Verify:** bubbles ≤75% width at 1440; input + top bar align with padding; right-aligned user bubbles still flush to content edge (check `ml-auto` alignment unchanged); no horizontal scroll. Commit: `feat(ui): responsive chat — window-wide chat shell, bubbles capped`.

## Task 3 — Home bento tablet tier

1. `page.tsx:309`: add `md:grid-cols-2`.
2. `layout-config.ts:71–81`: add `md:` spans (weather 2, consuelaSuggestions 2, rest 1); lg untouched.
3. `page.tsx:419`: This Week → `md:col-span-2 lg:col-span-3`.
4. `page.tsx:312` fallback → `"md:col-span-1 lg:col-span-1"`.

**Verify:** at 768px grid = 2 columns, weather full row, suggestions full row, no ghost cells (0-height children); at 1024/1440 lg rows intact (Schedule + Tasks + Today one row); 390 unchanged single col. Commit: `feat(ui): Home bento 2-col tablet tier (md)`.

## Task 4 — Page padding dedup

Remove page-level `px-4` where PageShell now provides it: page.tsx:224 + 302, calendar:569, tasks:1015, settings:448, more:12, suggestions:162, emergency:110, meals:316. Bump the two standalone dev pages: design-system:89 and _design-system:102 → `px-4 sm:px-6 lg:px-8`.

**Verify:** every main route at 390/768/1440 — no double-padding visual jump, no horizontal scroll; pages with a PageHeader (tasks/calendar/settings/meals) still full-bleed glass header at top (px-4 was only on content below header — confirm). Commit: `feat(ui): shell-level padding — remove duplicate page px-4`.

## Task 5 — Per-page desktop columns

1. **Calendar:** container 650 → `space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4 lg:space-y-0`; grid Card 651 gains `lg:row-span-2`. Confirm sections at 706 (day events) + 808 (Upcoming) are the only other children; if the DOM differs, wrap 706+808 in a `<div className="lg:space-y-4">` instead.
2. **Settings:** member cards 789 → `lg:grid-cols-2`.
3. **Grocery:** 195 → `xl:grid-cols-[1fr_320px] 2xl:grid-cols-[1fr_360px]`; mobile bulk bar 628–631 inner gets `mx-auto max-w-lg sm:max-w-full`.
4. **Verify-only:** MealsTab/PantryTab rails, Recipes 3-col, Tasks grids, leaderboard at 1440/2560 — screenshots looked at, no code change unless something breaks at 2560.

**Verify:** calendar at 1024+ = month grid left, both panels right (and not stacked under the grid); settings member cards 2-col at lg; grocery rail 320 at 1280, 360 at 1536+; no overflow anywhere. Commit: `feat(ui): desktop columns — calendar 2-col, settings member cards, wider grocery rail`.

## Task 6 — Verification suite (per spec §4)

Extend temp-dir Playwright patterns (`verify_bento_v2.py`) → `verify_responsive_v2.py`:
- widths 390/768/1024/1440/2560 × routes `/`, `/tasks`, `/calendar`, `/chat`, `/meals`, `/settings`, `/suggestions`, `/more`, `/emergency`
- `document.documentElement.scrollWidth <= innerWidth` everywhere
- Home tier: `gridTemplateColumns` count = 1 / 2 / 3 / 3 / 3
- lg Schedule+Tasks+Today same-row check (reuse bento row logic)
- no 0-height grid children (ghost cells)
- nav pill `offsetWidth` grows from 390 → 2560
- chat: every assistant/user bubble `offsetWidth <= 0.76 * viewport`
- rerun orientation/layout round-trips (md spans must not disturb portrait/landscape orders or reset)
- rerun contrast audit (should be 0/50 unchanged — no colors touched)

**Gates:** `npm run typecheck`, `npm run lint` (0 new errors), `npm run build` clean.

**Docs:** AGENTS.md — snapshot line + UI Change Record (responsive window adaptation) + Change Log entry; `scripts/write-version.mjs` regen.

Commit: `feat(ui): responsive window adaptation — verification sweep, docs, version`.
