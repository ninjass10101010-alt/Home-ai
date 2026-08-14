# Uniform Widget Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Home widget the same 1×1 size on tablet (uniform 2-column pairing) and a uniform 360px width in the desktop filmstrip, removing the full-width hero spans.

**Architecture:** All sizing lives in `src/lib/layout-config.ts` as class-string maps consumed by `widgetSpanClass`/`homeFooterSpanClass`. The change flattens those maps (all `col-span-1` on tablet, all `w-[360px]` on desktop), deletes the tablet partition helpers (`TABLET_FULL_WIDTH`, `toTabletOrder`, `TABLET_COL_SPANS`), and makes the tablet bucket a plain order identical to its migration source. `src/app/page.tsx` needs no changes — it already consumes the span helpers. The unit-test contract in `tests/unit/layout-config.test.ts` is updated first (TDD red → green).

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript 5.9, Vitest 4. All work happens inside the `Home-ai` git submodule (branch `warm-glass-v2`).

## Global Constraints

- **Repo:** work in `/Users/garciafam/Documents/Dashboard/Home-ai` (submodule `warm-glass-v2`). Commit there; do NOT commit to the outer Dashboard repo.
- **Do not touch** `public/version.json` (pre-existing dirty state).
- Tablet = `grid grid-cols-2`, all widgets `col-span-1`; lone odd widget stays half-width (accepted, no stretch). This Week footer stays `col-span-2` on tablet.
- Desktop = horizontal filmstrip, every widget AND the This Week footer exactly `w-[360px]`.
- Phone = unchanged (`""` spans, `grid-cols-1`).
- SSR/pre-mount fallback `WIDGET_SPANS`: every widget `col-span-1` (no `md:`/`lg:` hero spans).
- Spec: `docs/superpowers/specs/2026-08-14-uniform-widget-sizes-design.md`
- **AGENTS.md is mandatory to update** in the same session as any UI change (snapshot + UI Change Record + Change Log).
- Tests: `npx vitest run tests/unit/layout-config.test.ts`. Gates: `npm run typecheck`, `npm run lint` (0 new errors), `npm run build`.
- Known build quirk (AGENTS.md): if the dashboard loads broken after build, `docker restart consuela-dashboard`.

---

### Task 1: Flatten tablet/desktop sizes + delete partition helpers

**Files:**
- Modify: `src/lib/layout-config.ts` (header comment lines 3–7, delete lines 83–97, line 109, lines 123–133, lines 135–149, lines 159–169, lines 200–209, line 214, lines 272 and 284)
- Test: `tests/unit/layout-config.test.ts`

**Interfaces:**
- Consumes: existing exports (`WidgetId`, `LayoutMode`, `widgetSpanClass`, `homeFooterSpanClass`, `WIDGET_SPANS`, `DEFAULT_LAYOUT`, `cloneDefaultLayout`, `loadLayoutConfig`, `saveLayoutConfig`, `LAYOUT_STORAGE_KEY`, `computeLayoutMode`, `homeGridClass`).
- Produces (post-change signatures later tasks rely on):
  - `widgetSpanClass(id, "tablet")` → `"col-span-1"` for every id; `widgetSpanClass(id, "desktop")` → `shrink-0 snap-start w-[360px]` for every id
  - `homeFooterSpanClass("desktop")` → `"shrink-0 snap-start w-[360px]"`
  - `DEFAULT_LAYOUT.tablet.widgets` equals `[...DEFAULT_LAYOUT.phone.widgets]`
  - `toTabletOrder`, `TABLET_COL_SPANS`, `TABLET_FULL_WIDTH` **no longer exist** — nothing may reference them.

- [ ] **Step 1: Write the failing tests**

Edit `tests/unit/layout-config.test.ts`:

1. Remove `TABLET_COL_SPANS` and `toTabletOrder` from the import (lines 14 and 16).
2. Replace the tablet test (lines 81–86) with:

```ts
  it('applies 1-col spans in tablet so every widget pairs up evenly', () => {
    expect(widgetSpanClass('morningBriefing', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('weather', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('consuelaSuggestions', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('leaderboard', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('tasks', 'tablet')).toBe('col-span-1');
  });
```

3. Replace the desktop test (lines 88–91) with:

```ts
  it('applies the uniform filmstrip width in desktop', () => {
    expect(widgetSpanClass('weather', 'desktop')).toBe('shrink-0 snap-start w-[360px]');
    expect(widgetSpanClass('leaderboard', 'desktop')).toBe('shrink-0 snap-start w-[360px]');
    expect(widgetSpanClass('currentMeal', 'desktop')).toBe('shrink-0 snap-start w-[360px]');
  });
```

4. Replace the desktop footer test (line 109) with:

```ts
    expect(homeFooterSpanClass('desktop')).toBe('shrink-0 snap-start w-[360px]');
```

5. Replace the `WIDGET_SPANS` test (lines 113–119) with:

```ts
describe('pre-mount fallback (WIDGET_SPANS)', () => {
  it('every widget falls back to a uniform col-span-1', () => {
    for (const id of Object.keys(WIDGET_SPANS)) {
      expect(WIDGET_SPANS[id as WidgetId]).toBe('col-span-1');
    }
  });
});
```

6. Delete the `describe('TABLET_COL_SPANS', ...)` block (lines 121–127) and the `describe('toTabletOrder', ...)` block (lines 129–139).
7. Replace the tablet assertion in `cloneDefaultLayout` (line 148) with:

```ts
    expect(a.tablet.widgets).toEqual(DEFAULT_LAYOUT.phone.widgets);
```

8. Update the v2 migration test (lines 169–182): change the title to `'migrates v2 { portrait, landscape }: phone=portrait, desktop=landscape, tablet=portrait order'` and add this assertion after line 180:

```ts
    expect(cfg.tablet.widgets).toEqual(cfg.phone.widgets);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: FAIL — assertions see `col-span-2` / `w-[720px]`; TS error on the removed imports.

- [ ] **Step 3: Implement**

Edit `src/lib/layout-config.ts`:

1. Header comment (lines 3–7): change `"tablet" (2-column bento, portrait 700–1279px)` to `"tablet" (uniform 2-column pairing grid, portrait 700–1279px)`.
2. Delete lines 83–97 (the `TABLET_FULL_WIDTH` const, its doc comment, and the whole `toTabletOrder` function).
3. Line 109: `widgets: toTabletOrder([...PHONE_DEFAULT_WIDGETS])` → `widgets: [...PHONE_DEFAULT_WIDGETS]`.
4. Replace `WIDGET_SPANS` (lines 123–133) with:

```ts
export const WIDGET_SPANS: Record<WidgetId, string> = {
  morningBriefing: "col-span-1",
  weather: "col-span-1",
  aiQuickAsk: "col-span-1",
  consuelaSuggestions: "col-span-1",
  leaderboard: "col-span-1",
  todayEvents: "col-span-1",
  schedule: "col-span-1",
  currentMeal: "col-span-1",
  tasks: "col-span-1",
};
```

5. Delete the `TABLET_COL_SPANS` const and its doc comment (lines 135–149).
6. Replace `WIDGET_WIDTHS` (lines 159–169) with:

```ts
export const WIDGET_WIDTHS: Record<WidgetId, string> = {
  morningBriefing: "w-[360px]",
  weather: "w-[360px]",
  aiQuickAsk: "w-[360px]",
  consuelaSuggestions: "w-[360px]",
  leaderboard: "w-[360px]",
  todayEvents: "w-[360px]",
  schedule: "w-[360px]",
  currentMeal: "w-[360px]",
  tasks: "w-[360px]",
};
```

7. In `widgetSpanClass` (lines 200–209): `case "tablet": return TABLET_COL_SPANS[id] ?? "col-span-1";` → `case "tablet": return "col-span-1";`
8. In `homeFooterSpanClass` (line 214): `return "shrink-0 snap-start w-[720px]";` → `return "shrink-0 snap-start w-[360px]";`
9. v1 migration (line 272): `tablet: { widgets: toTabletOrder(migrated.widgets) }` → `tablet: { widgets: [...migrated.widgets] }`
10. v2 migration (line 284): `tablet: { widgets: toTabletOrder(phone.widgets) }` → `tablet: { widgets: [...phone.widgets] }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: PASS (all remaining tests green).

- [ ] **Step 5: Full checks**

Run: `npx vitest run` then `npm run typecheck`
Expected: all unit tests pass; `tsc` clean (no references to removed symbols anywhere).

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout-config.ts tests/unit/layout-config.test.ts
git commit -m "feat(ui): uniform 1x1 widget sizes — tablet pairing grid + 360px filmstrip"
```

---

### Task 2: Settings help copy

**Files:**
- Modify: `src/app/settings/page.tsx:935`

**Interfaces:**
- Consumes: nothing from Task 1 (pure copy).
- Produces: nothing — UI copy only.

- [ ] **Step 1: Update the Layout & display help modal**

Replace the paragraph at line 935:

```tsx
            <p><strong className="text-text-primary">Phone / Tablet / Desktop</strong> — Each layout mode keeps its own widget order and visibility. Switch the tabs at the top of this card to edit a different mode; Consuela applies the right layout automatically when your device rotates or resizes.</p>
```

with:

```tsx
            <p><strong className="text-text-primary">Phone / Tablet / Desktop</strong> — Each layout mode keeps its own widget order and visibility. Switch the tabs at the top of this card to edit a different mode; Consuela applies the right layout automatically when your device rotates or resizes. On tablet every widget is the same size and pairs up two per row; on desktop the widgets are uniform-width cards in a sideways filmstrip.</p>
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` and `npm run lint`
Expected: clean (0 new errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "docs(ui): layout help modal describes uniform tablet pairing + filmstrip widths"
```

---

### Task 3: AGENTS.md update (mandatory)

**Files:**
- Modify: `AGENTS.md` (in `/Users/garciafam/Documents/Dashboard/Home-ai/AGENTS.md`)

**Interfaces:**
- Consumes: nothing from prior tasks beyond the behavior they shipped.
- Produces: nothing — documentation only.

- [ ] **Step 1: Update the "Current Dashboard Snapshot"**

In the snapshot, update the three-mode Home layouts bullet:
- Remove: `morningBriefing / weather / consuelaSuggestions span the full row (TABLET_COL_SPANS col-span-2)`.
- Replace with: tablet = uniform 2-column pairing grid (every widget `col-span-1`, pairs two per row, lone odd widget leaves an empty half-row; This Week footer spans both columns; `TABLET_COL_SPANS` / `toTabletOrder` / `TABLET_FULL_WIDTH` removed — the tablet bucket is a plain order).
- Desktop bullet: change per-widget filmstrip widths to `w-[360px]` for every widget and the This Week footer (was weather 720 / suggestions 480 / meal 420).

- [ ] **Step 2: Add a UI Change Record**

Add a new `### UI Change Record — 2026-08-14 — Uniform 1×1 widget sizes` entry at the top of the record list: `src/lib/layout-config.ts` (WIDGET_WIDTHS all `w-[360px]`, TABLET_COL_SPANS/TABLET_FULL_WIDTH/toTabletOrder deleted, `widgetSpanClass` tablet → `col-span-1`, `homeFooterSpanClass` desktop → `w-[360px]`, WIDGET_SPANS all `col-span-1`, v1/v2 migrations map tablet = source order, `DEFAULT_LAYOUT.tablet` = phone order), `src/app/settings/page.tsx` (help modal copy), `tests/unit/layout-config.test.ts` (contract updated). Visual description: tablet widgets pair up two per row at equal size, no full-width cards; desktop filmstrip columns are all 360px wide. No new motion; reduced-motion untouched.

- [ ] **Step 3: Add a Change Log entry**

Add `- 2026-08-14 — feat(ui): uniform 1×1 widget sizes …` summarizing the same changes.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md snapshot + UI Change Record for uniform widget sizes"
```

---

### Task 4: Verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Unit tests**

Run: `npx vitest run`
Expected: 0 failures (layout-config suite green, no other suite affected).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean; 0 new errors (pre-existing warnings allowed).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds. (If the running dashboard later shows broken CSS, apply the documented quirk: `docker restart consuela-dashboard`.)

- [ ] **Step 4: Browser smoke (optional but recommended)**

Run: `npm run dev`, open at ~800px portrait width → all widgets half-width pairs (no full-width card), This Week footer full-width; at ~1440px landscape → filmstrip where every card measures exactly 360px wide and all tops align. Confirm no horizontal page overflow at 390px portrait.

- [ ] **Step 5: Final commit check**

Run: `git status --short` — only intended files changed; `public/version.json` untouched (if it appears modified, leave it — pre-existing).
