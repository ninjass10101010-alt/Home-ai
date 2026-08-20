# Design: Calendar tab replaces More, Emergency moves to Settings

**Date:** 2026-08-20
**Branch:** warm-glass-v2
**Status:** Approved by user (design), pending implementation plan

## Goal

Restructure primary navigation so the bottom capsule nav's **More** tab becomes a **Calendar** tab, and the Emergency reference tools move into the Settings screen. This restores the pre-2026-06-12 navigation shape where Calendar was a primary tab.

## Decisions (user-confirmed)

1. **Emergency stays a page** — Settings gains a card that links to the existing `/emergency` reference page (contact cards, common situations, 911 button). The page content is untouched.
2. **`/more` redirects** — old bookmarks and any remaining `/more` links (adult-mode weather "Details →") land on `/calendar` via a 301 redirect. No dead links.

## Changes

### 1. CapsuleNav — `src/components/ui/CapsuleNav.tsx`

- Replace the More item (`href: "/more"`, three-dots icon) with a Calendar item (`href: "/calendar"`, calendar-grid SVG icon in the same stroke family: strokeWidth 2, active 2.5).
- Item order stays `[Home, Ask, Meals, Tasks, Settings, Calendar]` — Calendar occupies More's last slot, so dock geometry and `--capsule-scale` behavior are unchanged.
- Active-state detection (`pathname === item.href`) needs no change.

### 2. Redirect — `next.config.ts`

- Add a `redirects()` entry: `/more` → `/calendar` (301 permanent).
- Delete `src/app/more/page.tsx` (its only consumers are the nav and AdultHome).
- Retarget the adult-mode weather "Details →" link in `src/modes/adult/AdultHome.tsx` from `/more` to `/calendar`.
- `MoreMenuItem` / `PageHeader` components remain in the codebase (design-system patterns; no longer used by a page).

### 3. Settings — `src/app/settings/page.tsx`

- New `SectionCard` **"Emergency"** (icon 🛡️, tone `#f43f5e`) placed directly below the existing "Emergency contacts" card:
  - Description: "Call cards, common situations, and 911 reference".
  - A `MoreMenuItem`-style row (or `Link` + `SoftButton`) linking to `/emergency`.
- The `/emergency` page is unchanged (it already has its own "Edit contacts in Settings" quick-link back to the Settings `#emergency` anchor).

### 4. Docs & tests

- `scripts/consuela/test-capsule-nav.mjs`: `LABELS` updated `[..., "More"]` → `[..., "Calendar"]`; assert the nav item navigates to `/calendar`.
- AGENTS.md:
  - §1.1 nav table: replace the More row with Calendar (label, route `/calendar`, calendar icon, notes: "Family routines, events, and month view").
  - §1.1 capsule-nav paragraph: update the route list.
  - §1.5 Common Journeys: "How do I get to the grocery list?" (currently stale — points to More → Grocery; Grocery left More on 2026-08-17) → point to the Meals tab; "Where are Emergency and Settings now?" → Emergency lives in Settings as a card.
  - New UI Change Record + Change Log entry + snapshot update.
- The floating red Emergency shield on Home (`EmergencyButton.tsx`) is untouched.

## Out of scope

- Any change to the `/emergency` page content or the alert flow (`POST /api/emergency`).
- The Emergency contacts *configuration* card already in Settings (it stays where it is; the new card sits beside it).

## Verification

- `npm run typecheck` clean.
- `npx vitest run` — no regressions (baseline 166/167 + 1 pre-existing PB-env failure).
- Playwright:
  - Nav renders 6 items with a Calendar tab; tapping it lands on `/calendar`.
  - `GET /more` returns 301 → `/calendar`.
  - Settings shows the new Emergency card; tapping opens `/emergency`.
  - Capsule geometry unchanged at 390/768/1440 (no overflow).