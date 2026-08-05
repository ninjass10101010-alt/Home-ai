# Summer Weather Widget Visuals — Trees + Temp Readability

**Date:** 2026-08-05
**Status:** Approved
**Scope:** `src/components/ui/WeatherWidget.tsx` — `SummerBackdrop` (day branch only) and the foreground content overlay (temp display + forecast cards). No data source, location, or other season changes.

## Problem

The summer/warm weather widget has two visual issues the user flagged:

1. **Trees don't look real.** The day branch of `SummerBackdrop` (lines 538-582) draws two palms as flat stroke-silhouette `<path>` elements at opacity 0.22 / 0.14 — a curved trunk line and 4-6 frond lines, no foliage volume, no trunk taper, no tonal depth. They read as cartoon strokes, not plants, next to the nicely-rendered sun.
2. **Temperature numbers get lost.** The main temp (line 1813-1814), condition text (1819), and forecast highs (1861) are all white. The summer day backdrop is bright (warm amber sky + sun glow + mint-to-sky gradient), so white text has low contrast against it. The content overlay at line 1772 has `backdropFilter: "blur(0px)"` — effectively no frost — so the bright scene sits directly behind the text.

## Design (approved decisions)

### 1. Layered SVG palms — replace the stroke silhouettes

Replace the two `<g opacity="...">` palm blocks (lines 555-572) with layered vector palms that read as real plants from across the room while staying flat SVG (no raster assets, no new deps).

**Each palm gets four layers:**

1. **Trunk** — a filled `<path>` (not a stroke) with a vertical linear gradient: sunlit top (`#7c4a1e` warm tan) → shadow base (`#2d1810` dark brown). Tapered: wider at the base, narrowing toward the crown. Keep the existing gentle `Q`-curve bend so the silhouette still reads "palm." A few horizontal `<line>` ring accents (dark brown, low opacity) for the segmented trunk texture real palms have.
2. **Frond cluster shadow layer** — a single dark `<path>` silhouette behind the fronds (`#14532d` deep forest green, opacity ~0.55) giving the whole crown a grounded shadow mass so fronds read on top of something.
3. **Fronds** — 6-7 filled `<path>` fronds (not strokes) in two tone groups: 3-4 sunlit (`#16a34a` mid green) on the sun-facing (upper-right) side, 3 shadowed (`#15803d` darker) on the lower-left. Each frond is a curved lance shape (a `Q`-curve closed path, not a line), so they have real width and a midrib. A single thin `<path>` midrib line per frond in a tone darker than the frond for veining detail.
4. **Coconut accents** — 2-3 small `<circle>` coconuts at the crown's base (`#3f2412` dark brown, r=2-2.5).

**Spatial + tone tuning:**

- **Left palm (foreground)**: keep at the current `x≈55-58` position, scaled to roughly the existing height (~200 → 70 crown). Opacity 0.28 (slightly raised from 0.22 so the new detail is visible) — still clearly a background element, not a foreground pop.
- **Right palm (distant)**: keep at `x≈290`, ~60% the size of the left (perspective), opacity 0.18 (raised from 0.14). Cooler, lighter, desaturated greens (`#166534` sunlit / `#14532d` shadow) — aerial perspective pushes distant foliage cooler and flatter.
- No new animation. Reduced-motion users see the improved static palms unchanged. Existing `weatherSunHalo` / `weatherRayPulse` animations on the sun are untouched.

**What stays the same:** the sun, halo rings, rays, ocean horizon glow (line 574), and heat shimmer waves (lines 575-580) are not modified. Only the two palm `<g>` blocks are replaced. The night branch (lines 511-537) is untouched.

### 2. Recolor temps to accent orange + deepen the card frost

Two coordinated changes so the numbers pop without changing the bright summer sky:

**A. Recolor temperature numbers to the summer accent.**

The summer theme accent is `#d97706` (amber-700, `useWidgetTheme.ts:72`) — already used by the `°{unit}` badge (line 1790-1800), so tying temps to it is consistent, not a new color.

| Element | Line | Current | New |
|---|---|---|---|
| Main temp digits | 1813-1814 | `color: "white"`, text-shadow accent glow | `color: accentHex.selected` (`#d97706`), text-shadow `0 0 30px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.35)` — darker glow for contrast against bright sky |
| Feels-like / season / tod line | 1820 | `text-white/55` | `text-white/70` — small contrast bump (keep secondary line neutral) |
| Forecast day label (Sun/Mon…) | 1859 | `text-white/50` | `text-white/65` — small contrast bump |
| Forecast high temp | 1861 | `text-white` | `color: accentHex.selected` (`#d97706`) — matches the main temp |
| Forecast low temp | 1862 | `text-white/40` | `text-white/55` — small contrast bump |

Condition text (line 1819, "Sunny"/"Partly Cloudy") stays white — it's already got `drop-shadow` and is secondary to the number.

**B. Deepen the content overlay frost.**

Line 1772 currently: `<div className="relative z-20 p-4" style={{ backdropFilter: "blur(0px)" }}>`. Replace with a real frosted panel:

- `backdropFilter: "blur(14px) saturate(1.3)"` — lighter than `material-regular` (20px) so the scene still reads through.
- Translucent dark/cool tint: `background: "linear-gradient(180deg, rgba(15,23,42,0.28), rgba(15,23,42,0.18))"` — cool slate-900 at low alpha. Dark enough that white and `#d97706` pop, transparent enough that the warm sky still reads through the top.
- Hairline border: `border: "1px solid rgba(255,255,255,0.08)"`.
- `borderRadius: "1rem"`.
- Keep `relative z-20 p-4` the same.

The accent orange + darker glow-on-text + frosted panel work together: the panel darkens the immediate area behind the numbers, and the orange itself is a high-contrast hue against a dark-frosted sky. Either alone is half a fix.

### 3. Non-goals

- No changes to SpringBackdrop / AutumnBackdrop / WinterBackdrop — only summer is in scope (current season).
- No changes to the night branch of SummerBackdrop.
- No changes to the Open-Meteo data source, hardcoded Holland MI coords, or the fetch logic.
- No new npm dependencies, no raster image assets, no framer-motion.
- No changes to the holiday overlay system or the particle system (`WeatherParticles`).
- Nothing new animated, so the existing `prefers-reduced-motion` block needs no work.

## Verification

1. Open the dashboard (Home) with season set to summer + time-of-day day: palms look layered, tapered, tonally-shaded — not stroke silhouettes — while sun, sky, ocean glow, heat shimmer look the same as before.
2. Main temperature number and 5-day forecast highs read as clear orange `#d97706` against a lightly frosted panel — no more white-on-white blur.
3. Night branch unchanged (stars, moon, galaxy identical).
4. `npm run typecheck`, `npm run lint`, `npm run build` all clean.

QA method: visual check in the running dashboard at phone width (375px) since that's the primary form factor, then the three lint/type/build commands.

## Files touched

- `src/components/ui/WeatherWidget.tsx` — SummerBackdrop day-branch palm blocks (replace ~lines 555-572), content overlay frost (line 1772), temp + forecast color lines (1813-1814, 1820, 1859, 1861, 1862). Single file.
- `AGENTS.md` — UI Change Record entry + snapshot update, per the mandatory agent rule.

## Rollback

Single-file revert of `WeatherWidget.tsx` plus the AGENTS.md entry. No data, schema, or external state changes — purely a visual diff in one component.
