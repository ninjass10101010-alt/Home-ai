# Fill-the-Space Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop sideways filmstrip with an auto-fit tiling grid, make cards stretch to fill their grid row, and let a lone odd widget on tablet fill the whole row.

**Architecture:** Three coordinated changes in the Home layout: (1) `src/lib/layout-config.ts` desktop bucket becomes a CSS grid with `repeat(auto-fit, minmax(360px, 1fr))` columns (all widgets tile into as many uniform columns as the screen fits, vertical scroll), `widgetSpanClass("desktop")` returns `""`, footer spans the full row, `WIDGET_WIDTHS` deleted; (2) a new pure `tabletSpan(index, count)` helper makes the last widget of an odd tablet count span both columns; (3) cards gain `h-full` so they fill their (grid-stretched) wrapper height — no vertical gaps under short cards. Widgets that own their card root get a `className` pass-through prop; `SectionCard`/`ScheduleDisplay`/`WidgetCard` already accept `className`.

**Tech Stack:** Next.js 16 (app router), React 19, Tailwind CSS 4, Vitest (jsdom), TypeScript.

## Global Constraints

- Repo root for all work: `/Users/garciafam/Documents/Dashboard/Home-ai` (branch `warm-glass-v2`).
- Do NOT touch `public/version.json` (pre-existing dirty state).
- AGENTS.md must be updated (snapshot + UI Change Record + Change Log) in the same session as the UI change — Task 5.
- Pre-existing lint baseline: 52 errors / 21 warnings — 0 new allowed in changed files.
- Known pre-existing test failure (NOT a regression): `tests/integration/api-routes.test.ts` → "GET /api/consuela/suggestions returns pending suggestions list" (needs live PocketBase env).
- Build quirk: after `npm run build`, if CSS looks broken, `docker restart consuela-dashboard` (or restart the local `next start` server).
- Phone mode is unchanged. Tablet stays `grid-cols-2`. The tablet footer stays `col-span-2`.
- Tailwind scans `src/**` for static class strings — arbitrary-value classes like `grid-cols-[repeat(auto-fit,minmax(360px,1fr))]` (no spaces, commas allowed) are picked up from `layout-config.ts` automatically.

---

### Task 1: layout-config.ts — auto-fit desktop grid + tabletSpan helper (TDD)

**Files:**
- Modify: `src/lib/layout-config.ts`
- Test: `tests/unit/layout-config.test.ts`

**Interfaces:**
- Produces: `tabletSpan(index: number, count: number): string` — returns `"col-span-2"` when `index === count - 1 && count % 2 === 1`, else `"col-span-1"`. Used by Task 2.
- Produces: `homeGridClass("desktop")` → `"grid gap-6 auto-rows-min grid-cols-[repeat(auto-fit,minmax(360px,1fr))]"`.
- Produces: `widgetSpanClass(id, "desktop")` → `""` for any id (incl. unknown).
- Produces: `homeFooterSpanClass("desktop")` → `"col-span-full"`.
- Produces: `HOME_GRID_FALLBACK` → `"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-6 auto-rows-min"`.
- Removes: `WIDGET_WIDTHS` (deleted entirely; nothing else imports it — verified).

- [ ] **Step 1: Write the failing tests**

Edit `tests/unit/layout-config.test.ts`:

1. Replace the `homeGridClass` desktop test (`it('renders the horizontal filmstrip for desktop', ...)`):

```ts
  it('renders the auto-fit tiling grid for desktop', () => {
    const cls = homeGridClass('desktop');
    expect(cls).toContain('grid');
    expect(cls).toContain('auto-rows-min');
    expect(cls).toContain('gap-6');
    expect(cls).toContain('grid-cols-[repeat(auto-fit,minmax(360px,1fr))]');
    expect(cls).not.toContain('flex');
    expect(cls).not.toContain('overflow-x-auto');
    expect(cls).not.toContain('snap-x');
  });
```

2. Replace the `widgetSpanClass` desktop test (`it('applies the uniform filmstrip width in desktop', ...)`):

```ts
  it('applies no spans in desktop (auto-fit grid sizes the columns)', () => {
    expect(widgetSpanClass('weather', 'desktop')).toBe('');
    expect(widgetSpanClass('leaderboard', 'desktop')).toBe('');
    expect(widgetSpanClass('currentMeal', 'desktop')).toBe('');
  });
```

3. Update the unknown-id fallback test:

```ts
  it('falls back safely for unknown ids', () => {
    expect(widgetSpanClass('bogus' as never, 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('bogus' as never, 'desktop')).toBe('');
  });
```

4. Replace the `homeFooterSpanClass` desktop test (`it('is a filmstrip item in desktop', ...)`):

```ts
  it('spans the full row in desktop', () => {
    expect(homeFooterSpanClass('desktop')).toBe('col-span-full');
  });
```

5. Add a new describe block after `homeFooterSpanClass`:

```ts
describe('tabletSpan', () => {
  it('keeps every widget col-span-1 when the visible count is even', () => {
    expect(tabletSpan(0, 8)).toBe('col-span-1');
    expect(tabletSpan(3, 8)).toBe('col-span-1');
    expect(tabletSpan(7, 8)).toBe('col-span-1');
  });

  it('stretches the last widget to the full row when the count is odd', () => {
    expect(tabletSpan(0, 9)).toBe('col-span-1');
    expect(tabletSpan(5, 9)).toBe('col-span-1');
    expect(tabletSpan(8, 9)).toBe('col-span-2');
  });

  it('stretches a single widget to the full row', () => {
    expect(tabletSpan(0, 1)).toBe('col-span-2');
  });
});
```

6. Add a `HOME_GRID_FALLBACK` test inside the `homeGridClass` describe:

```ts
  it('falls back to a responsive grid with the auto-fit lg tier', () => {
    expect(HOME_GRID_FALLBACK).toContain('lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))]');
    expect(HOME_GRID_FALLBACK).toContain('md:grid-cols-2');
  });
```

7. Update the import list at the top of the test file:

```ts
import {
  homeGridClass,
  widgetSpanClass,
  homeFooterSpanClass,
  tabletSpan,
  WIDGET_SPANS,
  computeLayoutMode,
  cloneDefaultLayout,
  loadLayoutConfig,
  saveLayoutConfig,
  DEFAULT_LAYOUT,
  HOME_GRID_FALLBACK,
  LAYOUT_STORAGE_KEY,
  type WidgetId,
} from '@/lib/layout-config';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: FAIL — desktop grid test still sees `flex`; `tabletSpan` is not exported; desktop span expectations mismatch.

- [ ] **Step 3: Implement in `src/lib/layout-config.ts`**

3a. Update the file header comment (lines 1–7) — remove the filmstrip description:

```ts
// ─── Home Page Layout Config ──────────────────────────────────────────────
// Allows users to show/hide and reorder widgets on the home page.
// Persisted to localStorage. Layouts are configured per layout mode:
// "phone" (single-column vertical stack, portrait <700px), "tablet"
// (uniform 2-column pairing grid, portrait 700–1279px) and "desktop"
// (auto-fit tiling grid: repeat(auto-fit, minmax(360px, 1fr)) columns fill
// the viewport width with uniform cards; scrolls vertically).
```

3b. Delete the `WIDGET_WIDTHS` block (lines 118–135) and its doc comment.

3c. Replace `homeGridClass`:

```ts
/**
 * Grid classes for the Home layout. Desktop is an auto-fit tiling grid:
 * `repeat(auto-fit, minmax(360px, 1fr))` fits as many uniform 360px-plus
 * columns as the viewport holds (3 at 1440px, 5–6 at 2560px, 2 at 1024px
 * landscape) so every widget is visible at once and the page scrolls
 * vertically. Portrait keeps the single-column / 2-column stacks.
 */
export function homeGridClass(mode: LayoutMode): string {
  switch (mode) {
    case "desktop":
      return "grid gap-6 auto-rows-min grid-cols-[repeat(auto-fit,minmax(360px,1fr))]";
    case "tablet":
      return "grid grid-cols-2 gap-6 auto-rows-min";
    case "phone":
      return "grid grid-cols-1 gap-6 auto-rows-min";
  }
}
```

3d. Replace `HOME_GRID_FALLBACK`:

```ts
export const HOME_GRID_FALLBACK = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-6 auto-rows-min";
```

3e. Replace `widgetSpanClass` (drop the `WIDGET_WIDTHS` reference; add `tabletSpan`):

```ts
/**
 * Class for one widget in the live orientation. Desktop returns "" (the
 * auto-fit grid sizes the columns); tablet pairs every widget up as
 * col-span-1 except a lone last widget of an odd count, which stretches to
 * the full row; phone is a single-column stack and returns "".
 */
export function widgetSpanClass(id: WidgetId, mode: LayoutMode): string {
  switch (mode) {
    case "desktop":
      return "";
    case "tablet":
      return "col-span-1";
    case "phone":
      return "";
  }
}

/**
 * Tablet span for the widget at `index` of `count` visible widgets:
 * the last widget of an odd count stretches to fill the row, so an odd
 * number of uniform 1×1 widgets never leaves an empty half-row.
 */
export function tabletSpan(index: number, count: number): string {
  return index === count - 1 && count % 2 === 1 ? "col-span-2" : "col-span-1";
}
```

3f. Replace `homeFooterSpanClass`:

```ts
export function homeFooterSpanClass(mode: LayoutMode): string {
  switch (mode) {
    case "desktop":
      return "col-span-full";
    case "tablet":
      return "col-span-2";
    case "phone":
      return "";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: PASS — all layout-config tests green (now 24+ tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout-config.ts tests/unit/layout-config.test.ts
git commit -m "feat(ui): desktop auto-fit grid + tablet lone-widget fill"
```

---

### Task 2: page.tsx — wire tabletSpan + h-full stretch call sites

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `tabletSpan(index, count)` from Task 1; `className` props added to `MorningBriefingWidget`, `HomeLeaderboardWidget`, `HomeSuggestionsWidget`, `CurrentMealWidget`, `WeatherWidget` in Task 3 (this task only edits the five call sites that need NO new component code: todayEvents, schedule, tasks, aiQuickAsk, footer — those components already accept `className`).
- Produces: grid-item wrappers that stretch their cards (`h-full`), and a tablet span computed from widget position.

- [ ] **Step 1: Import `tabletSpan`**

In `src/app/page.tsx` line 19:

```tsx
import { WIDGET_SPANS, homeGridClass, homeFooterSpanClass, widgetSpanClass, tabletSpan, HOME_GRID_FALLBACK, type WidgetId } from "@/lib/layout-config";
```

- [ ] **Step 2: Compute the span with widget position (line 312–313)**

```tsx
            {widgets.map((id, index) => {
              const span = layoutMounted
                ? orientation === "tablet"
                  ? tabletSpan(index, widgets.length)
                  : widgetSpanClass(id as WidgetId, orientation)
                : (WIDGET_SPANS[id as WidgetId] ?? "lg:col-span-1");
```

- [ ] **Step 3: Stretch the cards whose components already take `className`**

3a. todayEvents SectionCard (line 337): add `className="h-full"`:

```tsx
                      <SectionCard title="Today" description={`${todayEvents.length} events on the family calendar`} icon="📅" tone="#3b82f6" compact className="h-full"
```

3b. schedule (line 367):

```tsx
                      <ScheduleDisplay schedule={homeScheduleItems} title="Daily Schedule" className="h-full" />
```

3c. tasks SectionCard (line 385): add `className="h-full"`:

```tsx
                      <SectionCard title="Tasks" description={`${pendingTasks.length} pending for the family`} icon="✅" tone="#f43f5e" compact className="h-full"
```

3d. aiQuickAsk — the `Link` must also fill the wrapper so the card can (line 414):

```tsx
                      <Link href="/chat" className="block h-full">
                        <WidgetCard
                          tone="#8b5cf6"
                          className="h-full"
                          icon={<span className="grid h-14 w-14 place-items-center"><Icon3D variant="chat" size="md" /></span>}
                        >
```

3e. Footer (line 436–437): add `className="h-full"` to its SectionCard:

```tsx
            <div className={layoutMounted ? homeFooterSpanClass(orientation) : "lg:col-span-3"}>
              <SectionCard title="This Week" description="Meal and family rhythm at a glance" icon="🗓️" tone="#10b981" compact className="h-full">
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/layout-config.test.ts` — still green (page.tsx isn't unit-tested; spans come from the tested helpers). Run: `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(ui): wire tabletSpan + stretch call sites on Home"
```

---

### Task 3: className pass-throughs for the five Home-only widget cards

**Files:**
- Modify: `src/components/briefing/MorningBriefingWidget.tsx`
- Modify: `src/components/leaderboard/HomeLeaderboardWidget.tsx`
- Modify: `src/components/suggestions/HomeSuggestionsWidget.tsx`
- Modify: `src/components/meals/CurrentMealWidget.tsx`
- Modify: `src/components/ui/WeatherWidget.tsx`
- Modify: `src/app/page.tsx` (call sites for those five)

**Interfaces:**
- Consumes: Task 2's call-site pattern (`className="h-full"`).
- Produces: `className?: string` prop on each of the five components, forwarded to their card root (and `block h-full` on the leaderboard's internal `<Link>`s, plus `h-full` on the weather card div inside the component).

- [ ] **Step 1: MorningBriefingWidget**

In `MorningBriefingWidget.tsx`:

1a. Props interface (line 56–61):

```ts
export interface MorningBriefingWidgetProps {
  briefing: MorningBriefing | null;
  loading: boolean;
  ack: (id: string) => Promise<boolean>;
  ackError: boolean;
  className?: string;
}
```

1b. Destructure (line 63):

```ts
export default function MorningBriefingWidget({ briefing, loading, ack, ackError, className = "" }: MorningBriefingWidgetProps) {
```

1c. Card root (line 87):

```tsx
        <WidgetCard tone={BRIEFING_TONE} icon="🌅" className={className}>
```

1d. In `src/app/page.tsx` `MorningBriefingSlot` (lines 68–76):

```tsx
function MorningBriefingSlot({ span }: { span: string }) {
  const { briefing, loading, ack, ackError } = useMorningBriefing();
  if (loading || !briefing || briefingSectionsEmpty(briefing)) return null;
  return (
    <div className={span}>
      <MorningBriefingWidget briefing={briefing} loading={loading} ack={ack} ackError={ackError} className="h-full" />
    </div>
  );
}
```

- [ ] **Step 2: HomeLeaderboardWidget**

2a. Component signature (line 109):

```ts
export default function HomeLeaderboardWidget({ className = "" }: { className?: string }) {
```

2b. Loading branch (line 115):

```tsx
      <SectionCard title="This Week's Leaderboard" icon="🏆" tone="#f59e0b" className={className}>
```

2c. Empty branch — Link must fill the wrapper (`block h-full`) and the card fills the link (line 129–130):

```tsx
      <Link href="/tasks" className="block h-full active:scale-[0.99] transition-transform">
        <SectionCard title="This Week's Leaderboard" icon="🏆" tone="#f59e0b" className={className}>
```

2d. Main branch (lines 148–149):

```tsx
    <Link href="/tasks" className="block h-full active:scale-[0.99] transition-transform">
      <SectionCard
        title="This Week's Leaderboard"
        description={`Resets in ${daysUntilReset} day${daysUntilReset !== 1 ? "s" : ""}`}
        icon="🏆"
        tone="#f59e0b"
        className={className}
```

2e. In `src/app/page.tsx` (line 327):

```tsx
                case "leaderboard":
                  return <div key="leaderboard" className={span}><HomeLeaderboardWidget className="h-full" /></div>;
```

- [ ] **Step 3: HomeSuggestionsWidget**

3a. Component signature (line 78):

```ts
export default function HomeSuggestionsWidget({ className = "" }: { className?: string }) {
```

3b. All-clear branch SectionCard (line ~120–126) — add `className={className}` to the props:

```tsx
      <SectionCard
        title="Consuela suggests"
        description="Proactive alerts for the family"
        icon="✨"
        tone="#8b5cf6"
        className={className}
        action={<Link href="/suggestions" className="text-sm widget-accent-text">See all →</Link>}
      >
```

3c. Main branch SectionCard (line 140–146) — add `className={className}` after `tone="#8b5cf6"`:

```tsx
    <SectionCard
      title="Consuela suggests"
      description="Proactive alerts for the family"
      icon="✨"
      tone="#8b5cf6"
      className={className}
      action={<Link href="/suggestions" className="text-sm widget-accent-text">See all →</Link>}
    >
```

3d. In `src/app/page.tsx` (line 330):

```tsx
                case "consuelaSuggestions":
                  return <div key="consuelaSuggestions" className={span}><HomeSuggestionsWidget className="h-full" /></div>;
```

- [ ] **Step 4: CurrentMealWidget**

4a. Component signature (line 43):

```ts
export default function CurrentMealWidget({ className = "" }: { className?: string }) {
```

4b. Card root (line 109):

```tsx
    <WidgetCard tone="#10b981" icon="🍽️" className={className}>
```

4c. In `src/app/page.tsx` (lines 373–376):

```tsx
                    <div key="currentMeal" className={span}>
                      <AtmosphericProvider>
                        <CurrentMealWidget className="h-full" />
                      </AtmosphericProvider>
                    </div>
```

- [ ] **Step 5: WeatherWidget**

5a. Component signature (line 1645):

```ts
export default function WeatherWidget({ className = "" }: { className?: string }) {
```

5b. Root wrapper div (lines 1762–1765):

```tsx
  return (
    <div
      className={`relative ${className}`}
      style={{ animation: mounted ? "weatherCardEnter 1s cubic-bezier(0.34,1.56,0.64,1) both" : undefined }}
    >
```

5c. Card div (line 1791) — add `h-full` so the card shell fills the stretched root:

```tsx
        className="rounded-2xl overflow-hidden relative h-full"
```

5d. In `src/app/page.tsx` (lines 319–324):

```tsx
                case "weather":
                  return (
                    <div key="weather" className={`relative z-10 ${span}`}>
                      <WeatherWidget className="h-full" />
                      <AtmosphericBridge />
                    </div>
                  );
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — clean. Run: `npx vitest run tests/unit/layout-config.test.ts` — green.

- [ ] **Step 7: Commit**

```bash
git add src/components/briefing/MorningBriefingWidget.tsx src/components/leaderboard/HomeLeaderboardWidget.tsx src/components/suggestions/HomeSuggestionsWidget.tsx src/components/meals/CurrentMealWidget.tsx src/components/ui/WeatherWidget.tsx src/app/page.tsx
git commit -m "feat(ui): cards stretch to fill their grid row"
```

---

### Task 4: Settings help modal copy

**Files:**
- Modify: `src/app/settings/page.tsx:935`

- [ ] **Step 1: Update the Layout & display help paragraph**

Replace the sentence about the sideways filmstrip:

```tsx
            <p><strong className="text-text-primary">Phone / Tablet / Desktop</strong> — Each layout mode keeps its own widget order and visibility. Switch the tabs at the top of this card to edit a different mode; Consuela applies the right layout automatically when your device rotates or resizes. On tablet every widget is the same size and pairs up two per row (the last card stretches across the row if the count is odd); on desktop the widgets tile into a grid that fills the screen, with every card the same width.</p>
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck` — clean.

```bash
git add src/app/settings/page.tsx
git commit -m "docs(ui): settings help modal describes tiling desktop grid"
```

---

### Task 5: AGENTS.md mandatory update

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the Current Dashboard Snapshot**

Replace the filmstrip/`WIDGET_WIDTHS` passages in the snapshot with the auto-fit grid description: "**desktop** (landscape OR width ≥ 1280px) = an auto-fit tiling grid — `repeat(auto-fit, minmax(360px, 1fr))` fits as many uniform columns as the viewport holds, all widgets visible at once, vertical scroll; `WIDGET_WIDTHS` deleted; `widgetSpanClass("desktop")` returns `""`; `homeFooterSpanClass("desktop")` = `col-span-full`; `tabletSpan(index, count)` stretches the lone last widget of an odd tablet count to `col-span-2`; every Home card now fills its grid row (`h-full`) so short cards (Ask Consuela) match their row partner's height".

- [ ] **Step 2: Add a UI Change Record** (exact format from AGENTS.md §1.1)

```markdown
### UI Change Record — 2026-08-14 — Fill-the-space layout: desktop auto-fit grid + row-height stretch
- Added / Changed: `src/lib/layout-config.ts` — `homeGridClass("desktop")` `"flex gap-6 overflow-x-auto pb-4 pt-6 items-start snap-x snap-proximity"` → `"grid gap-6 auto-rows-min grid-cols-[repeat(auto-fit,minmax(360px,1fr))]"` (auto-fit tiling grid: 3 columns at 1440px, 2 at 1024px landscape, 5–6 at 2560px — all widgets visible at once, vertical scroll instead of sideways filmstrip); `WIDGET_WIDTHS` deleted; `widgetSpanClass(id, "desktop")` → `""`; `homeFooterSpanClass("desktop")` → `"col-span-full"` (This Week is the final full-width row); new `tabletSpan(index, count)` — the last widget of an odd visible count on tablet stretches to `col-span-2`; `HOME_GRID_FALLBACK` lg tier → `lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))]`. `src/app/page.tsx` — `widgets.map((id, index) => ...)` computes the tablet span via `tabletSpan(index, widgets.length)`; every widget wrapper passes `className="h-full"` to its card (and the aiQuickAsk/leaderboard `<Link>`s became `block h-full`) so cards fill their grid-stretched row — no empty gap below short cards. `src/components/{briefing/MorningBriefingWidget,leaderboard/HomeLeaderboardWidget,suggestions/HomeSuggestionsWidget,meals/CurrentMealWidget}.tsx` + `src/components/ui/WeatherWidget.tsx` — gained a `className` prop forwarded to the card root. `src/app/settings/page.tsx` — Layout & display help copy updated. `tests/unit/layout-config.test.ts` — contract updated (desktop auto-fit grid, desktop spans `""`, footer `col-span-full`, `tabletSpan`, auto-fit fallback).
- Visual / Motion: On a desktop/landscape screen the Home widgets no longer sit in a sideways filmstrip you scroll left↔right — they tile into a grid that fills the screen (three uniform columns at 1440px, more on wider monitors), so every widget is visible at once and the page scrolls vertically like the phone view. Every card in a row is now the same height — the short Ask Consuela card grows to match its taller neighbor, and on tablet a lone last widget (e.g. Tasks when 9 widgets are shown) stretches across the full row instead of leaving an empty half. The This Week footer card spans the full width at the bottom. Phone is unchanged. No new motion; reduced-motion untouched.
- Color sources: None — pure layout change.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "On your computer the Home dashboard now fills the screen — the widgets tile into a grid of equal-width cards instead of a sideways filmstrip, so you can see them all at once and just scroll down like on your phone. Every card in a row is the same height now (the small Quick ask card stretches to match its neighbors), and on a tablet, when there's an odd number of widgets, the last card stretches across the whole row instead of leaving an empty half."
```

- [ ] **Step 3: Add the Change Log entry** (top of Change Log):

```markdown
- 2026-08-14 — feat(ui): Fill-the-space layout — desktop auto-fit grid + row-height stretch. `src/lib/layout-config.ts` — `homeGridClass("desktop")` → `"grid gap-6 auto-rows-min grid-cols-[repeat(auto-fit,minmax(360px,1fr))]"`; `WIDGET_WIDTHS` deleted; `widgetSpanClass("desktop")` → `""`; `homeFooterSpanClass("desktop")` → `"col-span-full"`; new `tabletSpan(index, count)` (last widget of an odd count → `col-span-2`); `HOME_GRID_FALLBACK` lg tier → auto-fit. `src/app/page.tsx` — `widgets.map((id, index) =>` + `tabletSpan`; `className="h-full"` on all card call sites (links `block h-full`). Five Home-only widgets gained a `className` prop (MorningBriefingWidget, HomeLeaderboardWidget, HomeSuggestionsWidget, CurrentMealWidget, WeatherWidget). `src/app/settings/page.tsx` — help copy. `tests/unit/layout-config.test.ts` — updated contract (24+ tests). Spec: `docs/superpowers/specs/2026-08-14-fill-the-space-layout-design.md`. AGENTS.md snapshot + UI Change Record updated.
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(ui): AGENTS.md fill-the-space layout snapshot + change record"
```

---

### Task 6: Full verification

- [ ] **Step 1: Unit tests**

Run: `npx vitest run`
Expected: 134/135 pass — the only failure is the pre-existing `api-routes.test.ts` PocketBase-env test (NOT a regression; confirm it fails on the base branch too if unsure).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck` — clean.
Run: `npm run lint` — no NEW errors/warnings vs the baseline (52 errors / 21 warnings pre-existing).

- [ ] **Step 3: Build + serve check**

Run: `npm run build` — clean (41/41 pages). Then restart the local server so it serves the new `.next` build (the running `next-server` on :3000 reads `.next` from disk per request, but a restart is the safe move):

```bash
# find the node next-server pid on :3000, restart it (or docker restart consuela-dashboard)
lsof -iTCP:3000 -sTCP:LISTEN -t
```

Then `curl -s http://localhost:3000/ | grep -oE 'grid-cols-\[repeat|col-span-full|col-span-1' | sort | uniq -c` — expect `col-span-1` (SSR fallback) and no `w-[720px]`/`w-[480px]` remnants. If CSS looks broken after build, apply the known quirk: `docker restart consuela-dashboard`.

- [ ] **Step 4: Browser smoke (user-facing)**

Ask the user to check at `http://localhost:3000`:
- Wide/landscape window (≥1280px or landscape): cards tile 2–3+ across filling the viewport width, all equal width and equal height per row, This Week spans the bottom, no horizontal page scroll, no sideways filmstrip.
- Portrait ~800px (narrow tall window): 2-col pairs, every row equal height (Ask Consuela matches its neighbor), 9 widgets → the 9th (Tasks) spans the full bottom row; footer full-width.
- Phone portrait (<700px): unchanged single column.

- [ ] **Step 5: Final review + handoff**

Run: `git log --oneline -7` — expect the 5 feature commits + spec commit on top of `e2ee9d8`. Verify: `git status` shows only `public/version.json` dirty (pre-existing). Record the SDD ledger at `.superpowers/sdd/progress.md`. Then present the finishing-a-development-branch options to the user (keep as-is / push `warm-glass-v2` / bump outer submodule / discard).
