# Responsive Window Adaptation — Design

**Date:** 2026-08-06
**Status:** Approved (sections 1–3 reviewed by user; section 4 is process)
**Applies to:** Home-ai dashboard (`/Users/garciafam/Documents/Dashboard/Home-ai`)

## Goal

Make the dashboard adapt to the browser window size instead of rendering like a phone app on large monitors. Today the shell caps at 768px on desktop, the Home bento jumps 1→3 columns at 1024px with no intermediate tier, and content sits in a narrow centered column on big windows.

## Decisions (user-approved)

1. **Full desktop adaptation** — the shell scales with the window; no max-width cap.
2. **Keep the bottom nav bar** on desktop (no side rail / top bar).
3. **No width cap** — content fills the window at any size.
4. **Home gets a 2-column tablet tier** (768–1023px) between the phone 1-col stack and the 3-col bento (1024px+).
5. Per-page desktop columns for Tasks, Calendar, Settings, Kitchen, Chat; minor pages inherit the wider shell only.

## Section 1 — Global shell & navigation

- `src/components/ui/PageShell.tsx` (currently `max-w-lg md:max-w-3xl`): → `max-w-lg sm:max-w-full`. No width cap from 640px up. Keep `min-h-screen`, `relative`, `overflow-hidden`.
- Padding: page-level `px-4` moves to shell-level `px-4 sm:px-6 lg:px-8`. Pages that add their own `px-4` on top of the shell must drop theirs where it duplicates (check each page during implementation — e.g. `page.tsx:224`, `calendar/page.tsx:569`, `tasks/page.tsx:1015`, `settings/page.tsx:448`, `more/page.tsx:12`, `suggestions/page.tsx:162`, `emergency/page.tsx:110`).
- Chat (`chat/page.tsx:336`): own root `max-w-lg mx-auto` → `max-w-lg sm:max-w-full` with matching responsive padding. Message bubbles keep `max-w-[75%]` (readability at 4K). Chat renders its own BottomNav — it inherits Section 1 nav changes automatically.
- BottomNav (`src/components/ui/BottomNav.tsx:131`): inner wrapper `max-w-lg` → `max-w-lg sm:max-w-xl lg:max-w-2xl`. Buttons untouched.
- Kitchen sticky bottom bars (e.g. Grocery bulk "Send N to pantry" bar) and any other `max-w-lg`-locked sticky footers: widen the same way (`sm:max-w-full`), keeping `mx-auto pb-safe`.
- Safety net: `body` gets `overflow-x-hidden` in `globals.css` (currently no overflow rule).

## Section 2 — Home bento tiers

- Grid (`src/app/page.tsx:309`): `grid grid-cols-1 lg:grid-cols-3` → `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min`.
- `WIDGET_SPANS` (`src/lib/layout-config.ts:72–80`): add `md:` variants — weather `md:col-span-2` (full row at 2-col), consuelaSuggestions `md:col-span-2` (full row), all others `md:col-span-1`. `lg:` values unchanged (weather 3, suggestions 2).
- "This Week" card (`page.tsx:419`): `lg:col-span-3` → `md:col-span-2 lg:col-span-3`.
- Orientation interplay: **grid columns = pure CSS breakpoints; the orientation bucket (portrait = portrait aspect AND <1024px) only picks which stored widget order applies.** An iPad portrait at 768px keeps its portrait order but renders on the 2-col grid.
- Tablet holes: with 9 widgets at 2 columns, sparse auto-flow can leave one hole per row (e.g. portrait order row 1: briefing + hole before the full-width weather row). Accepted — same tolerance as the existing top-row hole at lg. The critical lg row (Daily Schedule + Tasks + Today's Events side by side) must stay intact.
- No `grid-flow-dense` (unchanged from bento work — dense would pull cards into holes and break pairings).
- Nothing below 768px changes.

## Section 3 — Per-page desktop columns

All pages keep their mobile layout below 768px; only `md:`/`lg:`/`xl:` classes are added or bumped.

- **Tasks** (`tasks/page.tsx`): stat tiles keep `sm:grid-cols-3`; pending/completed `sm:grid-cols-2` grids → `lg:grid-cols-2`-style side-by-side that grows with the window; leaderboard/podium single column until `xl`.
- **Calendar** (`calendar/page.tsx`): single column at every size today → 2-column layout at `lg`: calendar grid left, "next up" / upcoming panels right.
- **Settings** (`settings/page.tsx`): existing `sm:grid-cols-*` grids scale up (`sm:grid-cols-2 lg:grid-cols-3` tiles); member cards list 2-col at `lg`. "Layout & display" card unchanged (orientation segmented control stays).
- **Kitchen** (GroceryTab / PantryTab / RecipesTab / MealsTab): Grocery `xl:grid-cols-[1fr_280px]` → `xl:grid-cols-[1fr_320px] 2xl:grid-cols-[1fr_360px]` (rail grows with window). Recipes `xl:grid-cols-3` stays. MealsTab single column → 2-col at `xl`.
- **Chat**: shell widening only (Section 1); bubbles capped at 75% width.
- **Minor pages** (Suggestions, More, Emergency, Design-system): no column changes — inherit the wider shell. Emergency contact cards already 2-col.

## Section 4 — Verification & docs

- Playwright sweep at 5 widths: **390 / 768 / 1024 / 1440 / 2560** for every main page (`/`, `/tasks`, `/calendar`, `/chat`, `/meals`, `/settings`, `/suggestions`, `/more`, `/emergency`):
  - no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`)
  - Home grid tier: 1 column at 390, 2 at 768, 3 at 1024/1440/2560
  - lg Schedule + Tasks + Today row intact at 1024+
  - no bento ghost cells (0-height grid children)
  - nav pill width grows with window
  - chat bubbles ≤75% width
- Extend the existing temp-dir Playwright scripts (same patterns as `verify_bento_v2.py`, contrast audit untouched — no color changes).
- Orientation/settings/layout round-trip tests rerun (md span additions must not disturb portrait/landscape orders or reset).
- Gates: `npm run typecheck`, `npm run lint` (0 new errors), `npm run build` clean.
- Docs: AGENTS.md snapshot + UI Change Record + Change Log; `scripts/write-version.mjs` regen.

## Out of scope

- Navigation restructure (no side rail / top bar) — user chose to keep the bottom bar.
- Ultra-wide bento densification (4-col at xl) — user chose the 2-col tablet tier only.
- Color/theme/contrast changes.
- Font-size scaling (no clamp()/vw-based type).
