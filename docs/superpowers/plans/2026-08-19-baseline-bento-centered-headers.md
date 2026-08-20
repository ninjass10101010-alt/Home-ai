# Implementation Plan — 2026-08-19 — Baseline Bento + Centered Headers

- **Date:** 2026-08-19 (amended after plan review #1)
- **Status:** Approved (spec: `docs/superpowers/specs/2026-08-19-baseline-bento-centered-headers-design.md`)
- **Branch:** work on the current branch; commit per task (`feat(ui):` / `test(ui):` per repo convention)
- **Goal:** Give the Home widget grid a baseline bento — a fixed row unit with the weather card as the only enlarged 2×2 hero — and retire the protruding top-left icon on Home widgets in favor of centered, stacked icon+name card headers. Fixes the stretched weather widget and makes widgets of different sizes look uniform.

## Summary

- **Grid (desktop/tablet only):** fixed row unit `auto-rows-[350px]` + `grid-flow-dense`; every widget 1×1 except weather (2×2 hero) and the This Week footer (full-width). Phone stays `auto-rows-min` single column.
- **Headers:** Home widgets stop using `WidgetCard`'s protruding top-left icon slot (the slot itself stays in `WidgetCard` — non-Home pages are untouched) and render their own centered icons. `SectionCard` gains an opt-in `centeredHeader` prop: icon in a soft halo circle above a centered title/description, `action` floats top-right, body flexes so footers pin to the card bottom.
- **Weather:** icon moves from the protruding corner layer to a centered in-flow strip; the frosted panel fills the card (`flex-1`), location top / temp middle / details bottom.
- **Caps:** Daily Schedule shows 3 rows + `+N more · See all →` (→ `/calendar`); Consuela suggests 5→3 rows.
- **Settings help copy** updated to describe the bento.

## Key decisions (from the approved spec — do not re-litigate)

1. Row unit `350px` is a single literal everywhere (Tailwind scans class strings — never build classes dynamically). Verify in-browser against the tallest capped 1×1 card; if a card overflows, change the number in exactly four strings (homeGridClass ×2 + HOME_GRID_FALLBACK ×2) and re-verify.
2. Weather desktop span string (exact): `col-span-2 row-span-2 max-[743px]:col-span-1 max-[743px]:row-span-1` (guards narrow landscape phones). Tablet: `col-span-2 row-span-2`. Phone: `""`.
3. `grid-flow-dense` can place cards out of the user's saved visual order when weather is present — accepted trade-off (documented in spec); order is still the saved order, only auto-placement can differ.
4. `tabletSpan` (position-based) is replaced by tier-aware `tabletSpanFor(id, index, widgets)`: weather never stretches; the last 1×1 widget stretches to `col-span-2` only when the **number of 1×1 widgets in the visible list is odd** (a visible weather hero contributes 4 even cells, so raw widget-count parity would create a hole — verified by grid simulation of the default tablet order, weather at index 1).
5. `centeredHeader` is opt-in and used ONLY on Home cards. `WidgetCard` and the default (left-aligned) `SectionCard` path are **completely unchanged** — Kitchen/Settings/design-system keep the protruding icon exactly as today. Home consumers simply stop passing `icon` to `WidgetCard` and render their own centered icons.
6. `WIDGET_SPANS` (pre-mount fallback) stays all `col-span-1`; `HOME_GRID_FALLBACK` gains tier-aware rows (md + lg `auto-rows-[350px]` + `grid-flow-dense`).
7. Icons keep the halo treatment (`radial-gradient` + `weatherGlowPulse 7s` + drop-shadow) — only the placement changes. The existing reduced-motion rule (`globals.css:1275`, attribute selector `[style*="weatherGlowPulse"]`) already neutralizes the inline halos.
8. No new dependencies; no motion/keyframe changes.
9. `npm run typecheck` stays GREEN after every task (WidgetCard's icon prop is never removed — no intermediate red builds).

## File structure (files touched, in task order)

| File | Change |
|---|---|
| `src/lib/layout-config.ts` | `WIDGET_TIERS` map; `widgetSpanClass` via map; new `tabletSpanFor(id, index, widgets)`; `homeGridClass` bento rows; `HOME_GRID_FALLBACK` tiers |
| `tests/unit/layout-config.test.ts` | Red → green contract updates + new `tabletSpanFor` describe |
| `src/components/patterns/SectionCard.tsx` | `centeredHeader` prop only; default path untouched |
| `tests/unit/section-card.test.tsx` | NEW — centered-header contract (list-row.test.tsx pattern, no testing-library) |
| `src/app/globals.css` | `.widget-card` gains `display:flex; flex-direction:column` |
| `src/app/page.tsx` | `tabletSpanFor` wiring; aiQuickAsk centered + halo; `centeredHeader` on Today / Tasks / This Week; This Week content vertically centered |
| `src/components/ui/WeatherWidget.tsx` | icon in-flow centered; shell + panel flex-col fill |
| `src/components/ui/ScheduleDisplay.tsx` | centered header w/ 🕐; cap 3 + See-all footer; body flex |
| `src/components/meals/CurrentMealWidget.tsx` | centered header + vertically centered content |
| `src/components/briefing/MorningBriefingWidget.tsx` | `centeredHeader`; acknowledged state centered; expanded content scrolls |
| `src/components/suggestions/HomeSuggestionsWidget.tsx` | `centeredHeader` ×3; cap 5→3 |
| `src/components/leaderboard/HomeLeaderboardWidget.tsx` | `centeredHeader` ×4 |
| `src/app/settings/page.tsx` | help modal bento sentence |
| `AGENTS.md` + spec doc | mandatory same-session AGENTS.md update; amend spec §1 tablet example + span wording (Task 10) |

---

## Task 1 — Layout tiers: grid rows + spans (`test(ui)` red → `feat(ui)` green)

### 1a. Tests first (red)

Update `tests/unit/layout-config.test.ts` (add `WidgetDef` to the imports):

```ts
// homeGridClass describe — replace the tablet + desktop `it` bodies and the fallback `it`:
it('renders the 2-column bento for tablet', () => {
  const cls = homeGridClass('tablet');
  expect(cls).toContain('grid-cols-2');
  expect(cls).toContain('auto-rows-[350px]');
  expect(cls).toContain('grid-flow-dense');
  expect(cls).not.toContain('auto-rows-min');
  expect(cls).not.toContain('flex');
});

it('renders the auto-fit tiling grid for desktop', () => {
  const cls = homeGridClass('desktop');
  expect(cls).toContain('grid');
  expect(cls).toContain('auto-rows-[350px]');
  expect(cls).toContain('grid-flow-dense');
  expect(cls).toContain('gap-6');
  expect(cls).toContain('grid-cols-[repeat(auto-fit,minmax(360px,1fr))]');
  expect(cls).not.toContain('auto-rows-min');
  expect(cls).not.toContain('flex');
  expect(cls).not.toContain('overflow-x-auto');
});

it('falls back to a responsive grid with tier-aware rows', () => {
  expect(HOME_GRID_FALLBACK).toContain('lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))]');
  expect(HOME_GRID_FALLBACK).toContain('md:grid-cols-2');
  expect(HOME_GRID_FALLBACK).toContain('md:auto-rows-[350px]');
  expect(HOME_GRID_FALLBACK).toContain('md:grid-flow-dense');
  expect(HOME_GRID_FALLBACK).toContain('lg:auto-rows-[350px]');
  expect(HOME_GRID_FALLBACK).toContain('lg:grid-flow-dense');
});
```

Replace the `widgetSpanClass` describe:

```ts
describe('widgetSpanClass', () => {
  it('applies no spans in phone (single-column stack)', () => {
    expect(widgetSpanClass('weather', 'phone')).toBe('');
    expect(widgetSpanClass('leaderboard', 'phone')).toBe('');
  });

  it('makes weather the 2×2 hero on tablet and desktop', () => {
    expect(widgetSpanClass('weather', 'tablet')).toBe('col-span-2 row-span-2');
    expect(widgetSpanClass('weather', 'desktop')).toBe('col-span-2 row-span-2 max-[743px]:col-span-1 max-[743px]:row-span-1');
  });

  it('keeps every other widget a uniform 1×1', () => {
    expect(widgetSpanClass('morningBriefing', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('consuelaSuggestions', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('leaderboard', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('tasks', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('morningBriefing', 'desktop')).toBe('');
    expect(widgetSpanClass('leaderboard', 'desktop')).toBe('');
    expect(widgetSpanClass('currentMeal', 'desktop')).toBe('');
  });

  it('falls back safely for unknown ids', () => {
    expect(widgetSpanClass('bogus' as never, 'tablet')).toBe('');
    expect(widgetSpanClass('bogus' as never, 'desktop')).toBe('');
  });
});
```

Add a new describe (after `tabletSpan` — the old `tabletSpan` tests stay):

```ts
describe('tabletSpanFor (tier-aware, hole-free with the weather hero)', () => {
  const defs = (ids: WidgetId[]): WidgetDef[] => ids.map((id) => ({ id, label: id, emoji: "x", description: "" }));
  const defaultNine = defs(["morningBriefing", "weather", "aiQuickAsk", "consuelaSuggestions", "leaderboard", "todayEvents", "schedule", "currentMeal", "tasks"]);
  const eightNoWeather = defs(["morningBriefing", "aiQuickAsk", "consuelaSuggestions", "leaderboard", "todayEvents", "schedule", "currentMeal", "tasks"]);
  const eightWithWeather = defs(["morningBriefing", "weather", "aiQuickAsk", "consuelaSuggestions", "leaderboard", "schedule", "currentMeal", "tasks"]); // todayEvents hidden → 7 one-by-ones

  it('keeps the weather hero untouched wherever it sits', () => {
    expect(tabletSpanFor("weather", 1, defaultNine)).toBe('col-span-2 row-span-2');
    expect(tabletSpanFor("weather", 0, defs(["weather"]))).toBe('col-span-2 row-span-2');
    expect(tabletSpanFor("weather", 2, defs(["tasks", "morningBriefing", "weather"]))).toBe('col-span-2 row-span-2');
  });

  it('does NOT stretch the last widget of the default 9 (weather makes 8 one-by-ones — even)', () => {
    // Regression: stretching here would leave a hole at r6c2 with dense flow.
    expect(tabletSpanFor("tasks", 8, defaultNine)).toBe('col-span-1');
  });

  it('does not stretch when all 8 visible are one-by-ones (even)', () => {
    expect(tabletSpanFor("tasks", 7, eightNoWeather)).toBe('col-span-1');
  });

  it('stretches the last one-by-one when their count is odd (weather visible)', () => {
    expect(tabletSpanFor("tasks", 7, eightWithWeather)).toBe('col-span-2');
    expect(tabletSpanFor("currentMeal", 6, eightWithWeather)).toBe('col-span-1');
  });

  it('stretches a lone one-by-one widget to the full row', () => {
    expect(tabletSpanFor("tasks", 0, defs(["tasks"]))).toBe('col-span-2');
  });
});
```

Run: `npx vitest run tests/unit/layout-config.test.ts` → expect failures only in the touched describes.

### 1b. Implementation (green)

In `src/lib/layout-config.ts`:

1. Add the tier map right after `ALL_WIDGETS`:

```ts
/**
 * Per-widget tier spans per layout mode. Weather is the only enlarged
 * widget (2×2 hero on tablet + desktop); everything else is 1×1.
 * Phone always returns "" (single-column stack).
 */
export const WIDGET_TIERS: Record<WidgetId, { phone: string; tablet: string; desktop: string }> = {
  morningBriefing: { phone: "", tablet: "col-span-1", desktop: "" },
  weather: {
    phone: "",
    tablet: "col-span-2 row-span-2",
    desktop: "col-span-2 row-span-2 max-[743px]:col-span-1 max-[743px]:row-span-1",
  },
  aiQuickAsk: { phone: "", tablet: "col-span-1", desktop: "" },
  consuelaSuggestions: { phone: "", tablet: "col-span-1", desktop: "" },
  leaderboard: { phone: "", tablet: "col-span-1", desktop: "" },
  todayEvents: { phone: "", tablet: "col-span-1", desktop: "" },
  schedule: { phone: "", tablet: "col-span-1", desktop: "" },
  currentMeal: { phone: "", tablet: "col-span-1", desktop: "" },
  tasks: { phone: "", tablet: "col-span-1", desktop: "" },
};
```

2. `homeGridClass` — replace the return strings (keep the switch):

```ts
case "desktop":
  return "grid gap-6 grid-flow-dense auto-rows-[350px] grid-cols-[repeat(auto-fit,minmax(360px,1fr))]";
case "tablet":
  return "grid grid-cols-2 gap-6 grid-flow-dense auto-rows-[350px]";
case "phone":
  return "grid grid-cols-1 gap-6 auto-rows-min";
```

3. `HOME_GRID_FALLBACK`:

```ts
export const HOME_GRID_FALLBACK = "grid grid-cols-1 md:grid-cols-2 md:auto-rows-[350px] md:grid-flow-dense lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))] lg:auto-rows-[350px] lg:grid-flow-dense gap-6 auto-rows-min";
```

4. `widgetSpanClass` — replace the switch body with the tier lookup (same signature):

```ts
export function widgetSpanClass(id: WidgetId, mode: LayoutMode): string {
  return WIDGET_TIERS[id]?.[mode] ?? "";
}
```

5. Add `tabletSpanFor` after `tabletSpan` (keep `tabletSpan` — its tests still cover the base rule):

```ts
/**
 * Tablet span for the widget at `index` of the visible `widgets` list,
 * honoring widget tiers: the weather hero never stretches (it already
 * spans the full row). The last one-by-one widget stretches to fill the
 * row ONLY when the count of one-by-one widgets is odd — counting raw
 * widgets would be wrong while weather is visible (its 2×2 = 4 even cells
 * flip the parity and the stretch would create a hole).
 */
export function tabletSpanFor(id: WidgetId, index: number, widgets: WidgetDef[]): string {
  const tier = WIDGET_TIERS[id]?.tablet ?? "col-span-1";
  if (tier !== "col-span-1") return tier;
  const oneByOneCount = widgets.filter((w) => (WIDGET_TIERS[w.id]?.tablet ?? "col-span-1") === "col-span-1").length;
  return index === widgets.length - 1 && oneByOneCount % 2 === 1 ? "col-span-2" : "col-span-1";
}
```

Run the full suite; commit: `test(ui): baseline bento grid contract (red)` then `feat(ui): baseline bento grid — row unit + weather hero tiers`.

---

## Task 2 — SectionCard `centeredHeader` + widget-card flex shell (`test(ui)` red → `feat(ui)` green)

`WidgetCard` is NOT touched in this task (its icon prop and protruding rendering stay for the non-Home pages).

### 2a. Tests first (red)

New `tests/unit/section-card.test.tsx` (follows the `list-row.test.tsx` pattern — `// @vitest-environment jsdom`, `createRoot` + `act`, no testing-library):

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import SectionCard from "@/components/patterns/SectionCard";

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

describe("SectionCard centered header", () => {
  it("stacks icon above a centered title when centeredHeader is set", () => {
    const card = render(
      <SectionCard title="Today's Events" description="3 today" icon="📅" compact centeredHeader>
        <p>body</p>
      </SectionCard>
    );
    expect(card.textContent).toContain("📅");
    const h3 = Array.from(card.querySelectorAll("h3")).find((h) => h.textContent === "Today's Events");
    expect(h3?.className).toContain("text-sm");
    expect(card.querySelector("[class*='text-center']")).not.toBeNull();
  });

  it("does not pass the icon to the protruding WidgetCard slot in centered mode", () => {
    const card = render(<SectionCard title="T" icon="📅" centeredHeader><p>body</p></SectionCard>);
    // The protruding slot renders the icon inside a 56px layer with an
    // absolute halo; centered mode renders the icon in-flow instead.
    const absoluteLayer = Array.from(card.querySelectorAll("div")).find((d) => d.className.includes("absolute") && d.className.includes("inset"));
    expect(absoluteLayer).toBeUndefined();
  });

  it("keeps the default left-aligned header untouched (pl-14 + protruding icon)", () => {
    const card = render(<SectionCard title="Add to Pantry" icon="➕"><p>body</p></SectionCard>);
    expect(card.querySelector("h3")?.textContent).toBe("Add to Pantry");
    const header = card.children[0] as HTMLElement;
    expect(header.className).toContain("pl-14");
  });

  it("floats the action absolutely in the centered header", () => {
    const card = render(
      <SectionCard title="T" centeredHeader action={<a href="/x">See all →</a>}>
        <p>body</p>
      </SectionCard>
    );
    expect(card.querySelector("a")?.parentElement?.className).toContain("absolute");
  });

  it("gives the centered body flex-col flex-1 so footers pin and content can scroll", () => {
    const card = render(<SectionCard title="T" centeredHeader><p>body</p></SectionCard>);
    const body = card.children[1] as HTMLElement;
    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("flex-col");
  });
});
```

Run: `npx vitest run tests/unit/section-card.test.tsx` → red (no `centeredHeader` prop yet; centered markup absent).

### 2b. Implementation (green)

**`src/components/patterns/SectionCard.tsx`** — add the `centeredHeader` branch and the prop; leave the existing default branch EXACTLY as-is (it still passes `icon` to `WidgetCard`):

```tsx
"use client";

import type { ReactNode } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
  /** Center the icon above a centered title (Home widgets). Default: left-aligned header with the protruding icon. */
  centeredHeader?: boolean;
}

export default function SectionCard({
  title,
  description,
  icon,
  action,
  tone,
  children,
  footer,
  className = "",
  compact = false,
  centeredHeader = false,
}: SectionCardProps) {
  if (centeredHeader) {
    return (
      <WidgetCard tone={tone} className={className}>
        <div className="relative shrink-0 border-b border-white/10 p-4 pb-3 text-center">
          {action && <div className="absolute right-3 top-3">{action}</div>}
          {icon && (
            <div className="relative mx-auto h-9 w-9">
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle, color-mix(in srgb, var(--widget-tone) 40%, transparent) 0%, color-mix(in srgb, var(--widget-tone) 0%, transparent) 70%)`,
                  filter: "blur(8px)",
                  animation: "weatherGlowPulse 7s ease-in-out infinite",
                }}
              />
              <div
                className="relative grid h-9 w-9 place-items-center text-xl leading-none"
                style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))" }}
              >
                {icon}
              </div>
            </div>
          )}
          <h3 className={`mt-1.5 font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</h3>
          {description && <p className={`mt-0.5 text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>{description}</p>}
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${compact ? "p-4" : "p-5"}`}>{children}</div>
        {footer && <div className={`border-t border-white/10 ${compact ? "p-4" : "p-5"}`}>{footer}</div>}
      </WidgetCard>
    );
  }

  // Default path: unchanged from today (icon passes through to WidgetCard's protruding slot).
  return (
    <WidgetCard tone={tone} icon={icon} className={className}>
      <div className={`flex items-start justify-between gap-4 border-b border-white/10 ${compact ? "p-4 pl-14" : "p-5 pl-14"}`}>
        <div className="min-w-0">
          <h3 className={`font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</h3>
          {description && <p className={`mt-0.5 text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>{description}</p>}
        </div>
        {action && <div className="shrink-0 self-center">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${compact ? "p-4" : "p-5"}`}>{children}</div>
      {footer && <div className={`border-t border-white/10 ${compact ? "p-4" : "p-5"}`}>{footer}</div>}
    </WidgetCard>
  );
}
```

(Verify the default branch matches the current file exactly before editing — the centered branch is the only addition.)

**`src/app/globals.css`** — in `.widget-card` (after `overflow: visible;`):

```css
  display: flex;
  flex-direction: column;
```

Run `npx vitest run` (all green) + `npm run typecheck` (green — nothing removed) + `npm run lint` (0 new). Commit: `test(ui): centered header contract (red)` then `feat(ui): section-card centered headers + widget-card flex shell`.

---

## Task 3 — Home page wiring (`feat(ui)`)

`src/app/page.tsx`:

1. Import: replace `tabletSpan` with `tabletSpanFor` in the layout-config import (the span line is `tabletSpan`'s only call site — do not leave it imported).

2. Span line (currently `page.tsx:314-318`):

```tsx
const span = layoutMounted
  ? orientation === "tablet"
    ? tabletSpanFor(id, index, visibleWidgets)
    : widgetSpanClass(id, orientation)
  : (WIDGET_SPANS[id] ?? "lg:col-span-1");
```

3. `aiQuickAsk` case (currently `page.tsx:416-435`) — replace the WidgetCard block (stop passing `icon`, render a centered halo'd Icon3D):

```tsx
<WidgetCard tone="#8b5cf6" className="h-full">
  <div className="relative z-30 pointer-events-none flex justify-center pt-5">
    <div className="relative h-14 w-14">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle, rgba(139,92,246,0.4) 0%, transparent 70%)",
          filter: "blur(8px)",
          animation: "weatherGlowPulse 7s ease-in-out infinite",
        }}
      />
      <div className="relative" style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))" }}>
        <span className="grid h-14 w-14 place-items-center"><Icon3D variant="chat" size="md" /></span>
      </div>
    </div>
  </div>
  <div className="flex flex-1 flex-col items-center justify-center gap-1 p-5 text-center">
    <div className="flex items-center gap-2">
      <h3 className="text-base font-bold text-text-primary">Quick ask</h3>
      <span className="widget-accent-text">→</span>
    </div>
    <p className="text-sm text-text-secondary">“Add soccer practice for Thursday.”</p>
  </div>
</WidgetCard>
```

4. Add `centeredHeader` to the three SectionCards on this page (all already `compact`):
   - **"Today"** card (`tone="#3b82f6"`, title "Today", `page.tsx:342` — note: the title is "Today", not "Today's Events")
   - **Tasks** card (`tone="#f43f5e"`, title "Tasks")
   - **This Week** footer (`tone="#10b981"`, `page.tsx:443`) — and wrap its body content so the DayStrip centers vertically in the 350px row:

```tsx
<div className="flex flex-1 items-center">
  <DayStrip value="today" onChange={(dayId) => router.push(`/meals?day=${dayId}`)} days={weekDays} compact />
</div>
```

(Without this, the full-width footer row is a fixed 350px and the ~150px compact DayStrip leaves ~180px of dead space at the card's bottom.)

Leave all other props (footers, See-all links) unchanged.

Verify: `npm run typecheck`, `npm run lint` (0 new), `npx vitest run`. Commit: `feat(ui): home grid span wiring + centered quick-ask card`.

---

## Task 4 — Weather widget restructure (`feat(ui)`)

`src/components/ui/WeatherWidget.tsx` — four surgical edits:

1. **Icon layer** (currently `:1766-1789`, the `absolute z-30 pointer-events-none` protruding block) → in-flow centered:

```tsx
{/* ── Weather icon (centered top strip) ── */}
<div className="relative z-30 pointer-events-none flex justify-center pt-5">
  <div className="relative w-[96px] h-[96px]">
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle, ${accentHex.selected}66 0%, ${accentHex.selected}00 70%)`,
        filter: "blur(10px)",
        animation: mounted ? "weatherGlowPulse 7s ease-in-out infinite" : undefined,
      }}
    />
    <div style={{ filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.35))" }}>
      {mounted ? (
        <div style={{ transform: "scale(1.3333)", transformOrigin: "top left" }}>
          <Icon tod={tod} />
        </div>
      ) : (
        <div className="w-[96px] h-[96px] flex items-center justify-center text-7xl leading-none">⛅</div>
      )}
    </div>
  </div>
</div>
```

2. **Shell** (currently `:1790-1798`): `className` → `"rounded-2xl overflow-hidden relative h-full flex flex-col"` (style unchanged, `minHeight: "220px"` stays).

3. **Frosted panel wrapper** (currently `:1832-1840`): `className` → `"relative z-20 flex flex-1 min-h-0 flex-col p-5"` (drop `pl-[80px]`; keep the backdrop-filter/background/border/radius styles on this div).

4. **Main display row** (currently `:1872`): `<div className="flex items-center gap-3 mb-4">` → `<div className="flex flex-1 items-center gap-3 mb-4">` (the row absorbs the middle space, pinning the toggle + expandable panel to the bottom; on phone, the auto-height card keeps natural sizes).

Header (location) row and the °F/°C pill are untouched; expandable panel behavior untouched.

**Height math (verified against the actual JSX):** hero cell = 2×350 + 24 gap = 724px; icon strip ≈ 116px; frosted panel gets ≈ 608px; content (header ≈ 38 + main row ≈ 122 + toggle ≈ 30 + expanded content ≈ 250, under the 440px maxHeight cap) fits with ~128px slack absorbed by the flex-1 main row — no clipping, expanded or collapsed. Phone collapsed ≈ 346px / expanded ≈ 596px, both above the 220px min-height floor.

Verify: typecheck + build. Commit: `feat(ui): weather widget — centered icon + full-card frosted panel`.

---

## Task 5 — Daily Schedule cap + centered header (`feat(ui)`)

`src/components/ui/ScheduleDisplay.tsx` (only consumer is `page.tsx:372` — safe to hard-cap):

1. Imports: add `import Link from "next/link";` (keep the rest).

2. **Empty state** (currently `:81-92`): `<WidgetCard tone="#22d3ee" icon="🕐" className={className}>` → drop `icon="🕐"`, and the empty body wrapper → `<div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-text-muted">` (keeps the same svg + copy).

3. **Main render** (currently `:128-186`):
   - `<WidgetCard tone="#22d3ee" icon="🕐" ...>` → drop `icon`.
   - Header (currently `:130-135`) → centered compact header with the icon:

```tsx
<div className="flex flex-col items-center border-b border-white/10 p-4 text-center">
  <div className="relative h-9 w-9">
    <div aria-hidden="true" className="absolute inset-0" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.4) 0%, transparent 70%)", filter: "blur(8px)", animation: "weatherGlowPulse 7s ease-in-out infinite" }} />
    <div className="relative grid h-9 w-9 place-items-center text-xl leading-none" style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))" }}>🕐</div>
  </div>
  <h2 className="mt-1.5 text-sm font-bold text-text-primary">{title}</h2>
  <span className="mt-0.5 text-[10px] font-medium text-text-muted">{upcomingCount} upcoming</span>
</div>
```

   - Body (currently `:136-184`): `<div className="p-5">` → `<div className="flex min-h-0 flex-1 flex-col p-5">`; the rows wrapper `space-y-2` gets `flex-1`; the "All done for today 🎉" branch gets `flex flex-1 flex-col items-center justify-center gap-2 py-4 text-text-muted`.
   - Cap + footer, right after the rows wrapper closes and before the body div closes:

```tsx
{sortedSchedule.length > 3 && (
  <div className="mt-3 border-t border-white/10 pt-3">
    <Link href="/calendar" className="tap-sm text-xs font-semibold widget-accent-text">
      +{sortedSchedule.length - 3} more · See all →
    </Link>
  </div>
)}
```

   - Rows list renders `sortedSchedule.slice(0, 3).map(...)` instead of `sortedSchedule.map(...)` (single change inside the existing ternary; the `sortedSchedule.length === 0` branch already handles the empty case).

Verify: typecheck/lint/build. Commit: `feat(ui): daily schedule — centered header + 3-row cap with See-all`.

---

## Task 6 — Current meal centered (`feat(ui)`)

`src/components/meals/CurrentMealWidget.tsx` (only consumer: `page.tsx:380`):

1. `<WidgetCard tone="#10b981" icon="🍽️" className={className}>` → drop `icon="🍽️"`.
2. Insert the centered 🍽️ icon strip directly inside the card, before the floating-emoji block:

```tsx
<div className="relative z-30 pointer-events-none flex justify-center pt-5">
  <div className="relative h-9 w-9">
    <div aria-hidden="true" className="absolute inset-0" style={{ background: "radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%)", filter: "blur(8px)", animation: "weatherGlowPulse 7s ease-in-out infinite" }} />
    <div className="relative grid h-9 w-9 place-items-center text-xl leading-none" style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))" }}>🍽️</div>
  </div>
</div>
```

3. Content wrapper (currently `:121`): `<div className="relative z-10 p-5 pl-14">` → `<div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center p-5">` (vertically centers the meal block in the 350px cell).
4. Header row (currently `:123-139`): `flex items-center justify-between mb-2` → `flex items-center justify-center gap-2` (drop `mb-2`; keep the h2 with the pulsing icon + time badge inline — the pair reads centered).
5. Subtitle (currently `:141`): add `text-center` (keep `text-xs text-text-secondary mb-4`).

Verify: typecheck/lint/build. Commit: `feat(ui): current meal widget — centered icon + content`.

---

## Task 7 — Suggestions cap 5→3 (`feat(ui)`)

`src/components/suggestions/HomeSuggestionsWidget.tsx`:

1. `items.slice(0, 5)` (`:157`) → `items.slice(0, 3)`.
2. Pre-mount skeleton SectionCard (`:106`): add `centeredHeader` + `className={className}`.
3. Empty-state SectionCard (`:122-128`): add `centeredHeader`.
4. Main SectionCard (`:141-148`): add `centeredHeader`.
(The "See all →" action already exists; it now floats top-right via the centered header — no copy change needed.)

Verify: typecheck/lint/build. Commit: `feat(ui): consuela suggests — 3-row cap + centered headers`.

---

## Task 8 — Leaderboard + briefing centered (`feat(ui)`)

`src/components/leaderboard/HomeLeaderboardWidget.tsx` — add `centeredHeader` to all four SectionCards (skeleton `:115`, empty `:130`, main `:149`; description `Resets in N days` stays under the centered title). No other changes.

`src/components/briefing/MorningBriefingWidget.tsx`:
1. Active SectionCard (`:102-118`): add `centeredHeader` (the count-badge `action` now floats top-right — no copy change).
2. Acknowledged WidgetCard (`:88-96`): drop `icon="🌅"`; insert the centered icon strip (same pattern as Task 6 with `rgba(249,115,22,0.4)` halo) above the content; content wrapper `<div className="flex items-center gap-3 p-5 pl-14">` → `<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-5 text-center">` with the Chip kept inside (renders under the title — keep the copy).
3. Expanded body (`:121`): `<div className="space-y-4">` → `<div className="min-h-0 flex-1 space-y-4 overflow-y-auto">` (the SectionCard centered body is already `flex flex-col` from Task 2, so this now actually scrolls inside the 350px cell instead of spilling — verified: `.widget-card` has `overflow: visible`, so an un-constrained child would overflow the card with no scrollbar).

Verify: `npm run typecheck` (green), `npm run lint` (0 new), `npx vitest run`. Commit: `feat(ui): leaderboard + briefing — centered headers and internal scroll`.

---

## Task 9 — Settings help copy (`docs(ui)`)

`src/app/settings/page.tsx`, help modal (`:932`) — the paragraph after the **Phone / Tablet / Desktop** bold label has three sentences; replace the THIRD sentence (the one starting "On tablet every widget is the same size…", which now contradicts the weather hero) with:

> On tablet and desktop the widgets tile into a bento grid with the weather card as the larger two-by-two hero and every other card a uniform square; on tablet, when there's an odd number of square cards, the last one stretches across the full row.

(Keep the first sentence — tab switching — and the Reset paragraph as-is.)

Verify: build. Commit: `docs(ui): layout help copy describes the bento`.

---

## Task 10 — Full verification + docs (mandatory)

1. **Automated:** `npx vitest run` (baseline 149/150 with 1 pre-existing PB-env integration failure — all layout-config + section-card tests green), `npm run typecheck`, `npm run lint` (0 new; 73 pre-existing warnings), `npm run build`.
2. **Browser (Playwright via the webapp-testing skill):** `npm run dev`, then at **390 / 768 / 1440** (dark + light):
   - Weather is the only 2×2 card (1440); on 768 it spans both columns + 2 rows; on 390 it's the normal stack.
   - **No holes in the tablet grid with the default order** (the C1 regression): at 768px portrait, expect 6 complete rows — r1 briefing + quick-ask, r2–3 weather hero, r4 suggestions + leaderboard, r5 events + schedule, r6 meal + tasks — with no empty half-cell.
   - No holes on desktop (dense flow fills; accepted trade-off).
   - Tallest capped 1×1 card (expect Daily Schedule at 3 rows + See-all footer) does not overflow its 350px row — if it does, bump the row unit in the four class strings (Task 1 list) and re-verify.
   - Icons + titles centered on every Home card; `action` links top-right, not overlapping the centered title — check explicitly at 768px where columns are ~356px wide (M7).
   - This Week footer: DayStrip vertically centered in the 350px row, no dead space.
   - Schedule cap: 4+ schedule items seeded → 3 rows + `+N more · See all →`, link lands on `/calendar`.
   - Suggestions: 4+ suggestions → 3 rows + See all.
   - Briefing expanded: long content scrolls internally, footer pinned.
   - Weather expanded ("More details"): full forecast visible inside the hero, no clipping.
   - Kitchen page (e.g. `/meals`): SectionCard headers byte-identical to before (protruding icon intact — the default path was untouched).
   - `prefers-reduced-motion`: halo pulse disabled (existing rule).
3. **Spec amendments** (the spec's §1 tablet example and §2 span wording are wrong in light of C1 — fix them so the spec matches the implementation):
   - §1: the tablet example must use the TABLET default order (weather at index 1): r1 = briefing + quick-ask, r2–3 = weather hero, then pairs — and note the footer row is a fixed 350px row with the DayStrip centered.
   - §2: `tabletSpanFor` stretches the last 1×1 widget only when the visible count of 1×1 widgets is odd (not the raw widget count).
4. **AGENTS.md (same session, mandatory):**
   - "Current Dashboard Snapshot" paragraph: add the baseline bento description (row unit 350px, weather 2×2 hero, dense flow, centered stacked headers on Home, Schedule cap 3, suggestions 5→3, phone unchanged, non-Home SectionCards unchanged).
   - New `### UI Change Record — 2026-08-19 — Baseline bento: fixed row unit, weather hero, centered headers` (files, visual/motion, color sources, user-facing description, agent action required).
   - Change Log entry referencing the plan + spec paths and the commits.
5. Commit: `feat(ui): baseline bento + centered widget headers (final)` — or verify the per-task commits cover everything and AGENTS.md is committed last.

## Known risks / watch items

- `grid-flow-dense` + weather 2×2 can reorder placement around the hero depending on the saved order — accepted (spec trade-offs); the parity rule in `tabletSpanFor` guarantees no holes for any visibility combination on tablet (1×1 count parity is the invariant).
- The row unit is duplicated in 4 class strings (homeGridClass ×2 + HOME_GRID_FALLBACK ×2) — keep in sync when tuning.
- `max-[743px]:` arbitrary variant is supported by Tailwind v4 out of the box.
- Phone layout intentionally unchanged (`auto-rows-min`); the phone weather card grows taller by the in-flow icon strip (~116px) — that is the designed centered-icon look.