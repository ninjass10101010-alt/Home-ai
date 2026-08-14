# Uniform Widget Sizes — Design

**Date:** 2026-08-14
**Status:** Approved (user selected Approach B: uniform 1×1 everywhere, no stretch)
**Applies to:** Home-ai dashboard (`/Users/garciafam/Documents/Dashboard/Home-ai`)

## Goal

Make the Home widget cards look uniform. Today some widgets are oversized — on tablet portrait the morning briefing, weather, and Consuela's suggestions span the full 2-column row while everything else is half-width, and on desktop the filmstrip mixes 360/420/480/720px widths. The user wants every widget to be the same "1×1" size, with 1×1 widgets sitting next to 1×1 widgets until the row fills.

## Decisions (user-approved)

1. **Every widget is 1×1 on tablet** — no full-width heroes. The 2-column grid pairs widgets two per row.
2. **No stretch** — a lone odd widget (odd total count) stays half-width and leaves an empty half-row. Accepted.
3. **Desktop filmstrip keeps scrolling sideways** but every widget (and the This Week footer) gets the same width: `360px` (the existing 1× size; weather already renders fine at ~358px on phones).
4. **Phone layout unchanged** (single column already uniform).
5. **This Week footer** stays full-width on tablet (`col-span-2`); uniform `360px` on desktop.

## Section 1 — Sizing rules (`src/lib/layout-config.ts`)

- `WIDGET_WIDTHS`: flatten to `w-[360px]` for all nine widget ids (currently weather `w-[720px]`, suggestions `w-[480px]`, currentMeal `w-[420px]`, rest `w-[360px]`).
- `homeFooterSpanClass("desktop")`: `w-[720px]` → `w-[360px]` (matches uniform filmstrip width).
- Delete `TABLET_FULL_WIDTH` and `TABLET_COL_SPANS`. `widgetSpanClass(id, "tablet")` returns `"col-span-1"` for every id.
- Delete `toTabletOrder` (no longer needed — no full-width partition). Its two call sites:
  - `DEFAULT_LAYOUT.tablet` becomes a plain copy of the phone default order.
  - `loadLayoutConfig` v1/v2 migrations: tablet bucket = the migrated source order directly (no partition).
- `homeFooterSpanClass("tablet")` stays `col-span-2`.
- `WIDGET_SPANS` (SSR/pre-mount fallback): remove the hero variants — every widget `col-span-1` (weather drops `md:col-span-2 lg:col-span-3`, suggestions drops `md:col-span-2 lg:col-span-2`) so the pre-mount frame shows uniform 1-col spans and there is no wide-hero flash.

## Section 2 — Rendering

- `src/app/page.tsx`: **no changes** — it consumes `widgetSpanClass` / `homeFooterSpanClass` / `HOME_GRID_FALLBACK` already.
- Tablet render result: `grid grid-cols-2` with all `col-span-1` items — widgets pair up in order, two per row, no holes except the accepted lone-odd-widget half-row. The This Week footer spans both columns.
- Desktop render result: horizontal filmstrip, every column (widgets + footer) exactly 360px wide, uniform gap-6.

## Section 3 — Settings copy

- `src/app/settings/page.tsx`: update the Layout & display Help modal text — remove the description of full-width tablet widgets ("morning briefing, weather, and suggestions stretch across the full row"); describe tablet as a uniform 2-column pairing grid.

## Section 4 — Tests

- `tests/unit/layout-config.test.ts`: update the 23-test contract:
  - tablet spans: every widget `col-span-1` (was 2 for briefing/weather/suggestions)
  - desktop widths: every widget `w-[360px]` (was 360/420/480/720)
  - footer spans: desktop `w-[360px]` (was `w-[720px]`)
  - `toTabletOrder` tests removed (function deleted)
  - migration tests: v1/v2 tablet bucket now equals the source order (no partition)
- Keep coverage of: mode resolution, grid classes, fallback, sanitize, move helpers, v3 exact round-trip.

## Section 5 — Verification & docs

- `npm run test` (vitest), `npm run typecheck`, `npm run lint` (0 new errors), `npm run build` clean.
- Playwright smoke at portrait 390 / tablet ~800 / desktop 1440: no horizontal overflow, uniform filmstrip widths on desktop, uniform pairing on tablet, no ghost cells.
- `AGENTS.md` (mandatory same-session): update "Current Dashboard Snapshot" + UI Change Record describing the uniform sizing.
- Note the existing build quirk: if CSS chunks desync after build, `docker restart consuela-dashboard`.
