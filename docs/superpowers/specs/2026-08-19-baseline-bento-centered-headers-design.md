# Baseline Bento + Centered Headers — Design

**Date:** 2026-08-19
**Status:** Approved (user approved: bento tiers on a fixed row unit, weather as the only 2×2 hero, briefing + suggestions back to 1×1, cap + "See all" overflow, stacked centered icon + name headers)
**Applies to:** Home-ai dashboard (`/Users/garciafam/Documents/Dashboard/Home-ai`)

## Goal

Follow-up to the uniform 1×1 + fill-the-space layouts (2026-08-14). Three problems remain:

1. **Weather looks stretched.** The grid stretches every card to its row's height (`h-full` + grid stretch), but the weather card's frosted content panel is content-height and top-anchored (`WeatherWidget.tsx:1832`). When its row partner is taller, the leftover space becomes an empty gradient band below the panel. Root cause compounds: `min-height: 220px` floor with no ceiling, backdrop art fills any size, content never redistributes.
2. **Mixed heights don't look uniform.** All widgets are 1×1 width but heights are pure content-driven (suggestions up to 5 rows, schedule unbounded, quick-ask one row) with nothing normalizing them.
3. **Headers are asymmetric.** Every widget's emoji icon protrudes from the top-left corner (`WidgetCard.tsx:21-41`) with the title left-aligned beside it (`pl-14` workaround); the user wants icon + name centered on the widget.

## Decisions (user-approved)

1. **Bento tiers on a fixed row unit** — tablet/desktop rows are a fixed height unit; every cell height is a multiple of it. Different sizes, same baseline grid.
2. **Weather is the only enlarged widget: 2×2 hero** (desktop + tablet). Morning Briefing and Consuela's Suggestions — originally proposed as wide 2×1 — were shrunk back to regular 1×1 per user request ("top of the page widgets smaller"). Everything else is 1×1. This Week stays the full-width footer.
3. **Overflow = cap + "See all"** — data-heavy cards cap their rows and link out (the existing Events/Tasks pattern). No internal scrollbars except the Morning Briefing's expanded state.
4. **Centered stacked headers** — emoji icon centered with the widget name centered below it, on all Home widgets. Weather's protruding icon moves to centered-top inside its card.
5. **Phone unchanged** — single-column stack keeps content-height rows (`auto-rows-min`). In a single column there is no row partner to stretch against, and forced heights on short cards (Quick Ask) would recreate the exact stretch bug on phones. Tiers apply where cards share rows: tablet + desktop.

## Section 1 — Grid + tier map (`src/lib/layout-config.ts`)

- New constant `HOME_ROW_UNIT_PX = 350` (initial value). The live unit is verified once in the browser against the tallest capped 1×1 card (Today's Events: centered header + 3 rows + "+N more" footer, dark + light) and adjusted if needed — it lives in one place so the change is a single literal.
- `homeGridClass(mode)`:
  - desktop: `"grid gap-6 grid-flow-dense auto-rows-[350px] grid-cols-[repeat(auto-fit,minmax(360px,1fr))]"` (was `auto-rows-min`)
  - tablet: `"grid grid-cols-2 gap-6 grid-flow-dense auto-rows-[350px]"` (was `auto-rows-min`)
  - phone: `"grid grid-cols-1 gap-6 auto-rows-min"` (unchanged)
  - Class strings stay fully literal (Tailwind scans source; no template-built classes).
- New tier map + `widgetSpanClass(id, mode)` returns real spans:
  - `weather`: desktop `"col-span-2 row-span-2 max-[743px]:col-span-1 max-[743px]:row-span-1"`; tablet `"col-span-2 row-span-2"`; phone `""`. The `max-[743px]` guard covers the one desktop-mode case where auto-fit yields a single track (narrow landscape viewports < 744px), where a 2-col span would overflow the grid.
  - every other widget: desktop `""`; tablet `"col-span-1"`; phone `""`.
- `tabletSpan(index, count)` becomes tier-aware: `tabletSpanFor(id, index, count)` — the odd-count last widget stretches to `col-span-2` only if its tablet tier is single-column (weather already spans both columns; never double-expand).
- `HOME_GRID_FALLBACK`: lg tier gains `lg:auto-rows-[350px] lg:grid-flow-dense`; md tier gains `md:auto-rows-[350px] md:grid-flow-dense`; base stays `auto-rows-min`. `WIDGET_SPANS` (pre-mount) stays all `col-span-1` — a uniform first frame is safer than pre-mount hero spans.
- Default orders (both hole-free with dense flow; verified by hand-placement):
  - desktop (3 cols @1440): row 1 = briefing · quick-ask · leaderboard; rows 2–3 = weather (c1–2) + suggestions (r2c3) + current-meal (r3c3) via dense fill; row 4 = schedule · tasks · events; footer = This Week `col-span-full`. Order list unchanged from today's desktop default.
  - tablet (2 cols): r1 briefing + quick-ask; r2 leaderboard + suggestions (dense fill around the weather hero); r3–4 weather; r5 current-meal + schedule; r6 tasks + events. Order list unchanged.

## Section 2 — Centered stacked headers (`WidgetCard`, `SectionCard`)

- `WidgetCard`: the `icon` prop no longer renders as an absolute top-left protrusion (`top: -14, left: -14`). It renders **in-flow, top-center**: `flex justify-center pt-4` wrapper holding the halo (kept — radial tone glow, `weatherGlowPulse 7s`, reduced-motion-safe) behind the emoji, with `drop-shadow`. The `pl-14` text workaround disappears from every consumer.
- `SectionCard`: new opt-in `centeredHeader?: boolean` (default `false` — Kitchen/Settings/other pages' SectionCards are untouched; Home widgets opt in). When true, the header renders the icon pulled out of `WidgetCard`'s slot into a centered stack: icon (emoji in a `bg-white/10` circle, matching StatTile's treatment), title centered, description centered, `border-b` divider kept. Compact variant (all Home cards) uses the smaller icon/title sizes.
- `action` prop (Leaderboard/Suggestions "See all →", Briefing badge) becomes `absolute top-3 right-3` inside the header so it doesn't break the centerline.
- Direct `WidgetCard` consumers on Home (ScheduleDisplay, CurrentMealWidget, aiQuickAsk in `page.tsx`): keep passing `icon` (now top-center via WidgetCard) and center their own title rows; drop `pl-14` padding for symmetric `p-4`/`p-5`.
- Stat tiles already render centered (`StatTile.tsx:26` `lg:flex-col lg:items-center`) — no change; the centered headers bring the big cards in line with them.

## Section 3 — Fill mechanics (the stretch fix, all cards)

- `.widget-card` in `globals.css` gains `display: flex; flex-direction: column;`. Safe cross-page: on other pages cards are content-height, so flex-col stacks identically to block flow; the change only matters where a card is height-stretched (Home). This completes the step the 2026-08-14 fill-the-space spec called for but never implemented.
- `SectionCard`: header `shrink-0`; body wrapper `flex-1 min-h-0 flex flex-col`; footer stays last child — with the body expanding, footers ("+N more · See all →") land flush at the cell bottom (`mt-auto` behavior for free).
- Sparse cards center their content in the cell: aiQuickAsk row and CurrentMealWidget content wrapper gain `flex-1 flex items-center justify-center` so a 350px cell reads as intentional calm, not empty space.

## Section 4 — Weather widget (`src/components/ui/WeatherWidget.tsx`)

- Remove the absolute protruding icon layer (`top: -24, left: -24`). The animated condition icon moves to a centered in-flow row at the top of the card (`relative z-30 flex justify-center pt-5`), keeping the 96px size, halo glow, `weatherGlowPulse`, and drop shadow.
- Card shell becomes `flex flex-col` (already `h-full`, keeps `min-height: 220px` as a phone floor).
- The frosted content panel wrapper becomes `flex-1 min-h-0 p-4 pt-3 flex flex-col`; the panel itself becomes `flex-1 flex flex-col justify-between` — location row top, temperature block centered, condition + "More details" bottom. Extra hero height shows scene art + particles through the frost on all sides of the panel; no empty gradient band. The expandable details panel behavior is unchanged.
- Backdrop SVGs already use `preserveAspectRatio="xMidYMid slice"` — they crop gracefully to the 2×2 ratio; no art changes.
- Phone: same structure at content height; centered icon replaces the overhang.

## Section 5 — Row caps (overflow policy)

- `ScheduleDisplay`: cap at 3 rows (`slice(0, 3)`); when more exist, a footer row `+N more · See all →` links to `/calendar` (`widget-accent-text`, matching the Events/Tasks footer style).
- `HomeSuggestionsWidget`: cap 5 → 3 rows; existing "See all →" action unchanged.
- `MorningBriefingWidget`: 1×1 cell; collapsed state fits as-is; the expanded state gains `overflow-y-auto min-h-0` so it scrolls inside its cell instead of blowing out the row.
- Today's Events / Tasks: existing 3-row caps + footers unchanged.

## Section 6 — Settings copy

- `src/app/settings/page.tsx` Layout & display help modal: note that on tablet/desktop the widgets tile into a fixed-height bento with the weather card as a double-size hero.

## Section 7 — Tests (`tests/unit/layout-config.test.ts`)

- `homeGridClass`: desktop/tablet contain `auto-rows-[350px]` + `grid-flow-dense`; phone stays `auto-rows-min` with no dense.
- `widgetSpanClass`: weather desktop = the 2×2 span string (incl. the `max-[743px]` guard), weather tablet = `"col-span-2 row-span-2"`, weather phone = `""`; every other widget desktop `""`, tablet `"col-span-1"`, phone `""`.
- `tabletSpanFor`: odd-count last 1×1 widget stretches to `col-span-2`; weather as last of an odd count keeps `col-span-2 row-span-2` (no double-expand); even counts unchanged.
- `HOME_GRID_FALLBACK` assertion updated (md/lg tiers gain unit rows + dense).

## Section 8 — Verification & docs

- `npx vitest run`, `npm run typecheck`, `npm run lint` (0 new errors; pre-existing baseline allowed), `npm run build`.
- Browser verification (Playwright): 390px portrait (unchanged stack, centered headers, no overflow), 768px portrait tablet (weather 2×2, pairs aligned to the unit, no holes), 1440px desktop (hole-free 3-col bento, weather hero, no stretched/empty bands), dark + light themes, reduced-motion spot check. Measure the tallest 1×1 and adjust `HOME_ROW_UNIT_PX` once if content clips or leaves slack.
- `AGENTS.md` (mandatory same-session): Current Dashboard Snapshot + `### UI Change Record — 2026-08-19 — Baseline bento: fixed row unit, weather hero, centered headers` + Change Log entry.
- Known build quirk: if CSS desyncs after build, `docker restart consuela-dashboard`.

## Trade-offs accepted

- **`grid-flow-dense`** can place a card slightly out of saved-list order on tablet/desktop when the user reorders/hidden-widgets create gaps. Chosen over visible holes; the 2026-08-06 rejection of dense applied to a uniform grid where it broke deliberate row groupings — with intentional spans it is the standard bento answer.
- **Fixed 350px unit** is tuned for the current widget set; a future widget taller than the unit must cap/scroll its content to fit (documented in the tier map comment).
- **Centered header is opt-in** (`centeredHeader`) so non-Home SectionCards are untouched; the app can adopt it globally later if desired.
