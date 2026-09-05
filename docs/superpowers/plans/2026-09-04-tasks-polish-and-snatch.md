# Tasks polish + "Snatch the task" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the `/tasks` surface (honest AI fallbacks, zero-point champion state, filter-aware stat tiles, touch targets, desktop width, copy, pets, stagger) and add the opt-in "Stealable / up for grabs when late" mechanic where a task whose due date has passed becomes claimable by any member, with the points going to the snatcher.

**Architecture:** A new pure `isSnatchable(task)` helper in `task-utils.ts` gates everything; `Task.stealable?: boolean` is persisted through `syncTasksToPB` and the `tasks` PB collection; the existing server-authoritative `/api/tasks/claim` route gains a stealable-and-late branch. Page-level polish lives entirely in `src/app/tasks/page.tsx` plus one new `.hit-44` utility in `globals.css`. No visual-world changes — incumbent warm-glass tokens only.

**Tech Stack:** Next.js 16.2.6 + React 19 + Tailwind v4, TypeScript strict, Vitest + @testing-library/jsdom, Playwright, PocketBase.

## Global Constraints

- Family voice everywhere ("grabbed", "snatched"), no emoji removal, no new palette entries, no new keyframes; `prefers-reduced-motion` untouched.
- 11px text floor; all new/changed interactive controls ≥44px effective hit target (via `.hit-44` or size).
- Never trust client-supplied points/task content on the server; all claim writes stay server-authoritative.
- Desktop container: 768px content column (`lg:max-w-3xl`), `PageShell` untouched.
- Kid-safety: every suggestion/chip tap fills an editable draft, never a hidden write.
- Pet members (`role === "pet"`) are excluded from assignee select + member filter strip.
- After ALL code changes: `npm run typecheck`, `npx eslint` on touched files, `npx vitest run --reporter=dot`, production build clean, live Playwright probe green, then update `Home-ai/AGENTS.md` in the same session (mandatory project rule) and commit.

---

### Task 1: `Task.stealable` type + `isSnatchable` helper

**Files:**
- Modify: `src/types/tasks.ts`
- Modify: `src/lib/task-utils.ts`
- Test: `tests/unit/tasks-snatchable.test.ts` (NEW)

- [ ] **Step 1: Failing test.** Create `tests/unit/tasks-snatchable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isSnatchable } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

function t(over: Partial<Task>): Task {
  return {
    id: 1, title: "Dishes", assignee: "Emily", assigneeEmoji: "👧",
    due: "2026-09-04", points: 10, recurring: null, category: "Chores",
    completed: false, priority: "medium", ...over,
  };
}

const TODAY = "2026-09-04";

describe("isSnatchable", () => {
  it("true only for stealable, incomplete tasks with due strictly before today", () => {
    expect(isSnatchable(t({ stealable: true, due: "2026-09-03" }), TODAY)).toBe(true);
    expect(isSnatchable(t({ stealable: true, due: TODAY }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, due: "2026-09-05" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, completed: true, due: "2026-09-03" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: false, due: "2026-09-03" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ due: "2026-09-03" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, due: "" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, due: "2026-09-03", universal: true }), TODAY)).toBe(true);
  });
  it("defaults `today` to the real local date", () => {
    expect(isSnatchable(t({ stealable: true, due: "2026-08-01" }))).toBe(true); // long past
    expect(isSnatchable(t({ stealable: true, due: "2999-01-01" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail.** `npx vitest run tests/unit/tasks-snatchable.test.ts` → "isSnatchable is not a function".

- [ ] **Step 3: Implement.** In `src/types/tasks.ts` add to `Task`: `stealable?: boolean;` (after `universal?: boolean;`). In `src/lib/task-utils.ts` add after `todayISO()`:

```ts
// A stealable task becomes anyone's game the day AFTER its due date (day
// precision — tasks carry date-only dues). Universal is independent.
export function isSnatchable(task: Task, today: string = todayISO()): boolean {
  return !!task.stealable && !task.completed && !!task.due && task.due < today;
}
```

- [ ] **Step 4: Run, expect pass.** `npx vitest run tests/unit/tasks-snatchable.test.ts` → 2/2 pass.

- [ ] **Step 5: Commit.**

```bash
git add src/types/tasks.ts src/lib/task-utils.ts tests/unit/tasks-snatchable.test.ts
git commit -m "feat(tasks): Task.stealable flag + isSnatchable() helper"
```

---

### Task 2: Persist `stealable` (syncTasksToPB + pb-seed)

**Files:**
- Modify: `src/lib/task-utils.ts` (`syncTasksToPB`)
- Modify: `src/lib/pb-seed.ts` (tasks collection)
- Test: `tests/unit/tasks-snatchable.test.ts` (append) + `tests/unit/pb-seed-field-heal.test.ts`

- [ ] **Step 1: Failing tests.** Append to `tests/unit/tasks-snatchable.test.ts`:

```ts
import { vi } from "vitest";
vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));
import { db } from "@/db";
import { syncTasksToPB } from "@/lib/task-utils";

describe("syncTasksToPB stealable persistence", () => {
  it("writes stealable:true when set, false otherwise", async () => {
    await syncTasksToPB([
      { id: 1, title: "A", assignee: "X", assigneeEmoji: "🧒", due: "2026-09-04", points: 5, recurring: null, category: "Chores", completed: false, priority: "low", stealable: true },
      { id: 2, title: "B", assignee: "Y", assigneeEmoji: "👧", due: "2026-09-04", points: 5, recurring: null, category: "Chores", completed: false, priority: "low" },
    ]);
    const calls = vi.mocked(db.upsertTask).mock.calls;
    expect(calls[0][0].stealable).toBe(true);
    expect(calls[1][0].stealable).toBe(false);
  });
});
```

Add to `tests/unit/pb-seed-field-heal.test.ts`:

```ts
it("tasks collection carries the stealable bool field", () => {
  const tasksDef = COLLECTIONS.find((c) => c.name === "tasks")!;
  const f = tasksDef.schema.find((s: any) => s.name === "stealable");
  expect(f).toBeDefined();
  expect(f.type).toBe("bool");
});
```

- [ ] **Step 2: Run, expect fail:** `npx vitest run tests/unit/tasks-snatchable.test.ts tests/unit/pb-seed-field-heal.test.ts`

- [ ] **Step 3: Implement.**
  - `src/lib/task-utils.ts` `syncTasksToPB`: add `stealable: task.stealable || false,` to the `db.upsertTask({…})` object (next to `universal:`).
  - `src/lib/pb-seed.ts` tasks schema: add `{ name: "stealable", type: "bool" },` after the `universal` field.

- [ ] **Step 4: Run, expect pass** (both files).

- [ ] **Step 5: Commit** — `fix(tasks): persist stealable flag through PB sync + tasks schema`.

**Note for ops (do NOT code):** the self-heal on next `npm run pb:seed` adds the live `stealable` field. Include this in the final AGENTS.md note.

---

### Task 3: Claim route accepts stealable + past-due tasks

**Files:**
- Modify: `src/app/api/tasks/claim/route.ts`
- Test: `tests/unit/task-claim.test.ts`

**Interfaces:**
- Consumes: `isSnatchable` semantics from Task 1 — but the route re-implements the day-comparison inline on the PB row (server-trusted row fields `universal`, `stealable`, `due`).
- Produces: claimable = `task.universal !== false` OR (`task.stealable === true` AND `task.due < localTodayISO()`). Same reasons: `unknown-task` (404), `not_universal` → keep the existing 400 mapping for UI copy compatibility; adds `not_late_yet` (400) for `stealable && due >= today`.

- [ ] **Step 1: Failing tests.** Add to `tests/unit/task-claim.test.ts` (extend `makePb` with `taskRow` overrides: `taskRow` opts `universal`, `stealable`, `due`):

```ts
function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

it("accepts a stealable task whose due date passed (universal false)", async () => {
  const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: true, due: yesterdayISO() } });
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

  const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

  expect(res.status).toBe(200);
  expect((await res.json()).success).toBe(true);
});

it("rejects a stealable task that is not late yet", async () => {
  const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: true, due: mondayISO() /* today-or-later is fine for the guard as long as >= today */ } });
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

  const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ success: false, reason: "not_late_yet" });
});

it("rejects a non-universal, non-stealable task", async () => {
  const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: false, due: yesterdayISO() } });
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

  const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

  expect(res.status).toBe(400);
  expect((await res.json()).reason).toBe("not_universal");
});
```

Note: the existing four tests use a task row with `{ id, taskId: 42, title, points }` and no `universal` — the route tolerates missing universal. Widen `makePb`'s `taskRow` construction: `{ id: "task-row-1", taskId: 42, title: "Dishes", points: opts?.taskPoints ?? 5, ...(opts?.taskRow || {}) }`.

- [ ] **Step 2: Run, expect fail** — `npx vitest run tests/unit/task-claim.test.ts` (new tests fail: no `stealable` handling yet).

- [ ] **Step 3: Implement.** In `src/app/api/tasks/claim/route.ts` add a local-day helper next to `currentWeekKey()`:

```ts
function localTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

Replace the `task.universal === false` guard with:

```ts
// Claimable = universal ("up for grabs") OR stealable whose due date has
// passed (day precision, server local day — due is YYYY-MM-DD).
const universalOk = task.universal !== false;
const stealableLate = task.stealable === true && typeof task.due === "string" && task.due.length === 10 && task.due < localTodayISO();
if (!universalOk && !stealableLate) {
  return { ok: false, reason: "not_universal" } as const;
}
if (!universalOk && task.stealable === true && !stealableLate) {
  return { ok: false, reason: "not_late_yet" } as const;
}
```

Personalize the earn-ledger line for steals (a snatch should read as one):

```ts
const isSnatch = !universalOk && stealableLate;
// …in the tx object:
description: `${isSnatch ? "Snatched" : "Completed"}: ${task.title || "task"}${amount > 0 ? ` (+${amount}pts)` : ""}`,
```

Also update the `result.reason` → status map: add `result.reason === "not_late_yet" ? 400 :` to the existing ternary chain.

- [ ] **Step 4: Run, expect pass** — `npx vitest run tests/unit/task-claim.test.ts` → 7/7 (4 old + 3 new).

- [ ] **Step 5: Commit** — `feat(tasks): claim route accepts stealable tasks past their due date`.

---

### Task 4: Client surface — snatch rows, claim handoff, meta copy

**Files:**
- Modify: `src/app/tasks/page.tsx`

**Interfaces:**
- Consumes: `isSnatchable` from Task 1; `pickDefaultClaimMember` (existing).
- Produces: `openPinEntry(taskId)` now treatable for universal OR stealable-late tasks; page shows stealable-late rows under "Up for grabs" and "My Tasks" with a "was due {label}" meta.

- [ ] **Step 1: Failing page test.** Create `tests/unit/tasks-snatchable-flow.test.tsx` (copy the mocking harness from `tests/unit/tasks-guest-sync-state.test.tsx`: `vi.mock("next/navigation")`, `vi.mock("@/hooks/useAuth")` guest `{ currentUser: null, isLoggedIn: false }`, `vi.mock("@/db")` with `selectMembers`/`selectMembersFallback` returning Rebecca/Jasmine/Emily non-pets + Rocco pet, `SyncInit` null-stub, fetch stub `401` for `/api/tasks/sync`+`200` for others):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
// ... harness mirrors tasks-guest-sync-state.test.tsx ...

function seedTasks() {
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; })();
  const todayISO = new Date().toISOString().split("T")[0];
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 10, title: "Wipe the bathroom counters (late)", assignee: "Emily", assigneeEmoji: "👧", due: yesterday, points: 12, recurring: null, category: "Chores", completed: false, priority: "high", stealable: true },
    { id: 11, title: "Water the plants (on time)", assignee: "Jasmine", assigneeEmoji: "👧", due: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; })(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low", stealable: true },
    { id: 12, title: "Fold laundry", assignee: "Jasmine", assigneeEmoji: "👧", due: todayISO, points: 8, recurring: null, category: "Chores", completed: false, priority: "low" },
  ]));
}

it("Up for grabs shows late stealable tasks and hides on-time stealable ones", async () => {
  seedTasks();
  const el = await renderAsync(<TasksPage />);
  await settle();
  // switch to the Up for grabs filter: click the member tile labeled "Up for grabs"
  const upBtn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Up for grabs"));
  expect(upBtn).toBeTruthy();
  upBtn!.click();
  await settle();
  const text = el.textContent || "";
  expect(text).toContain("Wipe the bathroom counters");
  expect(text).not.toContain("Water the plants");
  expect(text).toContain("was due");
});
```

- [ ] **Step 2: Run, expect fail** — `npx vitest run tests/unit/tasks-snatchable-flow.test.tsx` (no "was due", "Water the plants" still matches "Up for grabs" only if universal — it isn't).

- [ ] **Step 3: Implement.** In `src/app/tasks/page.tsx`:

  a. Import: add `isSnatchable` to the `@/lib/task-utils` import block.

  b. `filtered` — extend the two claimable branches and the Up-for-grabs branch:

```tsx
if (filterMember === "Up for grabs") {
  return (t.universal || isSnatchable(t)) && (showCompleted ? true : !t.completed);
}
if (filterMember === "My Tasks" && currentUser) {
  const mine = t.assignee === currentUser.name;
  const claimable = (t.universal || isSnatchable(t)) && !t.completed;
  return (mine || claimable) && (showCompleted ? true : !t.completed);
}
```

  c. `openPinEntry` — stealable-late rows open the same claim modal as universal tasks (they need the "Claim for" select):

```tsx
if (task.universal || isSnatchable(task)) {
  // Default the claim to the signed-in member (existing behavior).
  const defaultSnatcher = pickDefaultClaimMember(membersData, currentUser?.name) || task.assignee;
  setSnatchForMember(defaultSnatcher);
} else {
  setSnatchForMember("");
}
```

  d. `submitPin` — the claim body: the existing universal branch must also fire for stealable-late tasks. Change the guard `if (task.universal)` to `if (task.universal || isSnatchable(task))`. Inside, on success the prior message remains.

  e. PIN modal title/description branch — keep "Complete" wording; update the in-modal snatch select condition: `{!pinReward && (tasks.find((t) => t.id === pinTaskId)?.universal || isSnatchable(tasks.find((t) => t.id === pinTaskId)!)) && (` for the "Claim for" select.

  f. Pending row meta line — mark snatchable rows honestly:

```tsx
<div className="truncate text-xs text-text-secondary">
  {isSnatchable(task)
    ? <>{task.assignee.split(" ")[0]} · was due {formatDueLabel(task.due)} · {task.category}</>
    : <>{task.assignee.split(" ")[0]} · {formatDueLabel(task.due)} · {task.category}</>}
</div>
```

  g. Claim success toast: when the task was stealable-late and not universal, say "snatched": compute `const wasSnatch = !task.universal && isSnatchable(task);` in `submitPin` claim branch and use `setPinSuccess(\`${first} ${wasSnatch ? "snatched" : "completed"} ${task.title}! …\`)`.

  h. `filtered` for "Up for grabs" sanity — completed stealable rows must not reappear (the `!t.completed` guard above already excludes them; `isSnatchable` also returns false for completed).

- [ ] **Step 4: Run, expect pass** — `npx vitest run tests/unit/tasks-snatchable-flow.test.tsx`.

- [ ] **Step 5: Commit** — `feat(tasks): stealable tasks surface under Up for grabs with 'was due' + claim flow`.

---

### Task 5: Add/Edit form — stealable toggle + pets excluded

**Files:**
- Modify: `src/app/tasks/page.tsx` (Add/Edit Task modal + `startAdd` + `allMembers` + filter strip)
- Test: `tests/unit/tasks-snatchable-flow.test.tsx` (append)

**Interfaces:**
- Consumes: `stealable` field from Task 1; `Toggle` shared component.

- [ ] **Step 1: Failing tests.** Append:

```tsx
it("the Add/Edit modal offers an Up-for-grabs-when-late toggle and no pet members", async () => {
  const el = await renderAsync(<TasksPage />);
  await settle();
  [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Add task")!.click();
  await settle();
  const bodyText = document.body.textContent || ""; // portals to body
  expect(bodyText).toContain("Up for grabs when late");
  expect(bodyText).not.toMatch(/Rocco[^&]*(?=(option|$))/);
  // Assignee select should not include the pet at all:
  const selects = [...document.body.querySelectorAll("select")];
  const assignee = selects.find((s) => (s.textContent || "").includes("Rebecca"));
  expect(assignee).toBeDefined();
  expect([...assignee!.querySelectorAll("option")].some((o) => (o.textContent || "").includes("Rocco"))).toBe(false);
});

it("the member filter strip hides pets", async () => {
  seedTasks();
  const el = await renderAsync(<TasksPage />);
  await settle();
  const tileNames = [...el.querySelectorAll(".member-tile-name")].map((n) => n.textContent);
  expect(tileNames).not.toContain("Rocco");
  expect(tileNames).not.toContain("Rico");
});
```

- [ ] **Step 2: Run, expect fail** (toggle text missing; pets may appear).

- [ ] **Step 3: Implement.** In `src/app/tasks/page.tsx`:

  a. Add/Edit modal, after the Universal `Toggle`:

```tsx
<Toggle
  checked={!!editForm.stealable}
  onCheckedChange={(checked) => updateForm("stealable", checked)}
  label="⏰ Up for grabs when late"
  description="If it's not done after the due date, anyone can grab it for the points."
/>
```

  b. The three member `<select>`s (Add/Edit assignee, claim for, redeem for, apply penalty) — the claim/redeem/penalty ones already filter `role !== "pet"`; the assignee select must too. Change `membersData.map(` to `membersData.filter((m: any) => m.role !== "pet").map(` in the Add/Edit assignee select only.

  c. `allMembers` (filter strip source): drop pets:

```tsx
const allMembers = useMemo(() => {
  const names = membersData.filter((m: any) => m.role !== "pet").map((m: any) => m.fullName);
  return isLoggedIn ? ["My Tasks", ...names, "Up for grabs"] : ["All", ...names, "Up for grabs"];
}, [membersData, isLoggedIn]);
```

  d. `startAdd` + `emptyTask` default member: use the first non-pet member (not `membersData[0]`):

```tsx
const firstNonPet = membersData.find((m: any) => m.role !== "pet");
const defaultMember = isLoggedIn && currentUser
  ? { name: currentUser.name, emoji: currentUser.emoji }
  : { name: firstNonPet?.fullName || "Everyone", emoji: firstNonPet?.emoji || "👤" };
setEditForm(emptyTask(defaultMember));
```

  e. `emptyTask` signature stays the same; inside keep the passed member (falling back to "Everyone"/"👤" only when no member at all is provided).

- [ ] **Step 4: Run, expect pass** — `npx vitest run tests/unit/tasks-snatchable-flow.test.tsx`.

- [ ] **Step 5: Commit** — `feat(tasks): stealable toggle in Add/Edit + pets excluded from assignee/filter`.

---

### Task 6: Daily Quests — "Do it" opens PIN, no duplication

**Files:**
- Modify: `src/app/tasks/page.tsx` (DailyQuestCard wiring)
- Modify: `src/components/leaderboard/DailyQuestCard.tsx`
- Test: `tests/unit/tasks-daily-quest.test.tsx` (NEW)

- [ ] **Step 1: Failing test.** Mirror the page harness (see Task 4 seed); sign in as Rebecca (`mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" }; isLoggedIn = true`) and seed one pending task for Rebecca. Count occurrences of the title in the page, click the quest's button, assert count unchanged + PIN modal opened:

```tsx
it("quest 'Do it' opens the task's PIN flow instead of duplicating it", async () => {
  seedTasks([{ id: 42, title: "Take out the trash", assignee: "Rebecca", assigneeEmoji: "👩", due: todayStr, points: 10, recurring: null, category: "Chores", completed: false, priority: "medium" }]);
  const el = await renderAsync(<TasksPage />);
  await settle();
  // switch to leaderboard tab so the quest card renders
  [...el.querySelectorAll('[role="radio"], button')].find((b) => (b.textContent || "").trim() === "Leaderboard")?.click();
  await settle();
  const beforeCount = (el.textContent || "").split("Take out the trash").length - 1;
  const doBtn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Do it");
  expect(doBtn).toBeTruthy();
  (doBtn as HTMLButtonElement).click();
  await settle();
  const afterCount = (el.textContent || "").split("Take out the trash").length - 1;
  expect(afterCount).toBe(beforeCount); // no duplicate
  expect(document.body.textContent).toMatch(/Enter your PIN/); // shared Modal (portaled)
});
```

- [ ] **Step 2: Run, expect fail** — quest "Go" currently duplicates (`adoptSuggestion`) and never opens the PIN modal.

- [ ] **Step 3: Implement.**

  - `src/components/leaderboard/DailyQuestCard.tsx`: the per-quest button — label "Go" → "Do it", `aria-label={`Do ${quest.title}`}`:

```tsx
<SoftButton size="sm" aria-label={`Do ${quest.title}`} onClick={() => onAccept(quest)}>Do it</SoftButton>
```

  - `src/app/tasks/page.tsx` — the prop wiring changes from `adoptSuggestion(quest)` to the PIN flow:

```tsx
<DailyQuestCard
  quests={myPendingQuests}
  onAccept={(quest) => openPinEntry(quest.id)}
  onGoToTasks={() => setActiveTab("tasks")}
/>
```

  The old inline `setAiSuggestions(prev => prev.filter(s => s.title !== quest.title))` side-effect is removed with the handler body.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** — `fix(tasks): Daily Quests 'Do it' opens PIN flow instead of duplicating the task`.

---

### Task 7: Honest AI fallbacks + "Sync Google Tasks" label

**Files:**
- Modify: `src/app/tasks/page.tsx` (`generateAiTasks`, `generateAiRewards`, Consuela-suggests button row)
- Test: `tests/unit/tasks-ai-honesty.test.tsx` (NEW)

**Interfaces:**
- Consumes: existing `Toast` (showToast).

- [ ] **Step 1: Failing test.** Mock `fetch` so `/api/hermes/chat` returns `ok: true, json: { content: "not-json-prose" }` (unparsable). Render as guest with no tasks, click "Generate", assert no suggestion cards appeared AND an honest toast fired. Also assert the sync button label:

```tsx
it("AI failure stays honest — no invented suggestions", async () => {
  const fetchMock = vi.fn(async (url: any) => {
    if (String(url).includes("/api/hermes/chat")) {
      return { ok: true, status: 200, json: async () => ({ content: "unparseable non-json answer" }) } as any;
    }
    return { ok: false, status: 401, json: async () => ({}) } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
  const el = await renderAsync(<TasksPage />);
  await settle();
  [...el.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Generate")!.click();
  await settle(80);
  expect(el.textContent).toContain("No suggestions yet");
  expect(el.textContent).not.toContain("Make your bed"); // the old hardcoded fallback
  expect(el.textContent).toContain("couldn't come up with ideas");
});
```

```tsx
it("the Google button says what it does", async () => {
  const el = await renderAsync(<TasksPage />);
  await settle();
  expect(el.textContent).toContain("Sync Google Tasks");
  expect(el.textContent).not.toMatch(/>\s*Google\s*</);
});
```

- [ ] **Step 2: Run, expect fail** — old code injects the 4 hardcoded chores and the "Google" label.

- [ ] **Step 3: Implement.** In `src/app/tasks/page.tsx`:

  - `generateAiTasks`: delete BOTH fallback `setAiSuggestions([ ... 4 hardcoded … ])` calls (the parse-fallback inside `try` and the `catch` fallback). Failure → `showToast("Consuela couldn't come up with ideas right now — try again in a bit.")`. Success with an empty parse gets the same toast (only populate when `suggestions.length > 0`).
  - `generateAiRewards`: same treatment (remove both hardcoded fallbacks, honest toast on failure/empty).
  - Consuela-suggests button row: `{googleSyncing ? "Syncing..." : "Google"}` → `{googleSyncing ? "Syncing..." : "Sync Google Tasks"}` (same on the success path).

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** — `fix(tasks): remove fake AI fallbacks; honest toast + Sync Google Tasks label`.

---

### Task 8: Fresh-week champion honesty + Share a11y + `.hit-44`

**Files:**
- Modify: `src/app/tasks/page.tsx` (champion card block), `src/app/globals.css` (new `.hit-44` utility)
- Modify: `.hit-44` applications in the same page batch (share + row buttons — the other row buttons land in Task 9's sweep; the class must exist first)
- Test: `tests/unit/tasks-champion-zero.test.tsx` (NEW)

**Interfaces:**
- Produces: `.hit-44` CSS utility consumed by this page's small controls.
- Consumes: existing tokens only.

- [ ] **Step 1: Failing tests.**

```tsx
// zero week: task-points {}, so dynamicLeaderboard is all-zero
it("fresh week: no fake champion, no 0% ring, no Share", async () => {
  const el = await renderAsync(<TasksPage />);
  await settle();
  // switch to leaderboard
  [...el.querySelectorAll('[role="radio"], button')].find((b) => (b.textContent || "").trim() === "Leaderboard")?.click();
  await settle();
  const text = el.textContent || "";
  expect(text).toContain("Everyone starts at zero");
  expect(text).not.toContain("Champion share");
  expect(el.querySelector("[aria-label*='Share' i]")).toBeNull();
});

it("with points: champion card + Share button", async () => {
  const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().split("T")[0]; })();
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: monday, points: { Rebecca: 15 }, history: [], streak: {}, lastActive: {} }));
  const el = await renderAsync(<TasksPage />);
  await settle();
  [...el.querySelectorAll('[role="radio"], button')].find((b) => (b.textContent || "").trim() === "Leaderboard")?.click();
  await settle();
  expect(el.textContent).toContain("Champion share");
  expect(el.querySelector("[aria-label*='Share' i]")).toBeTruthy();
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement.**

  a. `src/app/globals.css` — new utility (place next to `.tap` definitions):

```css
/* Invisible hit-area expansion — small icon buttons become ≥44px effective tap
   targets without changing their visual size. Same documented pattern as the
   chat photo-remove button (before:absolute before:-inset-2.5). */
.hit-44 { position: relative; }
.hit-44::before { content: ""; position: absolute; inset: -4px; }
```

  b. `src/app/tasks/page.tsx` champion block — replace the current Surface content with a zero-state branch:

```tsx
<Surface variant="warm" radius="2xl" padding="lg" glow>
  {familyTotal === 0 ? (
    <div className="py-2 text-center">
      <span className="text-2xl">👑</span>
      <h3 className="mt-1 text-xl font-bold text-text-primary">The crown is up for grabs</h3>
      <p className="mt-1 text-sm text-text-secondary">Everyone starts at zero — the first completed task takes it.</p>
      <p className="mt-0.5 text-xs text-text-muted">{thisWeeksCompletedCount === 0 ? "No chores done yet this week." : `${thisWeeksCompletedCount} done this week — points land in the ledger on claim.`}</p>
    </div>
  ) : (
    <div className="relative overflow-hidden">
      {topScorer && (
        <div className="absolute right-0 top-0">
          <SoftButton size="sm" variant="ghost" className="hit-44" aria-label={`Share ${topScorer.name.split(" ")[0]}'s week`} onClick={() => setShareCard({ memberName: topScorer.name, memberEmoji: topScorer.emoji, rank: 1, points: topScorer.points })}>↗ Share</SoftButton>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        {/* …existing left block (kicker, crown, name, points, streak, level) minus the inline "Share" button… */}
      </div>
      {/* …existing ProgressRing/Rewards/Penalties grid + TrophyCase unchanged… */}
    </div>
  )}
</Surface>
```

  c. Remove the old inline Share text-link (the `<button …>Share</button>` that currently renders after the kicker).

- [ ] **Step 4: Run, expect pass** — `npx vitest run tests/unit/tasks-champion-zero.test.tsx`.

- [ ] **Step 5: Commit** — `fix(tasks): fresh-week champion honesty (no 0% champion) + Share becomes 44px ghost button`.

---

### Task 9: Layout + copy + touch-target sweep

**Files:**
- Modify: `src/app/tasks/page.tsx`

- [ ] **Step 1: Failing tests.** New `tests/unit/tasks-polish-copy.test.tsx`:

```tsx
it("the Earned tile follows the member filter", async () => {
  const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().split("T")[0]; })();
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 1, title: "Jasmine pending", assignee: "Jasmine", assigneeEmoji: "👧", due: "2026-09-04", points: 9, recurring: null, category: "Chores", completed: false, priority: "low" },
    { id: 2, title: "Bailey pending", assignee: "Bailey", assigneeEmoji: "👧", due: "2026-09-04", points: 7, recurring: null, category: "Chores", completed: false, priority: "low" },
  ]));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: monday, points: { Rebecca: 15, Bailey: 12 }, history: [], streak: {}, lastActive: {} }));
  const el = await renderAsync(<TasksPage />);
  await settle();
  // artificial wait for week-data state
  const tiles = [...el.querySelectorAll(".grid.gap-3 > *")];
  // "Earned" tile is the third
  expect(tiles[2]?.textContent).toContain("27");
  // switch the member filter to Bailey
  [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Bailey"))?.click();
  await settle();
  const tiles2 = [...el.querySelectorAll(".grid.gap-3 > *")];
  expect(tiles2[2]?.textContent).toContain("12");
});

it("filtered empty states name the member", async () => {
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 1, title: "Jasmine pending", assignee: "Jasmine", assigneeEmoji: "👧", due: "2026-09-04", points: 9, recurring: null, category: "Chores", completed: false, priority: "low" },
  ]));
  const el = await renderAsync(<TasksPage />);
  await settle();
  [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Bailey"))?.click();
  await settle();
  expect(el.textContent).toContain("Nothing pending for Bailey");
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement.** In `src/app/tasks/page.tsx`:

  a. **Filter-aware Pending tile** — already filtered; keep.

  b. **Filter-aware Completed tile:**

```tsx
const scopedCompletedCount = (() => {
  if (filterMember === "All") return thisWeeksCompleted.length;
  if (filterMember === "Up for grabs") return thisWeeksCompleted.filter((t) => t.universal || t.stealable).length;
  const target = filterMember === "My Tasks" ? currentUser?.name : filterMember;
  if (!target) return thisWeeksCompleted.length;
  return thisWeeksCompleted.filter((t) => {
    const actor = t.completedBy || t.assignee;
    return actor === target || actor.startsWith(target) || target.startsWith(actor);
  }).length;
})();
const filteredPending = pending.length;
const scopedEarned = (() => {
  if (filterMember === "All" || filterMember === "Up for grabs") return weeklyEarned;
  const target = filterMember === "My Tasks" ? currentUser?.name : filterMember;
  if (!target) return weeklyEarned;
  return weekData.points[target] ?? 0;
})();
```

…and replace the three `StatTile value` props with `pending.length` → `{filteredPending}`, Completed `thisWeeksCompletedCount` → `{scopedCompletedCount}`, Earned `weeklyEarned` → `{scopedEarned}`. Tile `detail` strings stay unchanged.

  c. **Filtered empty states** in the Pending card — replace the current `EmptyState` fallback chain with scoped copy:

```tsx
{pending.length === 0 ? (
  !isLoggedIn && guestSyncBlocked && tasks.length === 0 ? (
    <EmptyState title="Tasks are synced to the family account" description="Sign in with your PIN to see everyone's tasks. Your chores aren't gone — they're waiting on the family server." icon="🔐" />
  ) : filterMember === "Up for grabs" ? (
    <EmptyState title="All caught up" description="Nothing is up for grabs right now." icon="🎉" />
  ) : filterMember === "My Tasks" ? (
    <EmptyState title="All caught up" description="Nothing's on your plate right now." icon="🎉" />
  ) : filterMember !== "All" ? (
    <EmptyState title="All caught up" description={`Nothing pending for ${filterMember.split(" ")[0]} right now.`} icon="🎉" />
  ) : (
    <EmptyState title="All caught up" description="No pending tasks right now." icon="🎉" />
  )
) : (…) }
```

   d. **Desktop width cap** — wrap `PageHeader` + the `px-4 space-y-5 pb-8` content div in a single container:

```tsx
<PageShell>
  <ConfettiBurst active={confettiActive} />
  <Toast …>{toast}</Toast>
  <div className="mx-auto w-full lg:max-w-3xl">
    <PageHeader … />
    <div className="px-4 space-y-5 pb-8">…</div>
  </div>
  …modals…
</PageShell>
```

   e. **Stagger cap** — `animationDelay: ${Math.min(idx, 8) * 0.05}s` in the pending-row style.

   f. **Hit-target application** — add `className="hit-44"` (or append to existing className) to: suggestion dismiss `×` IconButton, completed-row undo `↩` IconButton, reward edit `✎` IconButton, penalty apply `⚠️` IconButton, penalty edit `✎` IconButton. Share was done in Task 8.

- [ ] **Step 4: Run, expect pass** — `npx vitest run tests/unit/tasks-polish-copy.test.tsx`.

- [ ] **Step 5: Commit** — `fix(tasks): filter-aware stat tiles, scoped empty copy, 768px desktop column, hit-44, stagger cap`.

---

### Task 10: Live Playwright probe

**Files:**
- Create: `scripts/consuela/verify-tasks-polish.mjs`

**Interfaces:**
- Follows the repo pattern (spawn own dev server on a free port, chromium headless, seed localStorage pre-load, assert DOM).

- [ ] **Step 1: Write the probe.** Mirror `scripts/consuela/test-capsule-nav.mjs` for the server-boot pattern. Assert, at 390×844 AND 1280×800:

```js
// run 1 (seeded tasks): 
//  1. /tasks → 0 page errors, document.scrollWidth === clientWidth at both widths
//  2. Guest filter strip: 9 ".member-tile" tiles, none named Rocco/Rico
//  3. Seeded tasks: "Fold the laundry for Aurora" (on-time), "Wipe the bathroom counters" (stealable, due yesterday),
//     "Water the plants (stealable, on time tomorrow)"
//  4. Click "Up for grabs" tile → the page contains "Wipe the bathroom counters" and "was due",
//     does NOT contain "Water the plants"; late row text matches /was due/
//  5. "Leaderboard" tab → with zero points: page contains "The crown is up for grabs" and "Everyone starts at zero",
//     and contains no "Champion share".
//  6. Consuela suggests buttons render honor copies: buttons "Generate" and "Sync Google Tasks" exist.
//  7. At 1280px: the tasks content wrapper (PageHeader's parent) computed width ≤ 800px and is centered (leftInset > (viewport-800)/2 - 8).
//  8. Clicking the stealable-late row opens a dialog whose body contains a "Claim for" select (label text).
//  9. Add Task modal: contains text "Up for grabs when late".
// 10. All control hit targets inside completed/reward/penalty rows compute their box; verify we did NOT introduce
//     horizontal overflow (scrollWidth === clientWidth) with the seeded long tasks list.
// 11. with a seeded week (rebecca 15, bailey 12) → Leaderboard shows "Champion share" and a [aria-label*='Share' i] button.
```

- [ ] **Step 2: Run** — `node scripts/consuela/verify-tasks-polish.mjs` → ALL CHECKS PASSED.

- [ ] **Step 3: Commit** — `test(tasks): live Playwright probe for tasks polish + snatch`.

---

### Task 11: Final verification + AGENTS.md (mandatory)

- [ ] **Step 1 (in-repo):**
```bash
cd Home-ai
npm run typecheck
npx eslint src/app/tasks/page.tsx src/components/leaderboard/DailyQuestCard.tsx src/lib/task-utils.ts src/types/tasks.ts src/lib/pb-seed.ts src/app/api/tasks/claim/route.ts
npx vitest run --reporter=dot
npm run build
```
All clean; suite green (no new failures).

- [ ] **Step 2 (detector):** the impeccable design detector runs automatically on the touched UI files — read any new findings; only the documented pre-existing ones may remain (no new findings introduced by this change).

- [ ] **Step 3 (live probe):** `node scripts/consuela/verify-tasks-polish.mjs` → ALL CHECKS PASSED.

- [ ] **Step 4: AGENTS.md update (mandatory).** Update the top "Current Dashboard Snapshot" with a new dated entry, add a "UI Change Record — 2026-09-04 — Tasks polish + stealable tasks" block documenting: Files added/changed (all of them), the user-facing behavior ("any task can now be marked 'up for grabs when late'; once its due date passes anyone can claim it and take the points"), the polish list (honest fallbacks, zero-week champion, filter-aware tiles, 768px desktop column, scoped empty states, touch targets, pets removed from assign/filter, quest Do-it fix, stagger cap), the new tests + probe, and the ops note ("run `npm run pb:seed` once to self-heal the stealable field on the live PB"). Keep the same structure as the existing records (Added/Changed, Visual/Motion, Color sources, Agent action required, User-facing description). Do NOT delete prior entries; prepend the new snapshot entry + append a matching Change Log line at the bottom.

- [ ] **Step 5: Commit.**
```bash
git add AGENTS.md
git commit -m "docs(tasks): AGENTS.md — stealable tasks + polish pass"
```

**Rollback:** `git revert` the feature range; PB field additions are harmless if unadvertised.

---

## Notes for the executor

- Read `Home-ai/AGENTS.md` (the top snapshot + the 2026-08-27 and 2026-09-03 records for tasks) and `DESIGN.md` before touching `tasks/page.tsx` — that file documents the incumbent warm-glass world and the "honest empty state" rule the polish leans on.
- The page is client-only (`"use client"`); modals portal to `document.body` — tests must assert against `document.body`, not the render container.
- Keep `prefers-reduced-motion` untouched (no new loops).
- All `[role="radio"]` tab switches in tests use `.click()` on the Leaderboard option.
