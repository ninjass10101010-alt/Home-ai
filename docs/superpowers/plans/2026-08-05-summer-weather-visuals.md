# Summer Weather Widget Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the summer weather widget's palms look like layered, realistic plants and make the temperature numbers readable against the bright backdrop by recoloring them to the warm accent and frosting the content panel.

**Architecture:** All changes are in one file, `src/components/ui/WeatherWidget.tsx`. The flat stroke-silhouette palms in `SummerBackdrop` (lines 555-572) are replaced with a new `PalmSilhouette` component — a layered SVG group (tapered gradient trunk, crown shadow mass, two-tone fronds with midribs, coconuts) rendered twice with different transform/tone for foreground vs. distant. The content overlay (line 1772) gets real backdrop blur + a translucent cool tint, and the main temp + forecast highs switch from white to the summer accent `#d97706` with a dark text-shadow.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, inline SVG + inline styles, CSS keyframes only (no framer-motion), no new dependencies.

## Global Constraints

- Touch **only** `src/components/ui/WeatherWidget.tsx` and `AGENTS.md`. No other season backdrops, no night-branch changes, no data-fetch changes, no other files.
- Sun, halo rings, rays, ocean horizon glow, and heat shimmer waves (lines 541-554, 574-580) must remain pixel-identical.
- No new animation anywhere (the existing `prefers-reduced-motion` block needs no changes).
- Use the summer accent `#d97706` (already wired as `accentHex.selected` via `useWidgetTheme.ts` summer theme) — do not introduce a new color constant.
- After each task: `npm run typecheck`, `npm run lint`, `npm run build` must be clean.
- Commit after each task with a `feat(ui): ...` message (repo convention).
- Note: this repo has no component unit-test harness (visual components are verified by build + visual QA; Playwright is used ad-hoc). Steps therefore verify via typecheck/lint/build plus a visual check in the running app — there are no failing-then-passing unit tests for SVG markup.

---

### Task 1: Layered palm silhouettes

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx` — add `PalmSilhouette` component + trunk gradient def; replace the two palm `<g>` blocks at lines 555-572

**Interfaces:**
- Produces: `PalmSilhouette({ x, y, scale, opacity, sunlit, shadow })` — renders a palm in local coords with the base at `(0,0)` and the crown at `(0,-126)`, wrapped in `<g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>`. `sunlit`/`shadow` are fill hex strings for the two frond tone groups. Later tasks do not consume it; it exists purely inside `SummerBackdrop`.

- [ ] **Step 1: Add the trunk gradient to SummerBackdrop's `<defs>`**

In `SummerBackdrop` (line 497), inside the existing `<defs>` block (lines 500-508), after the `summerMoonGlow` radialGradient, add:

```tsx
        <linearGradient id="summerPalmTrunk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c4a1e" />
          <stop offset="100%" stopColor="#2d1810" />
        </linearGradient>
```

- [ ] **Step 2: Add the `PalmSilhouette` component**

Insert this function directly **above** `function SummerBackdrop` (line 497):

```tsx
function PalmSilhouette({
  x, y, scale, opacity, sunlit, shadow,
}: {
  x: number; y: number; scale: number; opacity: number; sunlit: string; shadow: string;
}) {
  return (
    <g opacity={opacity} transform={`translate(${x} ${y}) scale(${scale})`}>
      {/* Tapered trunk, sunlit crown → shadow base */}
      <path d="M-6 0 C-6 -50 -4 -100 0 -126 L 8 -124 C4 -100 6 -50 6 0 Z"
        fill="url(#summerPalmTrunk)" stroke="#2d1810" strokeWidth="0.75" strokeOpacity="0.35" />
      {/* Segmented trunk ring texture */}
      {[-30, -55, -80, -105].map((ry) => (
        <path key={ry} d={`M-5.5 ${ry} Q0 ${ry - 2} 5.5 ${ry + 1}`} fill="none"
          stroke="#2d1810" strokeWidth="1" opacity="0.3" />
      ))}
      {/* Crown shadow mass */}
      <path d="M-28 -126 Q-24 -158 0 -162 Q24 -158 28 -126 Q12 -114 -12 -114 Q-24 -116 -28 -126 Z"
        fill={shadow} opacity="0.55" />
      {/* Sunlit fronds (up-left, up, up-right, right) */}
      <path d="M-1 -125 Q-17 -141 -25 -153 Q-13 -147 1 -125 Z" fill={sunlit} />
      <path d="M0 -127 Q-1 -153 0 -167 Q5 -153 4 -127 Z" fill={sunlit} />
      <path d="M1 -127 Q15 -155 25 -163 Q13 -147 3 -127 Z" fill={sunlit} />
      <path d="M3 -126 Q21 -135 33 -131 Q19 -123 5 -124 Z" fill={sunlit} />
      {/* Shadow fronds (down-right, left, down-left) */}
      <path d="M3 -125 Q19 -111 27 -99 Q15 -109 5 -123 Z" fill={shadow} />
      <path d="M-1 -125 Q-17 -131 -25 -125 Q-15 -119 1 -123 Z" fill={shadow} />
      <path d="M-1 -124 Q-11 -107 -17 -97 Q-7 -107 -1 -122 Z" fill={shadow} />
      {/* Midrib veining */}
      <path d="M0 -126 Q-15 -144 -23 -152" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      <path d="M0 -127 Q0 -154 0 -165" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      <path d="M1 -126 Q14 -152 23 -161" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      <path d="M3 -125 Q20 -134 31 -130" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      <path d="M3 -125 Q17 -112 25 -101" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      <path d="M0 -125 Q-16 -130 -24 -125" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      <path d="M0 -124 Q-9 -109 -15 -99" fill="none" stroke={shadow} strokeWidth="0.8" opacity="0.5" />
      {/* Coconuts */}
      <circle cx="-2" cy="-125" r="2.2" fill="#3f2412" />
      <circle cx="3" cy="-124" r="2.2" fill="#3f2412" />
      <circle cx="0.5" cy="-121.5" r="2" fill="#3f2412" />
    </g>
  );
}
```

- [ ] **Step 3: Replace the two palm blocks in the day branch**

In `SummerBackdrop`'s day branch, replace the entire left-palm block (lines 555-566):

```tsx
          {/* Tall palm tree — left side */}
          <g opacity="0.22">
            <path d="M55 200 Q52 160 50 120 Q48 90 58 70" stroke="#15803d" strokeWidth="6" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q30 48 10 62" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q85 42 105 55" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q40 50 35 30" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q80 52 88 35" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q60 48 55 25" stroke="#15803d" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <circle cx="40" cy="65" r="5" fill="#78350f" opacity="0.6"/>
            <circle cx="74" cy="60" r="4" fill="#78350f" opacity="0.6"/>
          </g>
```

with:

```tsx
          {/* Tall palm tree — left side */}
          <PalmSilhouette x={55} y={200} scale={1} opacity={0.28} sunlit="#16a34a" shadow="#15803d" />
```

Then replace the entire right-palm block (lines 567-572):

```tsx
          {/* Distant palm — right */}
          <g opacity="0.14">
            <path d="M290 200 Q288 170 287 145 Q286 125 292 110" stroke="#166534" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q272 95 258 104" stroke="#166534" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q312 92 320 102" stroke="#166534" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q280 96 277 82" stroke="#166534" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          </g>
```

with:

```tsx
          {/* Distant palm — right */}
          <PalmSilhouette x={292} y={196} scale={0.6} opacity={0.18} sunlit="#166534" shadow="#14532d" />
```

- [ ] **Step 4: Verify types, lint, and build**

Run: `npm run typecheck`
Expected: exits 0, no errors.

Run: `npm run lint`
Expected: exits 0 (pre-existing warnings allowed — do not introduce new errors).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Visual check**

Open the dashboard (dev server or docker container) at phone width (~375px), season set to **summer** + time-of-day **day** (Settings → Weather, or the Appearance control). Confirm:
- Left palm (x≈55): tapered gradient trunk, dark crown mass, 7 two-tone fronds with veining, tiny coconuts — reads as a layered plant, not strokes.
- Right palm (x≈292): visibly smaller (0.6×), cooler/dimmer tone, sits on the horizon.
- Sun, halo rings, rays, ocean glow, heat shimmer: **unchanged**.
- Night branch (Appearance → Night): stars, moon, galaxy **unchanged** (no palm there).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/WeatherWidget.tsx
git commit -m "feat(ui): layered summer palm silhouettes with trunk gradient, tonal fronds, and coconuts"
```

---

### Task 2: Accent-orange temps + frosted content panel

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx` — content overlay (line 1772), main temp (lines 1813-1814), feels-like line (1820), forecast day label (1859), forecast high (1861), forecast low (1862)

**Interfaces:**
- Consumes: `accentHex.selected` (already computed at line 1703 — no change needed)
- Produces: no new exports; this task only restyles existing JSX

- [ ] **Step 1: Frost the content overlay**

Replace line 1772:

```tsx
        <div className="relative z-20 p-4" style={{ backdropFilter: "blur(0px)" }}>
```

with:

```tsx
        <div
          className="relative z-20 p-4"
          style={{
            backdropFilter: "blur(14px) saturate(1.3)",
            background: "linear-gradient(180deg, rgba(15,23,42,0.28), rgba(15,23,42,0.18))",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "1rem",
          }}
        >
```

- [ ] **Step 2: Recolor the main temperature number**

Replace lines 1813-1814:

```tsx
                <span className="text-[52px] font-black tabular-nums leading-none tracking-tight"
                  style={{ color: "white", textShadow: `0 0 30px ${accentHex.selected}88, 0 2px 8px rgba(0,0,0,0.3)` }}>
```

with:

```tsx
                <span className="text-[52px] font-black tabular-nums leading-none tracking-tight"
                  style={{ color: accentHex.selected, textShadow: "0 0 30px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.35)" }}>
```

- [ ] **Step 3: Bump the feels-like line contrast**

Line 1820: change `className="text-white/55 text-[11px]"` → `className="text-white/70 text-[11px]"`.

- [ ] **Step 4: Bump the forecast day labels**

Line 1859: change `className="text-white/50 text-[10px] font-semibold"` → `className="text-white/65 text-[10px] font-semibold"`.

- [ ] **Step 5: Recolor the forecast high + bump the low**

Line 1861: replace:

```tsx
                      <span className="text-white text-[11px] font-bold">{weather.unit === "C" ? toC(day.high) : day.high}°</span>
```

with:

```tsx
                      <span className="text-[11px] font-bold" style={{ color: accentHex.selected, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>{weather.unit === "C" ? toC(day.high) : day.high}°</span>
```

Line 1862: change `className="text-white/40 text-[10px]"` → `className="text-white/55 text-[10px]"`.

- [ ] **Step 6: Verify types, lint, and build**

Run: `npm run typecheck` — exits 0.
Run: `npm run lint` — exits 0 (no new errors).
Run: `npm run build` — succeeds.

- [ ] **Step 7: Visual check**

Open the dashboard at phone width, summer + day. Confirm:
- Main temp reads as orange `#d97706` with a dark glow — clearly visible against the bright sky.
- Forecast high temps match the same orange; day labels and lows are brighter than before.
- The content area sits on a soft frosted panel (blur + cool tint + hairline border) but the warm sky still glows through the top.
- Night mode: temp is the night accent (`#fbbf24`) on the dark galaxy + panel — good contrast, no white-on-white.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/WeatherWidget.tsx
git commit -m "feat(ui): accent-orange temps and frosted content panel for weather widget readability"
```

---

### Task 3: Update AGENTS.md operational manual

**Files:**
- Modify: `AGENTS.md` — "Current Dashboard Snapshot" last-updated line + new UI Change Record entry

**Interfaces:**
- Consumes: nothing — documentation only

- [ ] **Step 1: Update the snapshot date line**

In the "Current Dashboard Snapshot" block, change the date prefix of the summary line from `**Last Updated:** 2026-08-05 | **Consuela integration...` to read `**Last Updated:** 2026-08-05 | **Summer weather visuals:** realistic layered palm silhouettes + accent-orange temperatures on a frosted panel (weather widget) | **Consuela integration...` — prepend the new item, keep the rest of the line intact.

- [ ] **Step 2: Add the UI Change Record entry**

Insert a new entry at the top of the UI Change Record list (immediately above the `### UI Change Record — 2026-08-05 — Grocery single list...` heading), in the exact delta format used by the file:

```markdown
### UI Change Record — 2026-08-05 — Summer weather widget: realistic palms + readable temperatures
- Added / Changed: `src/components/ui/WeatherWidget.tsx` — new `PalmSilhouette` component (tapered gradient trunk, crown shadow mass, 7 two-tone fronds with midrib veining, coconut accents) replacing the flat stroke-silhouette palms in `SummerBackdrop`; foreground palm at opacity 0.28 (was 0.22), distant palm at 0.18 (was 0.14) with cooler desaturated tones and 0.6× scale for aerial perspective; content overlay frost upgraded from `blur(0px)` to a `blur(14px) saturate(1.3)` panel with a cool slate tint, hairline border, and 1rem radius; main temp + forecast highs recolored from white to the summer accent `#d97706` with a dark text-shadow; feels-like/day-label/low contrast bumps (`white/55→70`, `white/50→65`, `white/40→55`).
- Visual / Motion: The summer day scene's palms now read as layered plants — a filled trunk with sunlit-to-shadow gradient and ring texture, a dark crown shadow mass, sunlit fronds on the upper-right side and shadow fronds below, thin midrib veining, and tiny coconuts — instead of single-stroke cartoon lines. The temperature number and 5-day forecast highs are now the warm orange already used by the `°F` badge, so they pop against the bright amber sky; the whole content layer sits on a lightly frosted dark panel so white secondary text reads too. Night branch, sun, halo rings, rays, ocean glow, and heat shimmer are unchanged. No new animation; `prefers-reduced-motion` untouched.
- Color sources: Summer theme accent `#d97706` (`useWidgetTheme.ts`), trunk `#7c4a1e→#2d1810`, fronds `#16a34a`/`#15803d` (foreground) and `#166534`/`#14532d` (distant), coconuts `#3f2412`, frost tint `rgba(15,23,42,0.28→0.18)`.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The weather widget's summer scene got two upgrades. The palm trees are no longer flat cartoon strokes — each palm now has a tapered shaded trunk, a layered crown of sunlit and shadowed fronds with veining, and tiny coconuts, with the distant palm smaller and hazier for depth. And the temperature number (plus the 5-day forecast highs) is now the same warm orange as the °F badge with a dark glow, sitting on a softly frosted panel, so it reads clearly against the bright summer sky instead of getting lost in white."
```

- [ ] **Step 3: Add the Change Log entry**

At the top of the Change Log (under `## Change Log`), insert:

```markdown
- 2026-08-05 — feat(ui): Summer weather widget visuals — realistic layered palm silhouettes + accent-orange temperatures on a frosted content panel (`src/components/ui/WeatherWidget.tsx`, single-file visual change). New `PalmSilhouette` component replaces the two stroke-silhouette palms in the `SummerBackdrop` day branch: tapered trunk with `#7c4a1e→#2d1810` gradient + ring texture, dark crown shadow mass, 7 two-tone fronds (sunlit `#16a34a` up-right, shadow `#15803d` below) with midrib veining, coconut accents; foreground opacity 0.22→0.28, distant palm 0.6× at opacity 0.14→0.18 with cooler tones (`#166534`/`#14532d`). Content overlay `backdropFilter` `blur(0px)`→`blur(14px) saturate(1.3)` with cool slate tint `rgba(15,23,42,0.28→0.18)`, hairline border, 1rem radius. Main temp + forecast highs recolored white→accent `#d97706` (dark text-shadow `0 0 30px rgba(0,0,0,0.45)`); contrast bumps on feels-like (`white/55→70`), day labels (`white/50→65`), lows (`white/40→55`). Sun/halo/rays/ocean glow/heat shimmer and the night branch untouched; no new animation, no new deps. TS / lint / build clean.
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md UI change record for summer weather widget visuals"
```

---

## Self-Review

**Spec coverage:**
- Layered palms (trunk gradient + rings, crown shadow mass, 7 two-tone fronds + midribs, coconuts) → Task 1, Steps 1-3 ✓
- Left palm opacity 0.28 / right palm 0.18 + 0.6× + cooler tones → Task 1, Step 3 ✓
- Sun/halo/rays/ocean/shimmer untouched → Task 1 Step 5 visual check ✓
- Night branch untouched → Task 1 Step 5 ✓
- Main temp `#d97706` + dark glow → Task 2, Step 2 ✓
- Feels-like `white/70`, day labels `white/65`, highs accent, lows `white/55` → Task 2, Steps 3-5 ✓
- Frost panel (blur 14px saturate 1.3, slate tint, hairline border, 1rem) → Task 2, Step 1 ✓
- Condition text stays white → intentionally absent from Task 2 ✓
- typecheck/lint/build + phone-width visual QA → Task 1/2 verification steps ✓
- AGENTS.md UI Change Record + snapshot + change log → Task 3 ✓

**Placeholder scan:** no TBD/TODO; every step has exact code or exact old→new strings. ✓

**Type consistency:** `PalmSilhouette` props `(x, y, scale, opacity, sunlit, shadow)` defined once in Task 1 Step 2 and used identically in Step 3. `accentHex.selected` referenced in Task 2 matches the existing variable at line 1703. ✓
