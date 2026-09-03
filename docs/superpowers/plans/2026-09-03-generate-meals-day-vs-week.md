# Generate Meals: Day vs Week Scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping ✨ Generate on /meals Plan opens an option sheet letting the family generate meals for just the highlighted day or the whole week; both modes fill empty slots only.

**Architecture:** `useMeals.generateWeeklyPlan` gains an optional `days?: string[]` scope param (single-day prompt + defensive entry filter, all persistence machinery shared). A new presentational `GenerateScopeSheet` component (shared `Modal`, which portals above the capsule nav) is wired into `PlanTab` behind the Generate button.

**Tech Stack:** Next.js 16 + React 19, Tailwind CSS 4, Vitest (jsdom, `createRoot` + `act` harness pattern — no testing-library).

**Spec:** `docs/superpowers/specs/2026-09-03-generate-meals-day-vs-week-design.md`

## Global Constraints

- CSS-only motion; existing `modalEnter`/`modalExit` spring language untouched; `prefers-reduced-motion` already handled by `Modal`.
- No new dependencies. No real PINs/secrets in client code.
- Tests query portaled Modals against `document.body`, never the mount container (Modal portals since 2026-09-03).
- Meal slot ids are exactly `breakfast | lunch | snack | dinner`; week days exactly `Mon Tue Wed Thu Fri Sat Sun`.
- Every task ends with the full suite green (`npx vitest run`), `npx tsc --noEmit` clean, and `npx eslint <touched files>` clean.
- Work happens locally in the `Home-ai` submodule; commit per task; **no pushes to the NAS / no deploys**.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/hooks/useMeals.ts` | Modify (`generateWeeklyPlan`, ~line 131) | Accept `days?: string[]`; single-day prompt; filter returned entries to scope |
| `src/components/meals/GenerateScopeSheet.tsx` | Create | Presentational option sheet: "Just {Day}" / "Whole week" cards + counts |
| `src/components/meals/PlanTab.tsx` | Modify (button ~line 283, imports, state) | Open the sheet on Generate; wire callbacks to `generateWeeklyPlan` |
| `tests/unit/meals-generate-scope.test.tsx` | Create | Hook tests: day-scope prompt + filtering, week unchanged, occupied skip |
| `tests/unit/generate-scope-sheet.test.tsx` | Create | Sheet tests: option taps, disabled full-day card |

---

### Task 1: `generateWeeklyPlan` day scope (hook)

**Files:**
- Modify: `src/hooks/useMeals.ts:131-205`
- Test: `tests/unit/meals-generate-scope.test.tsx` (create)

**Interfaces:**
- Consumes: existing `useMeals()` hook, mocked `@/db`, mocked `global.fetch`.
- Produces: `generateWeeklyPlan(weekOf: string, overwrite?: boolean, days?: string[]) => Promise<void>` — Task 2/3 call it with `[activeDay]` for day mode and omit `days` for week mode.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/meals-generate-scope.test.tsx`. Harness pattern mirrors `tests/unit/meal-recipe-autosave.test.tsx` (vi.hoisted db mock + `createRoot` + `act`; `fetch` stubbed per test, capturing the request body):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useEffect } from "react";

const h = vi.hoisted(() => ({
  meals: [] as any[],
  pantry: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    gatewayReadStatus: async (collection: string) =>
      collection === "meal_plan_entries"
        ? { items: h.meals.map((m) => ({ ...m })), blocked: false }
        : { items: [], blocked: false },
    selectMeals: async () => h.meals.map((m) => ({ ...m })),
    selectPantry: async () => h.pantry,
    insertMeal: async (meal: any) => { h.meals.push({ ...meal }); return { ...meal }; },
    deleteMeal: async (id: string) => {
      const idx = h.meals.findIndex((m) => String(m.id) === id);
      if (idx === -1) return false;
      h.meals.splice(idx, 1);
      return true;
    },
    mealsStore: h.meals,
  },
}));

import { useMeals } from "@/hooks/useMeals";

let result: any;
function Harness() {
  const m = useMeals();
  useEffect(() => { result = m; });
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

let lastBody: any = null;
function stubFetch(content: string) {
  lastBody = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: any, opts: any) => {
    lastBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content }) };
  }));
}

const entry = (day: string, mealType: string, name: string) =>
  ({ day, mealType, name, emoji: "🍳", tags: [], prepTime: "20 min" });

beforeEach(() => {
  h.meals = [];
  h.pantry = [];
  localStorage.clear();
  result = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("generateWeeklyPlan day scope", () => {
  it("day scope: prompts for the single day and inserts only that day's meals", async () => {
    await mount();
    stubFetch(JSON.stringify({
      meal_plan: [entry("Wed", "breakfast", "Oats"), entry("Thu", "dinner", "Tacos"), entry("Fri", "lunch", "Subs")],
    }));
    await act(async () => { await result.generateWeeklyPlan("2026-09-01", false, ["Wed"]); });
    expect(lastBody.message).toContain("Wednesday only");
    expect(lastBody.message).not.toContain("complete week");
    const names = h.meals.map((m) => m.name);
    expect(names).toEqual(["Oats"]);
    expect(h.meals[0].time).toBe("Wed");
    expect(h.meals[0].weekOf).toBe("2026-09-01");
  });

  it("week mode unchanged: prompts for the full week and inserts every returned day", async () => {
    await mount();
    stubFetch(JSON.stringify({
      meal_plan: [entry("Wed", "dinner", "Tacos"), entry("Thu", "dinner", "Curry")],
    }));
    await act(async () => { await result.generateWeeklyPlan("2026-09-01", false); });
    expect(lastBody.message).toContain("complete week");
    expect(h.meals.map((m) => m.name).sort()).toEqual(["Curry", "Tacos"]);
  });

  it("day scope still skips slots already planned that day", async () => {
    h.meals.push({ id: 99, name: "Planned Dinner", time: "Wed", mealType: "dinner", weekOf: "2026-09-01" });
    await mount();
    stubFetch(JSON.stringify({
      meal_plan: [entry("Wed", "dinner", "AI Dinner"), entry("Wed", "breakfast", "Pancakes")],
    }));
    await act(async () => { await result.generateWeeklyPlan("2026-09-01", false, ["Wed"]); });
    const names = h.meals.map((m) => m.name);
    expect(names).toContain("Planned Dinner");
    expect(names).not.toContain("AI Dinner");
    expect(names).toContain("Pancakes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/meals-generate-scope.test.tsx`
Expected: test 1 FAILS (`lastBody.message` lacks "Wednesday only" — the third arg is ignored today); tests 2–3 pass (they encode current behavior as a regression guard).

- [ ] **Step 3: Implement the scope param**

In `src/hooks/useMeals.ts`, replace the signature + prompt (lines 131-143) — keep everything else in the callback identical:

```ts
  const generateWeeklyPlan = useCallback(async (weekOf: string, overwrite = false, days?: string[]) => {
    setWeeklyPlanLoading(true);
    setWeeklyPlanError(null);
    try {
      const pantry = (await db.selectPantry()).map((p: any) => p.name || p.item).join(", ");
      const dayList = days?.join(", ") || "Mon, Tue, Wed, Thu, Fri, Sat, Sun";
      const coverage = days?.length
        ? `Cover breakfast, lunch, snack, and dinner for ${dayList} only (${days.length * 4} entries).`
        : "Cover breakfast, lunch, snack, and dinner for Mon, Tue, Wed, Thu, Fri, Sat, Sun.";
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Generate ${days?.length ? `${dayList} only — a day of meals` : "a complete week of meals"} for a family of 7 (kids ages 5-14). Daily targets: 2000 kcal, 150g protein, 300g carbs, 65g fat. Pantry has: ${pantry || "basic ingredients"}. Return ONLY JSON as {"meal_plan":[ ... ${days?.length ? days.length * 4 : 28} entries ... ]} — each entry: {"day":"Mon","mealType":"breakfast","name":"Meal Name","emoji":"🍳","tags":["Kid-friendly","Quick"],"prepTime":"30 min"}. ${coverage} No prose, just the JSON.`,
          persist: false,
        }),
      });
```

Note: the day prompt contains the literal day abbreviations (`Wed`), and the test asserts `"Wednesday only"` — so instead use full names in the phrase. Build the prompt line as:

```ts
const FULL_DAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const dayPhrase = days?.length ? `${days.map((d) => FULL_DAYS[d] || d).join(", ")} only — a day of meals` : "a complete week of meals";
```

and interpolate `dayPhrase` after `Generate ` (so the day-mode message contains "Wednesday only" and never "complete week").

Then, right after `planItems` is populated (after the fallback parse block, before the `if (!planItems.length)` check), add the defensive filter:

```ts
      if (days?.length) {
        const scope = new Set(days.map((d) => d.toLowerCase()));
        planItems = planItems.filter((item: any) =>
          scope.has(String(item.day || item.time || "").toLowerCase())
        );
      }
```

(Move the `if (!planItems.length) { setWeeklyPlanError("No plan returned — try again"); … }` block AFTER the filter so an all-out-of-scope response reports honestly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/meals-generate-scope.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMeals.ts tests/unit/meals-generate-scope.test.tsx
git commit -m "feat(meals): day-scope param on generateWeeklyPlan"
```

---

### Task 2: `GenerateScopeSheet` component

**Files:**
- Create: `src/components/meals/GenerateScopeSheet.tsx`
- Test: `tests/unit/generate-scope-sheet.test.tsx` (create)

**Interfaces:**
- Consumes: `Modal` (`src/components/ui/Modal.tsx` — portals to body), `SoftButton`.
- Produces: `<GenerateScopeSheet open dayName dayEmpty weekEmpty onDay onWeek onCancel />` — `dayName` is the abbrev ("Wed"), `dayEmpty`/`weekEmpty` are empty-slot counts; `onDay` fires only when `dayEmpty > 0`. Task 3 renders it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/generate-scope-sheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import GenerateScopeSheet from "@/components/meals/GenerateScopeSheet";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;

async function mount(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<GenerateScopeSheet {...props} />); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

const text = () => document.body.textContent || "";

it("shows both options with slot counts", async () => {
  await mount({ open: true, dayName: "Wed", dayEmpty: 3, weekEmpty: 12, onDay: vi.fn(), onWeek: vi.fn(), onCancel: vi.fn() });
  expect(text()).toContain("Just Wednesday");
  expect(text()).toContain("Fills 3 empty slots on this day");
  expect(text()).toContain("Whole week");
  expect(text()).toContain("Fills 12 empty slots across Mon–Sun");
});

it("tapping an option calls its handler", async () => {
  const onDay = vi.fn(); const onWeek = vi.fn();
  await mount({ open: true, dayName: "Wed", dayEmpty: 3, weekEmpty: 12, onDay, onWeek, onCancel: vi.fn() });
  const buttons = [...document.querySelectorAll("button")];
  await act(async () => { buttons.find((b) => b.textContent?.includes("Just Wednesday"))!.click(); });
  expect(onDay).toHaveBeenCalledTimes(1);
  await act(async () => { buttons.find((b) => b.textContent?.includes("Whole week"))!.click(); });
  expect(onWeek).toHaveBeenCalledTimes(1);
});

it("full day disables the day option", async () => {
  const onDay = vi.fn();
  await mount({ open: true, dayName: "Wed", dayEmpty: 0, weekEmpty: 5, onDay, onWeek: vi.fn(), onCancel: vi.fn() });
  const dayBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("This day is already full"));
  expect(dayBtn).toBeTruthy();
  expect(dayBtn!.disabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/generate-scope-sheet.test.tsx`
Expected: FAIL — cannot resolve `@/components/meals/GenerateScopeSheet`.

- [ ] **Step 3: Implement the component**

Create `src/components/meals/GenerateScopeSheet.tsx`:

```tsx
"use client";
import Modal from "@/components/ui/Modal";

const dayFullNames: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

interface GenerateScopeSheetProps {
  open: boolean;
  dayName: string;
  dayEmpty: number;
  weekEmpty: number;
  onDay: () => void;
  onWeek: () => void;
  onCancel: () => void;
}

export default function GenerateScopeSheet({ open, dayName, dayEmpty, weekEmpty, onDay, onWeek, onCancel }: GenerateScopeSheetProps) {
  const full = dayEmpty === 0;
  return (
    <Modal open={open} onClose={onCancel} title="Generate meals" description="Consuela fills only empty slots — planned meals stay put.">
      <div className="space-y-3">
        <button
          type="button"
          disabled={full}
          onClick={onDay}
          className={`w-full rounded-2xl border p-4 text-left transition-colors ${
            full
              ? "cursor-not-allowed border-white/5 bg-[var(--color-surface-2)]/40 opacity-60"
              : "border-[var(--color-accent-selected)]/25 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]/70"
          }`}
        >
          <span className="block text-sm font-semibold text-text-primary">✨ Just {dayFullNames[dayName] || dayName}</span>
          <span className="mt-0.5 block text-xs text-text-secondary">
            {full ? "This day is already full" : `Fills ${dayEmpty} empty slot${dayEmpty === 1 ? "" : "s"} on this day`}
          </span>
        </button>
        <button
          type="button"
          disabled={weekEmpty === 0}
          onClick={onWeek}
          className={`w-full rounded-2xl border p-4 text-left transition-colors ${
            weekEmpty === 0
              ? "cursor-not-allowed border-white/5 bg-[var(--color-surface-2)]/40 opacity-60"
              : "border-[var(--color-accent-selected)]/25 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]/70"
          }`}
        >
          <span className="block text-sm font-semibold text-text-primary">🗓️ Whole week</span>
          <span className="mt-0.5 block text-xs text-text-secondary">
            {weekEmpty === 0 ? "The week is already full" : `Fills ${weekEmpty} empty slot${weekEmpty === 1 ? "" : "s"} across Mon–Sun`}
          </span>
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/generate-scope-sheet.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/meals/GenerateScopeSheet.tsx tests/unit/generate-scope-sheet.test.tsx
git commit -m "feat(meals): GenerateScopeSheet day-vs-week option sheet"
```

---

### Task 3: Wire the sheet into PlanTab + verify live

**Files:**
- Modify: `src/components/meals/PlanTab.tsx` (imports ~line 14, state ~line 107, button ~line 283, render near the other sheets at the bottom)

**Interfaces:**
- Consumes: `GenerateScopeSheet` (Task 2), `generateWeeklyPlan(weekOf, overwrite, days?)` (Task 1), PlanTab props `meals`, `activeDay`, `activeWeek`, `weeklyPlanLoading`, `generateWeeklyPlan` (all already passed from `src/app/meals/page.tsx:393`).
- Produces: user-facing behavior; nothing further consumes it.

- [ ] **Step 1: Add import + state + counts**

In `src/components/meals/PlanTab.tsx`, after the `RecipeBox` import (line 14):

```tsx
import GenerateScopeSheet from "@/components/meals/GenerateScopeSheet";
```

Inside the component, next to the other `useState`s (~line 107, after `showRecipeBox`):

```tsx
  const [generateSheetOpen, setGenerateSheetOpen] = useState(false);
```

After the existing `mealTypes` const is in scope (module level), compute slots inside the component (before `return`):

```tsx
  const weekMealKeys = new Set(
    meals.filter((m: Meal) => (m.weekOf || activeWeek) === activeWeek).map((m: Meal) => `${m.time}-${m.mealType}`)
  );
  const dayEmpty = mealTypes.filter((t) => !weekMealKeys.has(`${activeDay}-${t.id}`)).length;
  const weekEmpty = weekDays.reduce((n, d) => n + mealTypes.filter((t) => !weekMealKeys.has(`${d}-${t.id}`)).length, 0);
```

- [ ] **Step 2: Change the Generate button to open the sheet**

Replace the button block at ~line 283:

```tsx
                {generateWeeklyPlan && (
                  <SoftButton
                    size="sm"
                    variant="secondary"
                    loading={weeklyPlanLoading}
                    onClick={() => generateWeeklyPlan(activeWeek, false)}
                  >
                    ✨ Generate
                  </SoftButton>
                )}
```

with:

```tsx
                {generateWeeklyPlan && (
                  <SoftButton
                    size="sm"
                    variant="secondary"
                    loading={weeklyPlanLoading}
                    onClick={() => setGenerateSheetOpen(true)}
                  >
                    ✨ Generate
                  </SoftButton>
                )}
```

- [ ] **Step 3: Render the sheet**

Near the bottom of the component's JSX (beside the other overlay-style blocks, before the closing fragment/div), add:

```tsx
      <GenerateScopeSheet
        open={generateSheetOpen}
        dayName={activeDay}
        dayEmpty={dayEmpty}
        weekEmpty={weekEmpty}
        onDay={() => { setGenerateSheetOpen(false); generateWeeklyPlan(activeWeek, false, [activeDay]); }}
        onWeek={() => { setGenerateSheetOpen(false); generateWeeklyPlan(activeWeek, false); }}
        onCancel={() => setGenerateSheetOpen(false)}
      />
```

- [ ] **Step 4: Typecheck + lint + full suite**

```bash
npx tsc --noEmit
npx eslint src/components/meals/PlanTab.tsx src/components/meals/GenerateScopeSheet.tsx src/hooks/useMeals.ts
npx vitest run
```
Expected: tsc silent, eslint silent, suite all green (916 + 6 new = 922).

- [ ] **Step 5: Live browser verification (dev server on :3000, 390×844)**

Playwright probe (temp script under `scripts/consuela/`, delete after):
1. `/meals` → tap `✨ Generate` → sheet opens with "Just {activeDay}" + "Whole week" cards, counts visible, sheet above the capsule nav (portaled).
2. Tap "Whole week" → sheet closes, button shows loading, existing error pill untouched.
3. Tap "Just {day}" with a day that has all 4 slots → card disabled.
4. 0 page errors; screenshot for the record.

- [ ] **Step 6: Update AGENTS.md (mandatory for UI changes)**

Add a `### UI Change Record — 2026-09-03 — Meals ✨ Generate gains a day-vs-week option sheet` entry (delta format: Added/Changed, Visual/Motion, Color sources, Agent action, User-facing description), a "Current Dashboard Snapshot" bullet, and a Change Log line. Note the new contract: `generateWeeklyPlan(weekOf, overwrite, days?)` and `GenerateScopeSheet` props.

- [ ] **Step 7: Commit**

```bash
git add src/components/meals/PlanTab.tsx AGENTS.md
git commit -m "feat(meals): day-vs-week picker behind the Generate button"
```

---

## Self-Review Notes

- Spec coverage: hook scope (Task 1), sheet UI + counts + disabled full-day (Task 2), wiring + loading/error reuse + docs (Task 3). "Out of scope" items have no tasks — correct.
- The Task 1 prompt code block went through one correction inline (full day names in `dayPhrase`) — implementers use the final `dayPhrase` version, and the test asserts "Wednesday only" / not "complete week", which it satisfies.
- Type consistency: `days?: string[]` (Task 1) ↔ `[activeDay]` (Task 3); `dayEmpty`/`weekEmpty`/`onDay`/`onWeek`/`onCancel` names match between Tasks 2 and 3.
