# Calm-Motion Layout & Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings "Layout & display" card calm and accurate — toggles flip in place (no teleport to a Hidden group), reorders glide with a subtle FLIP animation, list rows lose their hover/press scale app-wide, and the toggle knob actually slides.

**Architecture:** Storage migrates from v3 (visible-only `widgets` arrays) to v4 (`{ widgets: full order of all 9, hidden: subset }`) per mode, with backward-compatible `loadLayoutConfig` migration. The settings editor renders ONE list from the full order; hidden rows dim in place via `opacity-55`. Reorders animate via the native Web Animations API (FLIP, ~260ms), skipped under `prefers-reduced-motion`.

**Tech Stack:** Next.js 16 + React 19 + Tailwind CSS 4, Vitest (jsdom), Web Animations API (no new dependencies).

## Global Constraints

- No new dependencies (WAAPI only; no framer-motion, no animation libs).
- Storage key stays `consuela-home-layout`; saved configs must round-trip exactly (no self-heal reorder on v4 app-written paths).
- Legacy v1/v2/v3 migrations: order = saved list + missing ids appended in the mode's default order; `hidden` = the missing ids.
- All new motion respects `prefers-reduced-motion` (no WAAPI animations, no scale).
- `.tap`/`.tap-sm` remain the single source of tap feedback; ListRow becomes a documented exclusion (like Avatar/Badge/Toggle).
- AGENTS.md must be updated in the same session as UI changes (snapshot + UI Change Record + Change Log).
- Tests: `npx vitest run`, `npm run typecheck`, `npm run lint` (0 new errors; pre-existing baseline allowed), `npm run build`.
- Dev server hot-reloads: open http://localhost:3000 to smoke-test.

---

### Task 1: ListRow motion removal (app-wide)

**Files:**
- Modify: `src/components/ui/ListRow.tsx:30`

**Interfaces:**
- Consumes: nothing new (existing `ListRowProps` unchanged).
- Produces: ListRow root class no longer contains `tap`; interactive rows (with `onClick`) gain a `focus-visible` accent ring. All ListRow consumers across the app (Settings lists, grocery, pantry, tasks, family members, emergency contacts) inherit the change — no per-consumer edits needed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/list-row.test.tsx` (`@testing-library/react` is NOT installed — use `react-dom/client` + `act`):

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import ListRow from "@/components/ui/ListRow";

function renderRow(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

describe("ListRow motion", () => {
  it("does not apply the tap class (no hover/press scale) to any row", () => {
    const row = renderRow(<ListRow title="Test" onClick={() => {}} />);
    expect(row.className).not.toContain("tap");
  });

  it("keeps the hover background and focus ring for interactive rows", () => {
    const row = renderRow(<ListRow title="Test" onClick={() => {}} />);
    expect(row.className).toContain("hover:bg-[var(--color-surface-0)]/45");
    expect(row.className).toContain("focus-visible:ring-2");
  });

  it("does not add a focus ring to non-interactive rows", () => {
    const row = renderRow(<ListRow title="Test" />);
    expect(row.className).not.toContain("focus-visible");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/list-row.test.tsx -v`
Expected: FAIL — `expect(row.className).not.toContain("tap")` finds `tap` in the class list (current line 30 has `tap`).

- [ ] **Step 3: Remove the tap class from ListRow**

`src/components/ui/ListRow.tsx:30` — replace:

```tsx
        className={`group relative flex items-center gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-3 backdrop-blur-xl tap hover:bg-[var(--color-surface-0)]/45 ${onClick ? "cursor-pointer" : ""} ${className}`}
```

with:

```tsx
        className={`group relative flex items-center gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-3 backdrop-blur-xl transition-colors hover:bg-[var(--color-surface-0)]/45 ${onClick ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2" : ""} ${className}`}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/list-row.test.tsx -v`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck + lint + full test suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: typecheck clean; lint reports only the pre-existing 73 problems (52 errors / 21 warnings — run `git stash` comparison if unsure); all unit tests pass (112+3).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ListRow.tsx tests/unit/list-row.test.tsx
git commit -m "feat(ui): remove hover/press scale from ListRow app-wide (tap class dropped, focus ring kept)"
```

---

### Task 2: Storage v4 — full order + hidden set (`src/lib/layout-config.ts`)

**Files:**
- Modify: `src/lib/layout-config.ts` (interface, defaults, sanitize, load/save, toggle/get helpers)
- Test: `tests/unit/layout-config.test.ts`

**Interfaces:**
- Consumes: existing `WidgetId`, `ALL_WIDGETS`, `LayoutMode`, `DEFAULT_LAYOUT`, `LAYOUT_STORAGE_KEY`.
- Produces (exact signatures later tasks rely on):
  - `interface OrientationLayout { widgets: WidgetId[]; hidden: WidgetId[] }`
  - `toggleWidgetVisibility(layout: OrientationLayout, id: WidgetId): OrientationLayout`
  - `getVisibleWidgets(layout: OrientationLayout): WidgetDef[]` — **signature changes**: takes the layout, not a list
  - `getOrderedWidgetDefs(layout: OrientationLayout): WidgetDef[]` — all 9 in order
  - `getHiddenWidgetDefs(layout: OrientationLayout): WidgetDef[]` — hidden ids mapped to defs
  - `moveWidgetUp/Down/To` — unchanged signatures, operate on full order
  - `sanitizeLayout(list: unknown): OrientationLayout` — accepts v4 `{widgets, hidden}` OR legacy list
  - `loadLayoutConfig(): HomeLayoutConfig` — v1/v2/v3 migrate; v4 round-trips exactly
  - Removed: `toggleWidget(list, id)`, `getHiddenWidgets(list)` (replaced by the above)

- [ ] **Step 1: Write the failing tests for the new contract**

Replace the visibility-related describes in `tests/unit/layout-config.test.ts`. Keep the grid/span/tablet/fallback/clone describes untouched. Add:

```ts
import {
  toggleWidgetVisibility,
  getVisibleWidgets,
  getOrderedWidgetDefs,
  getHiddenWidgetDefs,
  type OrientationLayout,
} from "@/lib/layout-config";
```

New tests (place after the `cloneDefaultLayout` describe):

```ts
describe('v4 storage (full order + hidden)', () => {
  const base: OrientationLayout = {
    widgets: ['morningBriefing', 'weather', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal', 'tasks'],
    hidden: [],
  };

  it('toggleWidgetVisibility adds to hidden without touching order', () => {
    const next = toggleWidgetVisibility(base, 'weather');
    expect(next.widgets).toEqual(base.widgets);
    expect(next.hidden).toEqual(['weather']);
  });

  it('toggleWidgetVisibility removes from hidden on the second toggle', () => {
    const next = toggleWidgetVisibility(toggleWidgetVisibility(base, 'weather'), 'weather');
    expect(next.hidden).toEqual([]);
    expect(next.widgets).toEqual(base.widgets);
  });

  it('getVisibleWidgets filters hidden and preserves order', () => {
    const next = toggleWidgetVisibility(base, 'weather');
    const visible = getVisibleWidgets(next);
    expect(visible.map((w) => w.id)).toEqual(['morningBriefing', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal', 'tasks']);
  });

  it('getOrderedWidgetDefs returns all 9 in order including hidden', () => {
    const next = toggleWidgetVisibility(base, 'tasks');
    expect(getOrderedWidgetDefs(next).map((w) => w.id)).toEqual(base.widgets);
  });

  it('getHiddenWidgetDefs returns hidden defs in master order', () => {
    const next = toggleWidgetVisibility(base, 'tasks');
    expect(getHiddenWidgetDefs(next).map((w) => w.id)).toEqual(['tasks']);
  });

  it('moveWidgetUp/Down operate on the full order (hidden rows reorder too)', () => {
    const withHidden = { ...base, hidden: ['tasks'] };
    const up = moveWidgetUp(withHidden.widgets, 'tasks');
    expect(up.indexOf('tasks')).toBe(base.widgets.indexOf('tasks') - 1);
    const down = moveWidgetDown(withHidden.widgets, 'weather');
    expect(down.indexOf('weather')).toBe(base.widgets.indexOf('weather') + 1);
  });
});
```

Migration tests (replace the current `layout migration` describe body — keep `beforeEach`):

```ts
describe('v4 layout migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates v1 { widgets } into all three modes with hidden = missing', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ widgets: ['tasks', 'weather'] }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets[0]).toBe('morningBriefing');
    expect(cfg.phone.widgets).toContain('tasks');
    expect(cfg.phone.widgets).toContain('weather');
    expect(new Set(cfg.phone.widgets).size).toBe(9);
    expect(cfg.phone.hidden).toEqual(expect.arrayContaining(['morningBriefing', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal']));
    expect(cfg.tablet.widgets).toEqual(cfg.phone.widgets);
    expect(cfg.tablet.hidden).toEqual(cfg.phone.hidden);
  });

  it('migrates v2 { portrait, landscape } preserving order and hidden', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      portrait: { widgets: ['weather', 'aiQuickAsk', 'leaderboard'] },
      landscape: { widgets: ['schedule', 'tasks'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets.slice(0, 2)).toEqual(['morningBriefing', 'consuelaSuggestions']);
    expect(cfg.phone.widgets.indexOf('weather')).toBeLessThan(cfg.phone.widgets.indexOf('aiQuickAsk'));
    expect(cfg.phone.widgets.indexOf('aiQuickAsk')).toBeLessThan(cfg.phone.widgets.indexOf('leaderboard'));
    expect(cfg.phone.hidden).toHaveLength(6);
    expect(cfg.desktop.widgets.indexOf('schedule')).toBeLessThan(cfg.desktop.widgets.indexOf('tasks'));
    expect(cfg.desktop.hidden).toHaveLength(7);
  });

  it('migrates v3 { phone, tablet, desktop } visible-only lists', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      phone: { widgets: ['weather', 'tasks'] },
      tablet: { widgets: ['tasks', 'weather'] },
      desktop: { widgets: ['weather'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets).toEqual(['weather', 'tasks']);
    expect(cfg.phone.hidden).toHaveLength(7);
    expect(cfg.tablet.widgets).toEqual(['tasks', 'weather']);
    expect(cfg.desktop.widgets).toEqual(['weather']);
    expect(cfg.desktop.hidden).toHaveLength(8);
  });

  it('round-trips a v4 config exactly (order and hidden preserved)', () => {
    const cfg = cloneDefaultLayout();
    cfg.tablet.widgets = ['tasks', 'weather', 'morningBriefing'];
    cfg.tablet.hidden = ['aiQuickAsk', 'leaderboard'];
    saveLayoutConfig(cfg);
    const loaded = loadLayoutConfig();
    expect(loaded.tablet.widgets).toEqual(['tasks', 'weather', 'morningBriefing']);
    expect(loaded.tablet.hidden).toEqual(['aiQuickAsk', 'leaderboard']);
  });

  it('drops unknown hidden ids and appends missing widget ids', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      phone: { widgets: ['weather'], hidden: ['bogus', 'tasks'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.hidden).toEqual(['tasks']);
    expect(cfg.phone.widgets).toHaveLength(9);
    expect(cfg.phone.widgets).toContain('morningBriefing');
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, '{not json');
    expect(loadLayoutConfig()).toEqual(cloneDefaultLayout());
  });
});
```

Also update the existing `cloneDefaultLayout` describe — it must assert `hidden: []` on every mode:

```ts
  it('returns all three modes with independent arrays and empty hidden', () => {
    const a = cloneDefaultLayout();
    const b = cloneDefaultLayout();
    a.phone.widgets.push('morningBriefing');
    a.phone.hidden.push('tasks');
    expect(a.phone.widgets).toHaveLength(10);
    expect(a.phone.hidden).toEqual(['tasks']);
    expect(b.phone.hidden).toEqual([]);
    expect(a.tablet.widgets).toEqual(DEFAULT_LAYOUT.phone.widgets);
    expect(a.desktop.widgets).toEqual(DEFAULT_LAYOUT.desktop.widgets);
  });
```

Note: the existing test file imports `moveWidgetUp` / `moveWidgetDown` — verify those imports exist in the new test file's import block (they were previously imported transitively; add them explicitly).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: FAIL — `OrientationLayout` has no `hidden`; `toggleWidgetVisibility` / `getOrderedWidgetDefs` / `getHiddenWidgetDefs` undefined; migration assertions fail.

- [ ] **Step 3: Implement the v4 storage layer**

`src/lib/layout-config.ts` — make these changes:

```ts
export interface OrientationLayout {
  /** Full ordered list of ALL widget ids — stable positions, hidden included. */
  widgets: WidgetId[];
  /** Subset of widgets currently hidden (not rendered on Home). */
  hidden: WidgetId[];
}
```

`DEFAULT_LAYOUT` — add `hidden: []` to all three modes:

```ts
export const DEFAULT_LAYOUT: HomeLayoutConfig = {
  phone: { widgets: [...PHONE_DEFAULT_WIDGETS], hidden: [] },
  tablet: { widgets: [...PHONE_DEFAULT_WIDGETS], hidden: [] },
  desktop: { widgets: ["morningBriefing", "aiQuickAsk", "leaderboard", "weather", "consuelaSuggestions", "currentMeal", "schedule", "tasks", "todayEvents"], hidden: [] },
};
```

`cloneDefaultLayout`:

```ts
export function cloneDefaultLayout(): HomeLayoutConfig {
  return {
    phone: { widgets: [...DEFAULT_LAYOUT.phone.widgets], hidden: [] },
    tablet: { widgets: [...DEFAULT_LAYOUT.tablet.widgets], hidden: [] },
    desktop: { widgets: [...DEFAULT_LAYOUT.desktop.widgets], hidden: [] },
  };
}
```

Replace `sanitizeLayout` (now accepts v4 objects OR legacy lists):

```ts
/**
 * Validate + self-heal one orientation's layout. Accepts a v4 object
 * `{ widgets, hidden }` or a legacy visible-only list. Unknown ids are
 * dropped; missing widget ids are appended in the mode's default order
 * (L6: morningBriefing → index 0, consuelaSuggestions → index 1);
 * `hidden` keeps only valid known ids.
 */
function sanitizeLayout(input: unknown): OrientationLayout {
  const isObject = input !== null && typeof input === "object";
  const list = isObject && Array.isArray((input as { widgets?: unknown }).widgets)
    ? (input as { widgets: unknown[] }).widgets
    : Array.isArray(input) ? input : [];
  const hasHidden = isObject && Array.isArray((input as { hidden?: unknown }).hidden);
  const hiddenList = hasHidden ? (input as { hidden: unknown[] }).hidden : [];

  const sanitized = list.filter((id): id is WidgetId => typeof id === "string" && VALID_IDS.has(id as WidgetId));
  const present = new Set(sanitized);
  const missing = ALL_WIDGETS.map((w) => w.id).filter((id) => !present.has(id));
  const widgets = [...sanitized];
  for (const id of DEFAULT_LAYOUT.desktop.widgets) {
    if (!missing.includes(id)) continue;
    if (id === "morningBriefing" || id === "consuelaSuggestions") {
      const idx = id === "morningBriefing" ? 0 : 1;
      widgets.splice(Math.min(idx, widgets.length), 0, id);
    } else {
      widgets.push(id);
    }
  }
  // Explicit hidden list (v4) is validated as-is; legacy visible-only lists
  // (v1/v2/v3) imply the missing ids ARE the hidden ones.
  const hidden = hasHidden
    ? hiddenList.filter((id): id is WidgetId => typeof id === "string" && VALID_IDS.has(id as WidgetId))
    : missing;
  return { widgets, hidden };
}
```

Rewrite `loadLayoutConfig` (migration to v4):

```ts
export function loadLayoutConfig(): HomeLayoutConfig {
  if (typeof window === "undefined") return cloneDefaultLayout();
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return cloneDefaultLayout();
    const parsed = JSON.parse(raw);

    // v1: { widgets: WidgetId[] } — one layout for everything.
    if (Array.isArray(parsed?.widgets) && parsed.widgets.length > 0) {
      const migrated = sanitizeLayout(parsed.widgets);
      return {
        phone: { widgets: [...migrated.widgets], hidden: [...migrated.hidden] },
        tablet: { widgets: [...migrated.widgets], hidden: [...migrated.hidden] },
        desktop: { widgets: [...migrated.widgets], hidden: [...migrated.hidden] },
      };
    }

    // v2: { portrait: { widgets }, landscape: { widgets } }.
    if (parsed && typeof parsed === "object" && parsed.portrait && parsed.landscape) {
      const phone = sanitizeLayout(parsed.portrait?.widgets);
      const desktop = sanitizeLayout(parsed.landscape?.widgets);
      return {
        phone: { widgets: [...phone.widgets], hidden: [...phone.hidden] },
        tablet: { widgets: [...phone.widgets], hidden: [...phone.hidden] },
        desktop: { widgets: [...desktop.widgets], hidden: [...desktop.hidden] },
      };
    }

    // v3 (visible-only lists, no hidden key) or v4 ({ widgets, hidden }):
    // per-mode buckets. sanitizeLayout preserves the given list order and
    // appends missing ids; v3 buckets gain hidden = missing ids; v4 hidden
    // round-trips exactly (unknown ids dropped).
    if (parsed && typeof parsed === "object") {
      const exact = (key: string): OrientationLayout => sanitizeLayout(parsed?.[key]);
      return { phone: exact("phone"), tablet: exact("tablet"), desktop: exact("desktop") };
    }
    return cloneDefaultLayout();
  } catch {
    return cloneDefaultLayout();
  }
}
```

This preserves the existing v3 round-trip contract (`['weather', 'tasks']` stays `['weather', 'tasks']`, no self-heal reorder) and the L6 insertion rule (morningBriefing → index 0, consuelaSuggestions → index 1). The existing `migrates v2` test expects `phone.widgets.slice(1, 3)` toEqual `['consuelaSuggestions', 'weather']` — the append logic inserts consuelaSuggestions at index 1, so `[morningBriefing, consuelaSuggestions, weather, aiQuickAsk, leaderboard]` matches. The new v2 test asserts `slice(0, 2)` = `['morningBriefing', 'consuelaSuggestions']` — also matches.

Now the toggle/visibility helpers — replace `toggleWidget` / `getVisibleWidgets` / `getHiddenWidgets`:

```ts
/** Toggle a widget on/off without touching the order. */
export function toggleWidgetVisibility(layout: OrientationLayout, id: WidgetId): OrientationLayout {
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((w) => w !== id)
    : [...layout.hidden, id];
  return { widgets: layout.widgets, hidden };
}

/** Return visible widgets as WidgetDef[] in the user's saved order. */
export function getVisibleWidgets(layout: OrientationLayout): WidgetDef[] {
  const hidden = new Set(layout.hidden);
  const map = new Map(ALL_WIDGETS.map((w) => [w.id, w]));
  return layout.widgets.filter((id) => !hidden.has(id)).map((id) => map.get(id)).filter((w): w is WidgetDef => Boolean(w));
}

/** Return ALL widgets as WidgetDef[] in the user's saved order (hidden included). */
export function getOrderedWidgetDefs(layout: OrientationLayout): WidgetDef[] {
  const map = new Map(ALL_WIDGETS.map((w) => [w.id, w]));
  return layout.widgets.map((id) => map.get(id)).filter((w): w is WidgetDef => Boolean(w));
}

/** Return hidden widgets as WidgetDef[] in the saved order. */
export function getHiddenWidgetDefs(layout: OrientationLayout): WidgetDef[] {
  const map = new Map(ALL_WIDGETS.map((w) => [w.id, w]));
  return layout.hidden.map((id) => map.get(id)).filter((w): w is WidgetDef => Boolean(w));
}
```

Delete `toggleWidget` and `getHiddenWidgets` (they take lists; replaced above).

- [ ] **Step 4: Run the layout tests**

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: PASS. If the old `migrates v2` test's exact assertions differ from the new append behavior, adjust the test expectations to match the L6 insertion rule (morningBriefing→0, consuelaSuggestions→1) — but do NOT weaken the hidden/order assertions.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck may fail on `useHomeLayout.tsx` / `page.tsx` / `settings/page.tsx` — those still call `toggleWidget(list, ...)` / `getVisibleWidgets(list)` / `getHiddenWidgets(list)`. That's expected (Task 3 fixes the hook, Task 4 fixes the pages). If ONLY those files fail, proceed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout-config.ts tests/unit/layout-config.test.ts
git commit -m "feat(ui): v4 home-layout storage — full order + hidden set with legacy migration"
```

---

### Task 3: Hook updates (`src/hooks/useHomeLayout.tsx`)

**Files:**
- Modify: `src/hooks/useHomeLayout.tsx` (toggleFor, visibleWidgetsFor, hiddenWidgetsFor, widgets, isVisible, getIndex, new orderedWidgetsFor)

**Interfaces:**
- Consumes: `toggleWidgetVisibility`, `getVisibleWidgets`, `getOrderedWidgetDefs`, `getHiddenWidgetDefs`, `moveWidgetUp/Down/To` from `layout-config`.
- Produces:
  - `toggleFor(o, id)` — via `toggleWidgetVisibility`
  - `visibleWidgetsFor(o)` — via `getVisibleWidgets(config[o])`
  - NEW `orderedWidgetsFor(o): WidgetDef[]` — full order incl. hidden (for the settings editor)
  - `hiddenWidgetsFor(o)` — REMOVED
  - `isVisible(id)` — `!config[orientation].hidden.includes(id)`
  - `getIndex(id)` — unchanged (index in full order)
  - `widgetsFor(o)` — full `config[o].widgets` (still the Home render list = visible ids via `getVisibleWidgets` at the page level; Home renders `getVisibleWidgets(config[o]).map(id => id)` — check page.tsx consumers in Task 4)
  - Context value drops `hiddenWidgetsFor` / `hiddenWidgets`, adds `orderedWidgetsFor`.

- [ ] **Step 1: Update imports and toggleFor/visibleWidgetsFor**

`src/hooks/useHomeLayout.tsx` — change the import from `@/lib/layout-config` to include `toggleWidgetVisibility`, `getVisibleWidgets`, `getOrderedWidgetDefs`, `getHiddenWidgetDefs` (remove `toggleWidget`, `getHiddenWidgets` if imported):

```tsx
  const toggleFor = useCallback((o: LayoutMode, id: WidgetId) => {
    setConfig((prev) => ({ ...prev, [o]: toggleWidgetVisibility(prev[o], id) }));
  }, []);

  const visibleWidgetsFor = useCallback(
    (o: LayoutMode) => getVisibleWidgets(config[o]),
    [config]
  );

  const orderedWidgetsFor = useCallback(
    (o: LayoutMode) => getOrderedWidgetDefs(config[o]),
    [config]
  );
```

Replace `hiddenWidgetsFor` (delete it) and the live `hiddenWidgets` memo (delete). Update `isVisible`:

```tsx
  const isVisible = useCallback(
    (id: WidgetId) => !config[orientation].hidden.includes(id),
    [config, orientation]
  );
```

Update the live memos (keep `widgets` as the full order — Home filters at render; verify in Task 4):

```tsx
  const widgets = config[orientation].widgets;
  const visibleWidgets = useMemo(() => getVisibleWidgets(config[orientation]), [config, orientation]);
```

Delete `const hiddenWidgets = useMemo(...)`.

- [ ] **Step 2: Update the context value**

Remove `hiddenWidgets` and `hiddenWidgetsFor` from the provider `value`, add `orderedWidgetsFor`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL only in `src/app/settings/page.tsx` and `src/app/page.tsx` (they consume `hiddenWidgetsFor` / `hiddenWidgets` / old signatures). Task 4 fixes those. If other files fail, fix them.

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run`
Expected: all pass except any page-level test that used `hiddenWidgets` (none exist — layout-config tests were updated in Task 2). 112+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHomeLayout.tsx
git commit -m "feat(ui): hook updates for v4 layout — orderedWidgetsFor, toggle in place"
```

---

### Task 4: Settings editor — single unified list with in-place toggles + FLIP reorder animation

**Files:**
- Modify: `src/app/settings/page.tsx` (state, handlers, Layout & display render, help modal copy)
- Test: Playwright verification script (in /tmp, not committed)

**Interfaces:**
- Consumes: `orderedWidgetsFor(o)`, `toggleFor(o, id)`, `moveUpFor/moveDownFor/reorderFor(o, id, idx)` from the hook; `getVisibleWidgets` count via `visibleWidgetsFor(o).length`.
- Produces: one `space-y-3` list of ALL widgets in full order; hidden rows `opacity-55 transition-opacity duration-300`; ↑/↓ enabled on every row (disabled at full-order ends); drag from ⋮⋮ handle; FLIP animation on reorder; help modal copy update.

- [ ] **Step 1: Replace the two-group render with a single list**

In `src/app/settings/page.tsx`:
- Line 215 destructure: remove `hiddenWidgetsFor`, add `orderedWidgetsFor` (and `config`).
- Remove the `{editingVisible.length === 0 && (<EmptyState .../>)}` block (lines ~692–698) and the whole `editingVisible.map(...)` block + `editingHidden` block (lines ~699–782), including the "Hidden · N" divider.
- Replace them with:

```tsx
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                <span>All widgets</span>
                <span>{visibleCount} on Home</span>
              </div>
              <div className="space-y-3">
                {editingOrdered.map((widget, index) => {
                  const isDropTarget = dropTargetId === widget.id && draggingId !== widget.id;
                  const isHidden = hiddenIds.has(widget.id);
                  return (
                    <div
                      key={widget.id}
                      ref={(el) => rowRefs.current.set(widget.id, el)}
                      data-widget-id={widget.id}
                      onDragOver={handleDragOver(widget.id)}
                      onDragLeave={handleDragLeave(widget.id)}
                      onDrop={handleDrop(widget.id)}
                      onDragEnd={handleDragEnd}
                      className={`rounded-2xl transition ${isDropTarget ? "ring-2 ring-[var(--color-accent-selected)] ring-offset-2 ring-offset-[var(--color-canvas)]" : ""} ${draggingId === widget.id ? "opacity-50" : ""}`}
                    >
                      <ListRow
                        title={widget.label}
                        subtitle={widget.description}
                        leftRailColor="var(--color-accent-sage)"
                        className={isHidden ? "opacity-55 transition-opacity duration-300" : "transition-opacity duration-300"}
                        leading={
                          <span
                            draggable
                            onDragStart={handleDragStart(widget.id)}
                            className="grid h-9 w-6 cursor-grab place-items-center text-text-muted active:cursor-grabbing"
                            aria-hidden="true"
                            title="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                        }
                        trailing={
                          <div className="flex items-center gap-1">
                            <Toggle
                              checked={!isHidden}
                              onCheckedChange={(checked) => handleToggle(widget.id, checked)}
                              aria-label={`${isHidden ? "Show" : "Hide"} ${widget.label}`}
                            />
                            <IconButton size="sm" variant="ghost" aria-label={`Move ${widget.label} up`} disabled={index === 0} onClick={() => handleMoveUp(widget.id)}>↑</IconButton>
                            <IconButton size="sm" variant="ghost" aria-label={`Move ${widget.label} down`} disabled={index === editingOrdered.length - 1} onClick={() => handleMoveDown(widget.id)}>↓</IconButton>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
              {visibleCount === 0 && (
                <p className="text-xs text-text-muted">All widgets are hidden — turn one on to fill the Home dashboard.</p>
              )}
```

- [ ] **Step 2: Update state + derived values**

Replace the current derived lists (line ~253-254: `editingVisible` / `editingHidden`):

```tsx
  const editingOrdered = orderedWidgetsFor(editingOrientation);
  const editingVisible = visibleWidgetsFor(editingOrientation);
  const hiddenIds = new Set(config[editingOrientation].hidden);
  const visibleCount = editingVisible.length;
```

(`config` is exposed by the hook context — add it to the destructure on line 215.)

- [ ] **Step 3: Update handleToggle + handleDrop**

`handleToggle` currently calls `toggleFor` + toast — keep, but the `nextVisible` param now drives the toast directly (no direction guard):

```tsx
  const handleToggle = (id: WidgetId, nextVisible: boolean) => {
    toggleFor(editingOrientation, id);
    showToast(nextVisible ? `✅ Showing ${widgetLabel(id)} (${editingOrientation})` : `🚫 Hiding ${widgetLabel(id)} (${editingOrientation})`);
  };
```

`handleDrop` currently computes `targetIndex` from `visibleWidgetsFor(editingOrientation)`. Since drops now target the FULL order, change to:

```tsx
  const handleDrop = (targetId: WidgetId) => (event: React.DragEvent) => {
    event.preventDefault();
    const sourceId = (event.dataTransfer.getData("text/plain") || draggingId) as WidgetId | null;
    setDraggingId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId) return;
    const targetIndex = editingOrdered.findIndex((w) => w.id === targetId);
    if (targetIndex === -1) return;
    handleReorder(sourceId, targetIndex);
  };
```

`handleMoveUp` / `handleMoveDown` stay as-is (they call `moveUpFor`/`moveDownFor` which now operate on the full order via Task 2).

- [ ] **Step 4: Add the FLIP reorder animation**

Add `useRef` to the react import (line 4 currently imports `useState, useEffect` only). Add state + refs near the top of the Layout section:

```tsx
  const rowRefs = useRef(new Map<WidgetId, HTMLDivElement | null>());
  const prevPositions = useRef<Map<WidgetId, number> | null>(null);
  const reorderPending = useRef(false);
```

(Import `useRef` from react if not already imported.)

In `handleMoveUp` / `handleMoveDown` / `handleReorder`, before calling the mutator:

```tsx
  const recordPositions = () => {
    const map = new Map<WidgetId, number>();
    for (const [id, el] of rowRefs.current) {
      if (el) map.set(id, el.getBoundingClientRect().top);
    }
    prevPositions.current = map;
    reorderPending.current = true;
  };
```

Call `recordPositions()` as the first line of `handleMoveUp`, `handleMoveDown`, `handleReorder` (and in `handleDrop` just before `handleReorder` — but `handleDrop` already calls `handleReorder`, so record there only; simplest: call `recordPositions()` inside `handleReorder` itself and also at the top of `handleMoveUp`/`handleMoveDown`; since `handleDrop` → `handleReorder`, recording inside `handleReorder` covers drag too).

Actually — `handleReorder` is called by `handleDrop`. So record inside `handleMoveUp`, `handleMoveDown`, AND `handleReorder` (each is a user action; recording in `handleReorder` covers drag; the extra call in drop is harmless but keep it minimal — record in all three for clarity).

Add the animation effect (after all handlers, before `return`):

```tsx
  useEffect(() => {
    if (!reorderPending.current || !prevPositions.current) return;
    reorderPending.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const prev = prevPositions.current;
    prevPositions.current = null;
    for (const [id, el] of rowRefs.current) {
      if (!el) continue;
      const oldTop = prev.get(id);
      if (oldTop === undefined) continue;
      const newTop = el.getBoundingClientRect().top;
      const delta = oldTop - newTop;
      if (Math.abs(delta) < 1) continue;
      el.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  }, [editingOrdered]);
```

The effect depends on `editingOrdered` (a new array identity after every reorder commit) so it runs after the re-render.

Note: `el.animate` requires the element to be in the DOM — after React commits the new list, the refs point to the new rows. The old positions were recorded pre-mutation. FLIP works: oldTop = recorded, newTop = post-commit.

- [ ] **Step 5: Update the "N on Home" header + help modal copy**

Find the header line rendering the visible count (search for "on Home" / `editingVisible.length`) and make sure it uses `visibleCount`. Update the Help modal copy (find the modal content, likely near the bottom):

Replace copy about Visible/Hidden groups with:

```
Widgets are listed in the order they appear on Home. Toggle a widget off and its row stays in place, dimmed — hidden widgets don't appear on the Home dashboard. Use ↑/↓ or drag the ⋮⋮ handle to reorder any row, hidden or visible. Each device type (Phone / Tablet / Desktop) keeps its own order and visibility.
```

- [ ] **Step 6: Typecheck + lint + tests**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: typecheck clean (page.tsx was fixed in this task; if `src/app/page.tsx` still fails on `hiddenWidgetsFor` usage, fix it here too — see Task 5 note: the Home page consumes `widgetsFor`/`visibleWidgetsFor` which now return the same shape, so likely no change needed; check for `hiddenWidgets` usage in page.tsx and remove if present).

- [ ] **Step 7: Playwright verification**

Write `/tmp/verify-calm-motion.py` (pattern from the existing repro scripts — plain `page.goto` + fixed waits, `domcontentloaded`, no networkidle):

- Load `http://localhost:3000/settings`, wait for the Layout & display card.
- Toggle off a widget (e.g. weather): assert the row still exists at the same index (no teleport), its `opacity` drops (computed style contains `0.55`-ish), the Toggle knob is at the OFF position, "N on Home" decremented.
- Toggle it back on: row brightens, count increments.
- Click ↑ on the first row: row order changes; after ~300ms the animation has settled (assert `getAnimations().length === 0` after wait).
- Emulate `prefers-reduced-motion: reduce` via `context.emulateMedia({ reducedMotion: "reduce" })`; click ↑; assert `getAnimations().length === 0` immediately after click.
- Drag from the ⋮⋮ handle to another row: reorders.
- Reload the page: order + hidden state persist (read `localStorage["consuela-home-layout"]` — assert it contains `hidden` arrays).

Keep the script in /tmp (not committed).

- [ ] **Step 8: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(ui): layout editor single list — in-place toggles, dimmed hidden rows, FLIP reorder glide"
```

---

### Task 5: Home page + Toggle knob slide + docs

**Files:**
- Modify: `src/app/page.tsx` (if it consumes removed hook members — check)
- Modify: `src/components/ui/Toggle.tsx:35` (knob transition)
- Modify: `AGENTS.md` (snapshot, UI Change Record, Change Log, Stream C exclusion note)

**Interfaces:**
- Consumes: `useHomeLayout` context (updated shape), `Toggle` props.
- Produces: final state — Home renders visible widgets only; toggle knob slides; docs current.

- [ ] **Step 1: Check/fix Home page consumers**

`src/app/page.tsx:96` destructures `const { widgets, orientation, mounted: layoutMounted } = useHomeLayout();` and line 312 maps `widgets`. After Task 3, `widgets` is the FULL order (hidden included) — **Home must render only visible widgets**, otherwise hidden widgets appear on Home. Fix — line 96:

```tsx
  const { visibleWidgets, orientation, mounted: layoutMounted } = useHomeLayout();
```

and replace the map at line 312 (`visibleWidgets` is `WidgetDef[]`, so the callback receives `WidgetDef` — extract `id` from it):

```tsx
            {visibleWidgets.map((w, index) => {
              const id = w.id;
              const span = layoutMounted
                ? orientation === "tablet"
                  ? tabletSpan(index, visibleWidgets.length)
                  : widgetSpanClass(id, orientation)
                : (WIDGET_SPANS[id] ?? "lg:col-span-1");
              switch (id) {
```

The `tabletSpan(index, visibleWidgets.length)` count change matters: `widgets.length` would always be 9 (full order), which breaks the odd-count logic when a widget is hidden.

- [ ] **Step 2: Toggle knob slide**

`src/components/ui/Toggle.tsx:34-38` — replace:

```tsx
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "left-6" : "left-1"
          }`}
        />
```

with:

```tsx
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${
            checked ? "left-6" : "left-1"
          }`}
        />
```

(`transition-transform` → `transition-all` so the `left-1`↔`left-6` position change animates.)

- [ ] **Step 3: Typecheck + lint + full tests**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: typecheck clean, lint 0 new (73 pre-existing baseline), all unit tests pass, build clean.

- [ ] **Step 4: AGENTS.md updates (mandatory same-session)**

Update:
1. **"Current Dashboard Snapshot"** — rewrite the Layout & display portion: single unified list, in-place toggles, hidden rows dimmed in place, v4 storage `{ widgets, hidden }`, reorder glide animation, ListRow motion removal.
2. **UI Change Record** — new block at the top of the section (copy the exact format from the 2026-08-18 arrow-fix entry):
   - `### UI Change Record — 2026-08-18 — Calm-motion Layout & display: in-place toggles + glide reorders + ListRow motion removal`
   - Added/Changed: `src/components/ui/ListRow.tsx` (tap removed, focus ring kept), `src/lib/layout-config.ts` (v4 storage + migration), `src/hooks/useHomeLayout.tsx` (orderedWidgetsFor, toggleWidgetVisibility), `src/app/settings/page.tsx` (single list, dimmed rows, FLIP), `src/components/ui/Toggle.tsx` (knob slide), `tests/unit/layout-config.test.ts` (v4 contract), `tests/unit/list-row.test.tsx` (new)
   - Visual/Motion: rows no longer lift/press; toggling dims rows in place; reorders glide 260ms; knob slides
   - Color sources: none
   - Agent action required + user-facing description (copy-paste style like the others)
3. **Change Log** — append the 2026-08-18 entries (Task 1–5, matching the commits).
4. **Stream C note** — in the `.tap` exclusion list (where Avatar/Badge/Toggle/Toast/TextField are listed), add ListRow.

- [ ] **Step 5: Final browser smoke**

Open http://localhost:3000 in the browser (user side): Home shows only visible widgets; Settings → Layout & display single list; toggles dim in place; arrows glide; drag reorders; Toggle knob slides. Verify light + dark theme.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/ui/Toggle.tsx AGENTS.md
git commit -m "feat(ui): toggle knob slide + Home visible-only render + AGENTS.md calm-motion records"
```