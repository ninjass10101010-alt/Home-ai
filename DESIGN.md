# DESIGN.md — Consuela (Home-ai)

<!-- impeccable:design-schema 1 -->

## Dashboard world (established, inherited)

- **Pastel-bento warm glass:** translucent frosted `widget-glass` surfaces on a soft warm gradient; 10-color accent system (`--color-accent-*`) with one selected accent (`--color-accent-selected`); high-contrast toggle supported.
- **Type:** Apple SF Pro stack utilities only. No paid or downloaded fonts.
- **Bento grid:** Home uses `auto-rows-[350px]`; widgets are 1×1 or 2×1 and must never spill their cell (contained scroll or `+N more` footer).
- **Visuals:** CSS/SVG/emoji only — no stock imagery, no icon libraries, no WebGL.
- **Motion:** CSS animations only (no framer-motion); state-driven, never decorative infinite loops; pause when tab hidden; every animation has a `prefers-reduced-motion` fallback.
- **Emoji as iconography:** liberal, lightweight, consistent with family-member emoji avatars.

## Weather card world — "(Not Boring), Consuela-style" (replacement world, 2026-08-27)

The weather card alone speaks (Not Boring) Weather's interface language, in Consuela's palette. Every other widget stays pastel-bento.

### Grammar
- Huge temperature as the hero object: SF Pro weight 800–900, tight tracking, `tabular-nums`.
- Data-true scene: cloud count/opacity track `cloud_cover`, particle velocity/drift track wind speed/direction, rain density tracks precipitation probability, fog tracks humidity, sun position tracks the real sun arc. No element decorates without data.
- One shared timeline: card day-strip preview and modal scrubber render through the same hour-state path.
- Minimal chrome; details live in dotted-leader rows (`HUMIDITY ··· 62%`) with tracked-uppercase labels and rounded metric pills.
- One accent per state: the skin's accent colors strip, rain ticks, and interactive elements only.

### Palettes
- **Day skins, auto-keyed to season (no user picker):**
  - Spring — pastel lemon + soft lilac
  - Summer — pastel guava (soft coral) + peach
  - Autumn — soft red pastel + warm amber
  - Winter — pastel ice blue + silver white
- **Night — full Not Boring:** near-black `#0A0A0A` base, white numerals, one condition accent (soft red / amber / cyan). Keyed to real `is_day`/sunset from the API, never a fixed clock time.
- Both palettes must hold AA contrast for all text at all times of day.

### Scene system
- Layered SVG/CSS: sky gradient (skin), sun/moon disc riding the sun arc, cloud forms, particle precipitation, fog layer, lightning flash for storm codes.
- Season changes the skin tint, not the illustration. Holiday overlays persist on top.
- Scene changes crossfade; values count up; hard cuts are banned.

### Interaction
- Card: press-and-drag the day strip to preview any hour (scene, temp, condition follow); release animates back to now. Tap elsewhere on the card → modal.
- Modal: 24h scrubber (`role="slider"` with spoken `aria-valuetext`), exploded metric rows, UV 5-dot scale, pressure, sun arc, hourly/daily toggle.
- Missing data hides rows; it never fakes values.
