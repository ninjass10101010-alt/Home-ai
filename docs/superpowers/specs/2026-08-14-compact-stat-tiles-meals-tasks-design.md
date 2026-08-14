# Compact stat tiles on Meals and Tasks pages

Date: 2026-08-14

## Problem

The Meals and Tasks pages each render a top row of three `StatTile` widgets without the `compact` prop. Non-compact `StatTile` renders `lg:aspect-square lg:justify-center` on desktop, so these tiles appear as large squares — visibly oversized next to the rest of the page content. The Home page's top row (Events / Tasks / Week) uses `compact` tiles that shrink to content height.

## Decision

Add the `compact` prop to the six tiles:

- `src/app/meals/page.tsx:335-337` — Planned / Tonight / Sync
- `src/app/tasks/page.tsx:1017-1019` — Pending / Completed / Earned

The `compact` prop already exists on `StatTile` (default `false`) and changes: padding `p-4`→`p-3`, icon circle `h-9 w-9 text-lg`→`h-8 w-8 text-base`, value `text-2xl`→`text-xl`, label `text-xs`→`text-[11px]`, detail `text-[11px]`→`text-[10px]`, and drops `lg:aspect-square` so tiles hug their content (src/components/patterns/StatTile.tsx:26-33).

## Non-goals

- The grid wrappers stay as-is (`grid gap-3 sm:grid-cols-3` on both pages) — tiles keep stacking on phones. No change to Home.
- No other StatTile consumers change (Tasks page Rewards/Penalties tiles at 1218-1219 remain non-compact; they are not top-of-page).
- No new props, no CSS changes, no tests (existing StatTile behavior is unchanged; this is a per-call-site opt-in already covered by Home usage).

## Verification

- `npm run typecheck` clean.
- `npx eslint` on the two changed files: 0 errors (baseline applies repo-wide).
- Browser: Meals and Tasks top rows render as compact content-height tiles matching Home's Events/Tasks/Week row on tablet/desktop; phone keeps the vertical stack.