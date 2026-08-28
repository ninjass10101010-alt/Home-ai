# Not-Boring Weather Redesign — Design Brief

Date: 2026-08-27
Target: `src/components/ui/WeatherWidget.tsx` (+ scene system, modal, data layer)
Research: `docs/superpowers/specs/2026-08-27-not-boring-weather-ui-research.md`
Direction: **user-pinned 2026-08-27** — "(Not Boring) Weather's UI language, icons, and motion, with our own pastel palette for day; full Not Boring dark palette at night."

## Direction contract (confirmed 2026-08-27)

- **THESIS:** Weather is something you play, not read — one shared timeline drives scene, number, and details. Refuses the category default: icon + big number + five identical day rows.
- **OWN-WORLD:** (Not Boring) Weather's grammar — huge black-weight numerals, data-true layered scene, timeline scrubber spine, dotted-leader metric rows, minimal chrome — rendered in Consuela's pastel season skins by day (guava/lemon/soft-red/ice keyed to season) and full Not Boring near-black + single-accent after real sunset.
- **STORY:** A parent glancing at the kitchen tablet sees the day's weather as a living scene, reads the strip for when rain comes, presses the strip to preview any hour, and opens the modal to scrub the whole day and settle the jacket/umbrella question.
- **FIRST VIEWPORT:** 350px card — data-true scene fills the card behind a huge SF Pro black-weight temperature at center; condition + H/L beneath; bottom fifth is the day strip (temp curve, rain ticks, NOW/3PM/6PM/9PM). Primary action: press the strip to preview, tap the card for the modal.
- **FORM:** User-pinned direction beats any roll; no concept seed. Single 1×1 bento card + modal, one `renderHour()` path shared by card preview and modal scrubber.

---

## 1. Job and audience

The Garcia family, on a kitchen tablet or phone, in Operate/glance mode. The weather card answers three questions at three depths:
- **1 second:** what's it like right now? (temp + scene)
- **5 seconds:** what's coming today? (strip: high/low, when rain)
- **30 seconds:** plan the day (scrub the timeline, check wind/UV for school run, practice, dogs)

## 2. Outcome and proof

Success: the family asks the card instead of their phones. Proof is live Open-Meteo data driving everything on screen — scene, number, strip, and details are all functions of one shared timeline. No decorative element that ignores data.

## 3. Selected direction — "(Not Boring), Consuela-style"

**Thesis:** weather is something you *play*, not read. One timeline drives scene + number + details. Refuses the category default (icon + number + five identical day rows).

**Grammar borrowed from (Not Boring) Weather:**
- Huge temperature numerals as the hero object
- Data-true scene (cloud cover %, wind, precip drive the actual visuals)
- Timeline scrubber spine with rain timing
- Tap-the-number-to-explode details with dotted-leader rows (`HUMIDITY ··· 62%`)
- Minimal chrome, rounded metric pills, one accent per state

**Palette — our own, per user direction:**
- **Day skins (pastel readings of Not Boring skins), auto-keyed to the existing season system:**
  - Spring — pastel lemon + soft lilac
  - Summer — pastel guava (soft coral) + peach
  - Autumn — soft red pastel + warm amber
  - Winter — pastel ice blue + silver white
  - Each skin: sky gradient, scene tints, one accent (strip/rain markers/interactive), ink color
- **Night — full Not Boring:** near-black `#0A0A0A` base, white numerals, one condition accent (soft red / amber / cyan), high contrast. Keyed to real sunset via `is_day`.
- Holiday overlays persist on top of the new scene system.

**Type:** keep the SF Pro stack (brand commitment, no paid fonts). Hero temp: weight 800–900, tight tracking, `tabular-nums` (stable during count-up/scrub). Labels: tracked uppercase for dotted-leader rows.

**Scene system:** layered SVG/CSS replacing static seasonal illustration — sun disc riding a real sun arc, cloud forms whose count/opacity track `cloud_cover`, existing particle system re-driven by real wind (speed → velocity, direction → drift angle) and precip (probability → density), fog layer from humidity, lightning flash for storm codes. Season = skin tint, not a different illustration.

## 4. Scope and boundaries

**In — full spine:**
1. **Card (1×1, 350px):** data-true scene behind; huge temp; condition + H/L; bottom **day strip** (temp curve + rain markers + NOW/3PM/6PM/9PM ticks); **tap any point to preview** that hour in place (temp, condition, scene update; "3 PM" chip appears; returns to now on release/tap-now).
2. **Modal:** full **24h timeline scrubber** (drag → scene, temp, and metrics follow); **exploded metrics** in dotted-leader rows (humidity, wind + direction, feels-like, UV 5-dot scale, pressure, precip); **hourly/daily toggle**; **sun arc** with sunrise/sunset.
3. **Data layer:** add free Open-Meteo fields — `sunrise,sunset,is_day,wind_direction_10m,cloud_cover,uv_index,pressure_msl` (+ hourly `is_day,cloud_cover,uv_index` where needed for scrubbing).
4. **Motion:** temp count-up on refresh; scene crossfade on condition change; scrubber direct-manipulation; all state-driven, pause-on-hidden, reduced-motion static fallbacks.

**Untouched:** all other widgets, bento grid, pastel-bento world elsewhere, Open-Meteo as source, modal shell conventions, seasonal/holiday calendar logic, no-new-dependencies rule.

**Anti-goals:** 3D/WebGL, sound/haptics, tilt parallax, radar/maps, user-facing skin picker (v1), dark mode spreading beyond the weather card.

## 5. States and ranges

- Loading (no cache) → skeleton scene + "—°"; cached/stale → show cache + freshness footer; offline → cache with stale badge
- Temps −20°…110°F; precip 0–100%; wind 0–40 mph (particle velocity caps)
- Day↔night crossfade at sunset; season skin switch at season boundary
- Reduced motion: static scene per state, value swaps instead of count-up/crossfade
- High-contrast mode: both palettes keep AA text contrast
- Modal with partial data (source missing UV/pressure) → rows hide, never show fake values

## 6. Interaction and layout

```
CARD (350px)                        MODAL
┌────────────────────────┐          ┌──────────────────────────┐
│ Weather          ⏱ 5m  │          │ Home · Weather        ✕  │
│    [data-true scene]   │          │   [scene, scrubbed hour] │
│         72°            │          │        74°               │
│    Mostly Cloudy       │          │     Mostly Cloudy        │
│     H:78°  L:61°       │          │ HUMIDITY ······ 62%      │
│ ▁▂▄▆▇▆▄▂▁ ︙rain ticks  │          │ WIND ·········· 8 MPH SW   │
│ NOW   3PM   6PM   9PM  │          │ FEELS LIKE ···· 70°      │
└────────────────────────┘          │ UV ············ ●●●○○    │
 tap strip pt → preview             │ PRESSURE ····· 1013      │
 tap card → modal                   │ ☀︎────────●───── sunset   │
                                    │ [━━━●━━━━━━━━━━] scrub   │
                                    │  HOURLY │ DAILY          │
                                    └──────────────────────────┘
```

- Strip is its own hit area (no conflict with card-tap-to-modal); keyboard: scrubber = `role="slider"` with `aria-valuetext` ("3 PM, 74 degrees, partly cloudy")
- Preview state visually pins the strip thumb; releasing animates back to now
- Scrubber in modal drives the same render path as card preview (one `renderHour(h)` function)

## 7. Constraints and open decisions

**Binding:** CSS/SVG/emoji only; CSS animations only (no framer-motion); particle budget (−30% + pause-on-hidden already in place); `prefers-reduced-motion`; AGENTS.md snapshot + UI Change Record + Change Log after build; no new dependencies.

**Asserted (correct me if wrong):**
1. Skins auto-follow the existing season system — no user picker in v1
2. Hero numerals use SF Pro black weight + tight tracking (no condensed font download)
3. Night palette keyed to real `is_day`/sunset, not a fixed clock time
4. Weather card only — every other widget stays pastel-bento
5. Holiday overlays survive on top of the new scene system

**Process:** on confirmation → direction contract + DESIGN.md (weather-card world) recorded, then build card → data layer → modal → motion pass → Playwright verification at 1440/768/390 → AGENTS.md updates.
