# Stream C — Interaction Consistency (Full Tap Language)

**Date:** 2026-07-17
**Branch:** warm-glass-v2
**Status:** Approved (Approach A)

## Goal

Unify press / hover / focus feedback across every tappable surface in the Consuela
dashboard so the whole app speaks one coherent "tap language." This is the deferred
Stream C from the UI redesign plan. Stream A (glass materials) and Stream B (Kitchen
flow) are already shipped.

Target standard (decided with user):
- **Press:** `active:scale-[0.97]` everywhere (currently inconsistent: some use 0.95,
  0.90, or none)
- **Hover:** subtle lift `hover:scale-[1.02]` (or `1.01` for tiny controls) on all
  primary tappables — replacing the mixed `hover:scale-105` / `hover:brightness-110` /
  no-hover today
- **Focus:** `focus-visible` accent ring (`--color-accent-selected`) on every tappable

## Approach

**A — One shared utility class in `globals.css`** (recommended, approved).

Add two utilities that bundle the full tap language, mirroring how Stream A introduced
`.material-thin/regular/thick`:

```css
.tap {
  @apply transition-all duration-150;
  @apply active:scale-[0.97] hover:scale-[1.02];
  @apply focus-visible:outline-none focus-visible:ring-2;
  @apply focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2;
}
.tap-sm {
  @apply transition-all duration-150;
  @apply active:scale-[0.97] hover:scale-[1.01];
  @apply focus-visible:outline-none focus-visible:ring-2;
  @apply focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2;
}
```

Both respect `prefers-reduced-motion` (scale disabled, ring kept) via the existing
reduced-motion block in `globals.css`.

Every tappable component swaps its scattered inline scale/hover classes for `.tap`
(or `.tap-sm` for small controls like Stepper / IconButton). This gives one source of
truth and prevents future drift.

## Scope

### 1. globals.css
- Add `.tap` and `.tap-sm` utilities.
- Extend the existing `prefers-reduced-motion` rule to neutralize `.tap` / `.tap-sm`
  scale transforms (keep focus ring).

### 2. Global chrome (`src/components/ui/`)
- `BottomNav.tsx` — nav buttons currently `hover:scale-105 active:scale-95` → `.tap`.
- `ConsuelaFAB.tsx` — `hover:scale-105 active:scale-95` → `.tap`.
- `EmergencyButton.tsx` — `hover:opacity-90 active:scale-95` → `.tap` (keep opacity
  hover optional; press to 0.97).
- `Avatar.tsx` — `hover:scale-110 active:scale-90` → `.tap` (avatar is decorative but
  tappable in member pickers; keep consistent).
- `Stepper.tsx` — `active:scale-95` → `.tap-sm`.
- `SegmentedControl.tsx` — option buttons currently `transition-colors` only → add
  `.tap` (the sliding pill stays; just standardize press on options).

### 3. Core UI kit (`src/components/ui/`)
Verify and normalize (most already use 0.97 from Stream A; fix outliers):
- `SoftButton.tsx` — already `active:scale-[0.97]`; add `.tap` (gains hover lift + ring).
- `IconButton.tsx` — already 0.97; add `.tap`.
- `Chip.tsx` — already 0.97; add `.tap`.
- `ListRow.tsx` — already 0.97 + hover bg; add `.tap` (keep bg hover, gain ring).
- `Surface.tsx` — interactive variant already `hover:scale-[1.015] active:scale-[0.97]`;
  align to `.tap` (1.02 hover).
- `TextField.tsx` — already has focus ring; ensure no conflict with `.tap` (TextField is
  an input, gets ring via focus not focus-visible necessarily; leave as-is, just confirm).
- `Toggle.tsx` — add `.tap-sm` to the thumb / track for keyboard consistency.
- `ThemeToggle.tsx` — `transition-all hover:bg` only; add `.tap-sm`.
- `TopBar.tsx` — icon buttons `transition-colors` only; add `.tap-sm`.
- `Badge.tsx` — `transition-all` only; add `.tap-sm` if interactive, else leave.
- `Modal.tsx` — footer buttons (consumers use SoftButton) inherit; verify.
- `Toast.tsx` — non-interactive; no change.

### 4. Kitchen controls (`src/components/meals/`)
- Meals/Grocery/Pantry/Recipes copy / duplicate / sync / add buttons → ensure they use
  `.tap` (they were added in Stream B with ad-hoc `transition` / `hover:bg` but not the
  standard press scale).
- Day pickers (copy-day, duplicate-meal) day buttons → `.tap-sm`.

## Out of scope

- Route / page transitions
- List enter animations, staggered fades
- Skeleton / loading states
- (These belong to the deferred "Motion & transitions" area, not consistency.)

## Verification

- `npm run typecheck` clean
- `npm run lint` clean (pre-existing warnings allowed)
- `npm run build` clean
- Visual check at 375px: every tappable presses to 0.97, lifts on hover, shows accent
  ring on keyboard focus.
- AGENTS.md: new UI Change Record + Change Log entry + snapshot date bump.

## Files touched

- `src/app/globals.css` (new utilities + reduced-motion)
- `src/components/ui/BottomNav.tsx`
- `src/components/ui/ConsuelaFAB.tsx`
- `src/components/ui/EmergencyButton.tsx`
- `src/components/ui/Avatar.tsx`
- `src/components/ui/Stepper.tsx`
- `src/components/ui/SegmentedControl.tsx`
- `src/components/ui/SoftButton.tsx`
- `src/components/ui/IconButton.tsx`
- `src/components/ui/Chip.tsx`
- `src/components/ui/ListRow.tsx`
- `src/components/ui/Surface.tsx`
- `src/components/ui/Toggle.tsx`
- `src/components/ui/ThemeToggle.tsx`
- `src/components/ui/TopBar.tsx`
- `src/components/meals/MealsTab.tsx`
- `src/components/meals/GroceryTab.tsx`
- `src/components/meals/PantryTab.tsx`
- `src/components/meals/RecipesTab.tsx`
- `AGENTS.md`
