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

All layout spacing follows the 8px baseline grid with a 4px half-step. Radius tokens are squircle-first: `sm 10`, `md 16`, `lg 20`, `xl 28`, `2xl 36`, `pill 9999`.

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

## 6 · Accessibility

- Dynamic Type via rem-based type scale
- Minimum 44×44 touch targets
- `:focus-visible` rings on all interactive elements
- `aria-live` for toasts and live regions
- `role="alert"` for errors
- High-contrast mode preserved
- Reduced-motion support preserved
- Keyboard alternatives for swipe actions

## 7 · Internal Review Surface

`/_design-system` renders all primitives and patterns in both dark and light themes. It is gated with `NODE_ENV !== "production"` and rewrites to `/design-system` because Next treats underscore-prefixed app folders as private.

## 8 · Verification

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run lint` exits cleanly with warnings only from pre-existing image and hook-dep rules.
- Visual QA should start at `/_design-system`, then review Home, Tasks, Meals, Settings, and More in development.
