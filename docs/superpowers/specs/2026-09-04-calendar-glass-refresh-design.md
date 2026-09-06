# Glass Calendar Refresh (Route A) — Design Spec

**Status:** approved (user, 2026-09-04)
**Scope.** Visual refresh of `/calendar`'s month-grid card (and the Calendar/Schedule segmented tabs) in the glass-calendar direction the user approved ("the glassy finish"), keeping every feature. No new page, no new component library, no framer-motion, no date-fns, no lucide.

## Direction

The calendar's month-grid card (currently a WidgetCard carrying the grid) gets the finish of the pasted glass-calendar reference: a bigger, animated month title; ghost chevrons + full-pill Today button; a horizontal snap-scroll day strip with a gradient selection pill; and the paste's tight segmented control for Calendar/Schedule. All of it rendered in the existing token system (`--color-accent-*`, `color-mix`), warm glass, both themes, high-contrast boost, reduced-motion safe. Light mode must read as the same component, not an inverted surprise.

## In scope (exact)

1. **Month header (grid card)** — the month title moves/appears inside the card, large (`text-3xl`→`text-4xl` weight 600, tight tracking), year muted inline after it. Left/right ghost chevrons + a full-pill "Today" button, following the existing `calendar-month-nav` geometry — no layout shift. Title change animates with a 240ms `--ease-settle` settle (opacity + 10px rise), keyed on the month name; disabled under `prefers-reduced-motion`.
2. **Day strip (inside the grid card)** — horizontal snap-scroll strip of day controls (7 visible at a time on desktop; phone scrolls), each day = weekday letter over a circled number. Selection is a soft gradient pill built from `--color-accent-button` faded into a deepened accent via `color-mix` (not the reference's pink/orange). Today keeps its existing filled-circle signature. Strip and grid share one selection model: tapping either selects, `start: top top` not applicable; the strip is supplementary, grid remains primary target.
3. **Day-cell selection state** — the current translucent accent selected box becomes a soft gradient wash (accent → accent-deepened via `color-mix`), white inner ring kept, and the existing today circle unchanged. Event dots keep their size but now reliably carry `colorHex` from the per-calendar coloring (already shipped).
4. **Calendar/Schedule tabs** — the existing `emphasize` prop on SegmentedControl gives the active tab a solid gradient pill; this page just gets the tightened padding/rounded look of the reference. No behavior change.
5. **The rest of the page untouched** — hero card, Today panel, Upcoming panel, Routines panel, forms, member chips, Settings flows, and the (just-shipped) multi-calendar sync behavior all stay as-is.

## Out of scope

Home day strip, Tasks day strip, Weather widget, kid mode, /rewards, any data layer, any PB schema, per-calendar selection UI (already shipped separate).

## Constraints (non-negotiable)

- Token-only colors; no raw palette literals; AA contrast in both themes; the `data-contrast="boost"` variant must keep selection readable.
- CSS-only motion; every new animation/transition listed in the reduced-motion kill block. The existing kill-block keyframe list must still compile (Tailwind v4: no dynamic class string interpolation).
- No new dependencies. Do not edit AGENTS.md/DESIGN.md here — docs pass handled separately.
- Dev server port 3000 is the user's — never restart/kill.

## Acceptance criteria

1. Typecheck clean; `npm run lint` no new errors on touched files; full `npx vitest run tests/unit/` green (report the user's known weather WIP failure separately if present — do not touch it).
2. Playwright probe at 390x844 and 1280x800, dark AND light themes, plus `data-contrast="boost"`: (a) month title animates between months, no layout shift of the grid header row; (b) strip selection pill matches grid selection (same date highlighted both places); (c) Today circle intact; (d) event dots keep correct per-calendar colors; (e) no horizontal overflow at 390; (f) reduced-motion → all new motion instant/static.
3. Contrast measured (not eyeballed): selected-day label on the gradient pill ≥4.5:1 on both themes.
4. `detect.mjs` on changed files: no new findings beyond the documented exemptions.
