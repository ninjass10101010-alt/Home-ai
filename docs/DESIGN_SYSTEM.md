# Consuela Warm Glass v2 Design System

**Status:** Living system for the `warm-glass-v2` overhaul  
**Last Updated:** 2026-06-14  
**Scope:** Home, Tasks, Meals, Settings, shared primitives, shared patterns

## 1 · Vision

Warm Glass combines:

- **Glassmorphism** for outer surfaces: translucent, blurred, tinted panels layered over warm gradients.
- **Neumorphism** for controls: raised and pressed tactile controls using a single top-left light source.
- **Apple HIG influence** for typography, spacing, and native-feeling controls.
- **DesignCode + Weather App references** through soft pastel gradients, large display numerals, 1px frosted borders, generous whitespace, and horizontal forecast-style strips.

## 2 · Tokens

### 2.1 Accents

Consuela supports ten accent colors:

- `nori` — default trust blue
- `violet`
- `rose`
- `coral`
- `lavender`
- `cyan`
- `mint`
- `amber`
- `apricot` — family warmth / kids
- `sage` — routine / calm

### 2.2 Surface hierarchy

- Page canvas: `--color-canvas`
- Glass surfaces: `--color-surface-0` through `--color-surface-7`
- Glass tints: `--glass-tint-strong`, `--glass-tint-soft`
- Frosted borders: `--border-frost-1`, `--border-frost-2`, `--border-frost-3`

### 2.3 Neumorphic controls

Controls use `--neu-raised` and `--neu-pressed` shadow pairs with mode-aware `--neu-light` and `--neu-dark`.

### 2.4 Spacing and radius

All layout spacing follows the 8px baseline grid with the 4px half-step. Radius tokens are squircle-first: `sm 10`, `md 16`, `lg 20`, `xl 28`, `2xl 36`, `pill 9999`.
Every `rounded-*` utility resolves to one of these tokens (Tailwind's own scale is overridden in `@theme`) — raw `rounded-[…]` lengths are banned by contract (`tests/unit/radius-and-color-tokens.test.ts`); the one exception is the wall screensaver board's `rounded-[3vh]`, whose radius scales with the 12ft display's viewport rather than a static token.

### 2.5 Motion

Motion is CSS-only: keyframes for ambient motion and Tailwind transitions for state changes. `prefers-reduced-motion` disables ambient and press motion globally.

## 3 · Primitives

| Primitive | Purpose |
|---|---|
| `Surface` | Canonical glass / neumorphic surface wrapper |
| `SoftButton` | Primary / secondary / ghost / danger buttons with tactile press |
| `IconButton` | Circular glass icon button |
| `Toggle` | Accessible switch |
| `SegmentedControl` | iOS-style segmented control |
| `Chip` | Tag, filter, and status chips |
| `ListRow` | Accessible list item |
| `SwipeableRow` | Swipe-action wrapper |
| `TextField` | Neumorphic inset input |
| `Stepper` | Quantity stepper |
| `EmptyState` | Empty-state illustration and CTA |
| `ErrorState` | Error-state retry pattern |
| `ProgressRing` | Circular progress indicator |
| `Modal` | Bottom-sheet modal |
| `Skeleton` | Loading state |
| `PullToRefresh` | Pull-to-refresh gesture wrapper |
| `Toast` | Accessible toast |

## 4 · Patterns

| Pattern | Purpose |
|---|---|
| `PageHeader` | Page title, subtitle, and action slot |
| `SectionCard` | Reusable card section |
| `StatTile` | Numeric stat card |
| `DayStrip` | 7-day selector |
| `FormField` | Label, control, helper, and error |
| `MoreMenuItem` | More-menu row |

## 5 · Screen Architecture

### Home

- Greeting hero
- Family avatar row
- At-a-glance stat tiles
- Today's flow
- Ask Consuela CTA
- This-week strip
- Emergency FAB

### Tasks

- List view grouped by Today, This Week, Someday
- Swipe-to-complete and swipe-to-snooze
- Quick-add sheet
- Leaderboard tab
- Rewards and penalties preserved

### Meals

- Weekly meal plan
- 3 meal slots per day
- Pantry low-stock strip
- Recipe peek sheet
- Sync footer

### Settings

- Profile
- Appearance
- Accent Studio
- Family and members
- Routines
- Emergency contacts
- Layout and display
- Data and sync

### Navigation

- **One manifest.** `src/lib/nav-items.ts` owns every destination: `path`, `label`, `iconKey`,
  `roles`, `group` (`primary` = dock/rail cap, `more` = the Home `More…` sheet) and `wall` (may a
  signed-out screen offer it). The dock, the desktop rail and the More… sheet all render from it —
  never add a nav list inside a component, and never add a route without a manifest entry (or an
  `EXEMPT_ROUTES` entry with a written reason). `tests/unit/nav-items.test.ts` enforces both, plus
  no stale exemption.
- **One icon set.** `NavIcon`, keyed to `NavIconKey`, draws every nav glyph as an SVG. Emoji are
  *content* (food prefs, personalities, celebration bursts), never navigation or control chrome.
- **One active rule.** `isPathActive`: exact for `/`, segment-aware everywhere else — so
  `/settings/me` lights Settings and `/mealsomething` lights nothing.
- **One active ink.** `--color-nav-active` (+ `-border`, `-sheen`, `-wash`, `-glow`, `-halo`,
  `-fill`) in `globals.css`; the dock, the rail and the nav focus ring read it, so an accent change
  retints all of navigation at once. `-fill` is the accent deepened so the white active glyph keeps
  ≥3:1 non-text contrast on light accents.
- **Roles.** `guest` means *no session* and sees only `wall: true` destinations; `parent` is the
  only privileged role; an unknown signed-in role resolves to `child`, never to parent.

## 6 · Accessibility

- Dynamic Type via rem-based type scale — **never** `text-[Npx]`: arbitrary px defeats the
  root font-size scaling. Floor is **12px (0.75rem / `text-xs`)** for any real text, including
  eyebrows, chips, weekday labels and calendar day numbers. (September 2026 audit: 354 sites
  were rendering 10–11px, some 9px.)
- Minimum 44×44 touch targets. When the *visual* control must stay compact (inline `＋`, a
  36px ghost icon button, a status chip), add **`hit-44`** — it guarantees a centred 44×44
  hit region via `::before` without changing layout. Widget footer links (`a.widget-accent-text`)
  carry a 44px line box in `globals.css`.
- Colour contrast (WCAG 2.2 AA, 4.5:1 body / 3:1 large): `--color-text-muted` and
  `--color-text-dim` are the **only** sub-primary text levels and both clear 4.5:1 in dark and
  light. Dark mode therefore has two readable levels below `text-primary`
  (`text-secondary` → `text-muted`); when a third level is needed, change **weight or size**,
  never colour. Do not re-lighten text with local overrides (`.widget-card` / `.kitchen-text`
  re-scopes are legacy; retire them in Phase 5 of `docs/UI_AUDIT_2026-09.md`).
- `:focus-visible` rings on all interactive elements
- `aria-live` for toasts and live regions
- `role="alert"` for errors
- High-contrast mode preserved
- Reduced-motion support preserved
- Keyboard alternatives for swipe actions
- Glyph-only controls need an `aria-label`; emoji used as *chrome* (not content) is a Phase 3 item.

## 7 · Internal Review Surface

`/_design-system` renders all primitives and patterns in both dark and light themes. It is gated with `NODE_ENV !== "production"` and rewrites to `/design-system` because Next treats underscore-prefixed app folders as private.

> ⚠️ Documented drift (2026-09-26): no such rewrite exists in `next.config.ts`, and
> `src/app/design-system/page.tsx` is a second near-duplicate page. Both are scheduled to
> merge in Phase 5 of `docs/UI_AUDIT_2026-09.md`.

## 8 · Verification

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run lint` exits cleanly with warnings only from pre-existing image and hook-dep rules.
- Visual QA should start at `/_design-system`, then review Home, Tasks, Meals, Settings, and More in development.
- **Legibility / tap-target sweep:** render every route headless at 390×844 **and** 1440×900 and
  assert (a) zero visible text nodes computed under 12px, (b) every interactive element has a
  ≥44px box *or* a `hit-44` region, (c) zero horizontal overflow, (d) zero new console errors.
  The sweep used for the September 2026 fix (Chromium + `getComputedStyle` +
  `getBoundingClientRect`, plus WCAG math over the tokens in `globals.css`) is described in
  `docs/UI_AUDIT_2026-09.md` → Appendix; CI adoption is Phase 5.

