# Tap-to-complete with pending parent approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kids tap chores complete PIN-free while points stay pending until a parent approves, per `docs/superpowers/specs/2026-09-06-tap-to-complete-pending-approval-design.md`.

**Architecture:** Pure helpers in `src/lib/task-utils.ts` own all pending state transitions (tap, approve, send-back, selectors); the Tasks page, KidHome, and Home read/render through them. No new collections, no new API routes — persistence rides the existing tasks snapshot + `syncTasksToPB` rails.

**Tech Stack:** Next.js 16 + React 19, TypeScript, Vitest + jsdom + react-dom act harness, PocketBase (`tasks` collection).

## Global Constraints

- Full suite stays green (`npx vitest run` from `Home-ai/`), `npm run typecheck` clean, `npx eslint` clean on every touched file.
- `verifyPinRemote` (`src/modes/kid/kid-store.ts`) stays the only PIN seam — no page-local verifiers.
- Pending points never enter `weekData.points` or `weekData.history` until approve.
- `completedInWeek` keeps today's no-double-complete guarantee.
- `isPendingApproval()` is the only pending gate on the client.
- Ops: run `npm run pb:seed` on deploy so live PB gains `tasks.pendingApproval` (self-heal).
- Copy strings below are locked — tests assert them verbatim.

---

## File map

- Modify: `src/types/tasks.ts` — add `PendingApproval` interface + `Task.pendingApproval?`.
- Modify: `src/lib/task-utils.ts` — `isPendingApproval`, `pendingApprovals`, `pendingPointsFor`, `shouldUsePendingTap`, `tapCompletePending`, `approvePendingCompletion`, `sendBackPendingCompletion`; extend `mergeTasksSnapshot` adoption pass + restored mapping; extend `syncTasksToPB` payload; regen skips pending rows.
- Modify: `src/lib/pb-seed.ts` — `tasks.pendingApproval` json field.
- Modify: `src/app/tasks/page.tsx` — kid tap branch, waiting rows, self-cancel, submitUndo guard, Needs approval section + modal, import extensions, restore mapping.
- Modify: `src/modes/kid/KidHome.tsx` — quest tap pending branch, import extension, header comment.
- Modify: `src/app/page.tsx` — parents-only approval badge in the tasks widget.
- Create: `tests/unit/tasks-pending-approval.test.ts`, `tests/unit/tasks-pending-merge.test.ts`, `tests/unit/tasks-pending-flow.test.tsx`.
- Modify: `tests/unit/pb-seed-field-heal.test.ts` — pendingApproval field assertion.
- Modify: `Home-ai/AGENTS.md` — snapshot line + UI Change Record (repo-mandated).

---

### Task 1: PendingApproval type + pure helpers

**Files:**
- Modify: `src/types/tasks.ts:1-17`
- Modify: `src/lib/task-utils.ts` (append after `isSnatchable`, lines 40-42)
- Test: `tests/unit/tasks-pending-approval.test.ts`

**Interfaces:**
- Consumes: `Task`, `WeekData` from `@/types/tasks`; `addTransaction` (same file).
- Produces: `PendingApproval`, `isPendingApproval(task)`, `pendingApprovals(tasks)`, `pendingPointsFor(member, tasks)`, `shouldUsePendingTap(role, task)`, `tapCompletePending(task, byName, nowISO, week)`, `approvePendingCompletion(tasks, weekData, taskId)`, `sendBackPendingCompletion(tasks, taskId)` — used by Tasks 5, 6, 7, 8.

- [ ] **Step 1: Write the failing test file**

```tsx
import { describe, it, expect, vi } from "vitest";
import type { Task, WeekData } from "@/types/tasks";

vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));

import {
  isPendingApproval, pendingApprovals, pendingPointsFor, shouldUsePendingTap,
  tapCompletePending, approvePendingCompletion, sendBackPendingCompletion,
} from "@/lib/task-utils";

function t(over: Partial<Task>): Task {
  return {
    id: 1, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧",
    due: "2026-09-06", points: 5, recurring: null, category: "Chores",
    completed: false, priority: "low", ...over,
  };
}

function wk(over: Partial<WeekData> = {}): WeekData {
  return { weekStart: "2026-09-01", points: {}, streak: {}, lastActive: {}, history: [], ...over };
}

const NOW = "2026-09-06T12:00:00.000Z";

describe("isPendingApproval", () => {
  it("true only for completed tasks carrying a pendingApproval record", () => {
    expect(isPendingApproval(t({ completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } }))).toBe(true);
    expect(isPendingApproval(t({ completed: true }))).toBe(false);
    expect(isPendingApproval(t({ completed: false, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } }))).toBe(false);
    expect(isPendingApproval(t({}))).toBe(false);
  });
});

describe("pendingPointsFor", () => {
  it("sums in-flight points for one kid and ignores everyone else", () => {
    const tasks = [
      t({ id: 1, completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } }),
      t({ id: 2, completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 8 } }),
      t({ id: 3, completed: true, pendingApproval: { byName: "Emily", at: NOW, points: 8 } }),
      t({ id: 4, completed: true }),
    ];
    expect(pendingPointsFor("Jasmine", tasks)).toBe(13);
    expect(pendingPointsFor("Emily", tasks)).toBe(8);
    expect(pendingPointsFor("Bailey", tasks)).toBe(0);
  });
});

describe("shouldUsePendingTap", () => {
  it("true only for child role on open assigned non-universal tasks", () => {
    expect(shouldUsePendingTap("child", t({}))).toBe(true);
    expect(shouldUsePendingTap("parent", t({}))).toBe(false);
    expect(shouldUsePendingTap(undefined, t({}))).toBe(false);
    expect(shouldUsePendingTap("child", t({ completed: true }))).toBe(false);
    expect(shouldUsePendingTap("child", t({ universal: true }))).toBe(false);
    expect(shouldUsePendingTap("child", t({ stealable: true, due: "2026-09-01" }))).toBe(false);
  });
});

describe("tapCompletePending", () => {
  it("marks done with a pending record and touches no ledger", () => {
    const out = tapCompletePending(t({}), "Jasmine", NOW, "2026-09-01");
    expect(out.completed).toBe(true);
    expect(out.completedBy).toBe("Jasmine");
    expect(out.completedAt).toBe(NOW);
    expect(out.completedInWeek).toBe("2026-09-01");
    expect(out.pendingApproval).toEqual({ byName: "Jasmine", at: NOW, points: 5 });
    expect(isPendingApproval(out)).toBe(true);
  });
});

describe("approvePendingCompletion", () => {
  it("same-week approve posts Completed earn, adds points, clears pending", () => {
    const tasks = [t({ completed: true, completedInWeek: "2026-09-01", pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const { tasks: nt, weekData: nw } = approvePendingCompletion(tasks, wk(), 1);
    expect(nt[0].completed).toBe(true);
    expect(nt[0].pendingApproval).toBeUndefined();
    expect(nw.points["Jasmine"]).toBe(5);
    expect(nw.history).toHaveLength(1);
    expect(nw.history[0]).toMatchObject({ type: "earn", amount: 5, member: "Jasmine", taskId: 1 });
    expect(nw.history[0].description).toContain("Completed: Make bed");
  });

  it("rolled-week approve posts Approved earn into the current week", () => {
    const tasks = [t({ completed: true, completedInWeek: "2026-08-25", pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const { weekData: nw } = approvePendingCompletion(tasks, wk({ weekStart: "2026-09-01" }), 1);
    expect(nw.history[0].description).toContain("Approved: Make bed");
    expect(nw.points["Jasmine"]).toBe(5);
  });

  it("double-approve never double-pays: existing earn clears pending with no new tx", () => {
    const tasks = [t({ completed: true, completedInWeek: "2026-09-01", pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const paid = wk({ history: [{ id: 7, timestamp: NOW, member: "Jasmine", type: "earn", amount: 5, description: "Completed: Make bed (+5pts)", taskId: 1 }] });
    const { tasks: nt, weekData: nw } = approvePendingCompletion(tasks, paid, 1);
    expect(nt[0].pendingApproval).toBeUndefined();
    expect(nw.history).toHaveLength(1);
    expect(nw.points["Jasmine"] ?? 0).toBe(0);
  });

  it("unknown or non-pending ids return inputs by reference", () => {
    const tasks = [t({})];
    const week = wk();
    const out = approvePendingCompletion(tasks, week, 999);
    expect(out.tasks).toBe(tasks);
    expect(out.weekData).toBe(week);
    const out2 = approvePendingCompletion([t({ completed: true })], week, 1);
    expect(out2.tasks).toHaveLength(1);
    expect(out2.weekData).toBe(week);
  });
});

describe("sendBackPendingCompletion", () => {
  it("reopens with zero points and zero history", () => {
    const tasks = [t({ completed: true, completedBy: "Jasmine", completedAt: NOW, completedInWeek: "2026-09-01", pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const out = sendBackPendingCompletion(tasks, 1);
    expect(out[0]).toMatchObject({ completed: false, completedBy: undefined, completedAt: undefined, completedInWeek: undefined, pendingApproval: undefined });
  });

  it("unknown ids return the input array by reference", () => {
    const tasks = [t({})];
    expect(sendBackPendingCompletion(tasks, 999)).toBe(tasks);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tasks-pending-approval.test.ts`
Expected: FAIL — `isPendingApproval` (and siblings) not exported from `@/lib/task-utils`.

- [ ] **Step 3: Write minimal implementation**

In `src/types/tasks.ts`, after line 16 (`stealable?: boolean;`), insert:

```ts
  pendingApproval?: PendingApproval;
```

After the `Task` interface closing brace (line 17), insert:

```ts
export interface PendingApproval {
  byName: string;
  at: string;
  points: number;
}
```

In `src/lib/task-utils.ts`, after the `isSnatchable` function (lines 40-42), insert:

```ts
// Tap-to-complete with pending parent approval: a kid's tap marks the task
// done immediately but writes NO earn transaction — points land only when a
// parent approves (approvePendingCompletion) and vanish on send-back.
export function isPendingApproval(task: Task): boolean {
  return !!task.completed && !!task.pendingApproval;
}

export function pendingApprovals(tasks: Task[]): Task[] {
  return (tasks || []).filter(isPendingApproval);
}

export function pendingPointsFor(memberName: string, tasks: Task[]): number {
  return pendingApprovals(tasks)
    .filter((t) => t.pendingApproval!.byName === memberName)
    .reduce((sum, t) => sum + (t.pendingApproval!.points || 0), 0);
}

// The single decision seam for PIN-less completion: child role, open task,
// assigned (never universal), never snatchable (claims stay server-side).
export function shouldUsePendingTap(role: string | undefined, task: Task): boolean {
  return role === "child" && !task.completed && !task.universal && !isSnatchable(task);
}

export function tapCompletePending(task: Task, byName: string, nowISO: string, week: string): Task {
  return {
    ...task,
    completed: true,
    completedBy: byName,
    completedAt: nowISO,
    completedInWeek: week,
    pendingApproval: { byName, at: nowISO, points: task.points },
  };
}

export function approvePendingCompletion(
  tasks: Task[],
  weekData: WeekData,
  taskId: number
): { tasks: Task[]; weekData: WeekData } {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !isPendingApproval(task)) return { tasks, weekData };
  const cleared = tasks.map((t) =>
    t.id === taskId ? { ...t, pendingApproval: undefined } : t
  );
  // Idempotency: another device already paid this tap — clear without re-paying.
  const alreadyPaid = weekData.history.some(
    (tx) => tx.type === "earn" && tx.taskId === taskId
  );
  if (alreadyPaid) return { tasks: cleared, weekData };
  const owner = task.pendingApproval!.byName;
  const sameWeek = task.completedInWeek === weekData.weekStart;
  const pointsMsg = task.points > 0 ? ` (+${task.points}pts)` : "";
  const withPoints = {
    ...weekData,
    points: { ...weekData.points, [owner]: (weekData.points[owner] || 0) + task.points },
  };
  const next = addTransaction(
    withPoints,
    "earn",
    task.points,
    `${sameWeek ? "Completed" : "Approved"}: ${task.title}${pointsMsg}`,
    owner,
    task.id
  );
  return { tasks: cleared, weekData: next };
}

export function sendBackPendingCompletion(tasks: Task[], taskId: number): Task[] {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !isPendingApproval(task)) return tasks;
  return tasks.map((t) =>
    t.id === taskId
      ? { ...t, completed: false, completedBy: undefined, completedAt: undefined, completedInWeek: undefined, pendingApproval: undefined }
      : t
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tasks-pending-approval.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/tasks.ts src/lib/task-utils.ts tests/unit/tasks-pending-approval.test.ts
git commit -m "feat(tasks): pending-approval pure helpers (tap, approve, send-back)"
```

### Task 2: PB persistence for pendingApproval

**Files:**
- Modify: `src/lib/pb-seed.ts:159` (after the stealable line)
- Modify: `src/lib/task-utils.ts` (`syncTasksToPB`, after the `stealable` line)
- Test: `tests/unit/pb-seed-field-heal.test.ts` (append assertion), `tests/unit/tasks-pending-approval.test.ts` (append payload describe)

**Interfaces:**
- Consumes: Task 1 helpers (same test file).
- Produces: `tasks.pendingApproval` json field in PB; sync payload carries it. Used by Tasks 3, 5, 6, 7.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `tests/unit/pb-seed-field-heal.test.ts` (after the stealable test at line 112-117):

```ts
  it("tasks collection carries the pendingApproval json field", () => {
    const tasksDef = COLLECTIONS.find((c) => c.name === "tasks")!;
    const f = tasksDef.schema.find((s: any) => s.name === "pendingApproval");
    expect(f).toBeDefined();
    expect(f!.type).toBe("json");
  });
```

Append to `tests/unit/tasks-pending-approval.test.ts`:

```tsx
describe("syncTasksToPB pendingApproval persistence", () => {
  it("writes the pending record when set, null otherwise", async () => {
    const { syncTasksToPB } = await import("@/lib/task-utils");
    const { db } = await import("@/db");
    await syncTasksToPB([
      t({ completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } }),
      t({ id: 2, title: "No pending" }),
    ]);
    const calls = vi.mocked(db.upsertTask).mock.calls;
    expect(calls[0][0].pendingApproval).toEqual({ byName: "Jasmine", at: NOW, points: 5 });
    expect(calls[1][0].pendingApproval).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/pb-seed-field-heal.test.ts tests/unit/tasks-pending-approval.test.ts`
Expected: FAIL — `pendingApproval` field undefined; payload missing the key.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/pb-seed.ts`, after line 159 (`{ name: "stealable", type: "bool" },`), insert:

```ts
      { name: "pendingApproval", type: "json" },
```

In `src/lib/task-utils.ts` `syncTasksToPB`, after line 515 (`stealable: task.stealable || false,`), insert:

```ts
      pendingApproval: task.pendingApproval ?? null,
```

No gateway change needed: `sanitizeClientRow` (`src/lib/db-gateway.ts:42-53`) strips only credential keys and PB metadata, so `pendingApproval` passes through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/pb-seed-field-heal.test.ts tests/unit/tasks-pending-approval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pb-seed.ts src/lib/task-utils.ts tests/unit/pb-seed-field-heal.test.ts tests/unit/tasks-pending-approval.test.ts
git commit -m "feat(tasks): persist pendingApproval to PocketBase tasks rows"
```

### Task 3: Snapshot merge + restore adopt pendingApproval on known rows

**Files:**
- Modify: `src/lib/task-utils.ts` (`mergeTasksSnapshot` restored mapping + adoption pass)
- Modify: `src/app/tasks/page.tsx` (`restoreFromSnapshot` mapping, after line 495)
- Test: `tests/unit/tasks-pending-merge.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: cross-device convergence of pending state. Used by Tasks 5, 6, 9.

- [ ] **Step 1: Write the failing test file**

```tsx
import { describe, it, expect, vi } from "vitest";
import type { Task, WeekData } from "@/types/tasks";

vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));

import { mergeTasksSnapshot } from "@/lib/task-utils";

const NOW = "2026-09-06T12:00:00.000Z";

function t(over: any = {}): any {
  return {
    id: 1, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧",
    due: "2026-09-06", points: 5, recurring: null, category: "Chores",
    completed: false, priority: "low", ...over,
  };
}

function wk(over: any = {}): WeekData {
  return { weekStart: "2026-09-01", points: {}, streak: {}, lastActive: {}, history: [], ...over };
}

function snap(tasks: any[], weekData: WeekData) {
  return { tasks, weekData };
}

describe("mergeTasksSnapshot pendingApproval adoption", () => {
  it("adopts a remote pending tap on a known open row", () => {
    const local = [t({})];
    const remote = [t({ completed: true, completedBy: "Jasmine", completedAt: NOW, completedInWeek: "2026-09-01", pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect(out.tasksChanged).toBe(true);
    expect((out.tasks[0] as any).pendingApproval).toEqual({ byName: "Jasmine", at: NOW, points: 5 });
    expect(out.tasks[0].completed).toBe(true);
  });

  it("keeps a fresh local pending when the snapshot lacks it and no earn exists", () => {
    const local = [t({ completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const remote = [t({})];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect((out.tasks[0] as any).pendingApproval).toEqual({ byName: "Jasmine", at: NOW, points: 5 });
  });

  it("adopts a remote clear when the earn tx proves approval happened elsewhere", () => {
    const local = [t({ completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } })];
    const remote = [t({ completed: true, completedBy: "Jasmine", completedAt: NOW, completedInWeek: "2026-09-01" })];
    const paid = wk({ history: [{ id: 7, timestamp: NOW, member: "Jasmine", type: "earn", amount: 5, description: "Completed: Make bed (+5pts)", taskId: 1 }] });
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, paid));
    expect(out.tasksChanged).toBe(true);
    expect((out.tasks[0] as any).pendingApproval).toBeUndefined();
    expect(out.weekChanged).toBe(true);
  });

  it("adopts a remote completion on a locally open row", () => {
    const local = [t({})];
    const remote = [t({ completed: true, completedBy: "Jasmine", completedAt: NOW, completedInWeek: "2026-09-01" })];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect(out.tasksChanged).toBe(true);
    expect(out.tasks[0].completed).toBe(true);
    expect(out.tasks[0].completedBy).toBe("Jasmine");
  });

  it("no-change refresh returns inputs by reference", () => {
    const local = [t({})];
    const week = wk();
    const out = mergeTasksSnapshot(local as Task[], week, snap([t({})], wk()));
    expect(out.tasksChanged).toBe(false);
    expect(out.tasks).toBe(local);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tasks-pending-merge.test.ts`
Expected: FAIL — remote pending tap not adopted (merge is add-only for known rows).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/task-utils.ts`, extend the `restored` mapping (lines 265-276) with one line after `completedInWeek`:

```ts
      pendingApproval: (t as any).pendingApproval ?? undefined,
```

After the fresh-add block (lines 280-284, ending with the closing `}` of `if (fresh.length) {`), insert the adoption pass before the `if (snapshot.weekData?.weekStart)` block:

```ts
  // Adopt completion/pending field changes on KNOWN rows: a kid's tap on the
  // kitchen phone must land on a parent's device even though the row id
  // already exists locally. A remote clear only wins when the snapshot's
  // weekData carries the earn tx (approval happened elsewhere) — otherwise a
  // stale snapshot would wipe a fresh local tap.
  const byId = new Map(restored.map((t: any) => [t.id, t]));
  let merged = tasks;
  for (const snapRow of byId.values()) {
    const local = merged.find((p: any) => p.id === snapRow.id);
    if (!local) continue;
    const snapshotPending = (snapRow as any).pendingApproval ?? undefined;
    const localPending = (local as any).pendingApproval ?? undefined;
    const pendingDiffers =
      JSON.stringify(snapshotPending ?? null) !== JSON.stringify(localPending ?? null);
    const completionDiffers =
      !!snapRow.completed !== !!local.completed ||
      (snapRow.completedBy ?? undefined) !== (local.completedBy ?? undefined) ||
      (snapRow.completedAt ?? undefined) !== (local.completedAt ?? undefined) ||
      (snapRow.completedInWeek ?? undefined) !== (local.completedInWeek ?? undefined);
    if (!pendingDiffers && !completionDiffers) continue;
    if (localPending && !snapshotPending) {
      const paidElsewhere = (snapshot.weekData?.history || []).some(
        (tx: any) => tx.type === "earn" && tx.taskId === snapRow.id
      );
      if (!paidElsewhere) continue;
    }
    merged = merged.map((p: any) =>
      p.id === snapRow.id
        ? {
            ...p,
            completed: snapRow.completed,
            completedBy: snapRow.completedBy ?? undefined,
            completedAt: snapRow.completedAt ?? undefined,
            completedInWeek: snapRow.completedInWeek ?? undefined,
            pendingApproval: snapshotPending,
          }
        : p
    );
    tasksChanged = true;
  }
  tasks = merged;
```

In `src/app/tasks/page.tsx` `restoreFromSnapshot` mapping (after line 495 `completedInWeek: t.completedInWeek ?? undefined,`), insert:

```ts
          pendingApproval: t.pendingApproval ?? undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tasks-pending-merge.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-utils.ts src/app/tasks/page.tsx tests/unit/tasks-pending-merge.test.ts
git commit -m "feat(tasks): snapshot merge adopts pendingApproval on known rows"
```

### Task 4: Recurring regen skips pending rows

**Files:**
- Modify: `src/lib/task-utils.ts` (`regenerateRecurringTasks` sources filter, lines 170-172)
- Test: append regen describe to `tests/unit/tasks-pending-approval.test.ts`

**Interfaces:**
- Consumes: Task 1 (`isPendingApproval`).
- Produces: pending rows survive regen untouched. Used by Task 9 verification.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/tasks-pending-approval.test.ts`:

```tsx
describe("regenerateRecurringTasks with pending rows", () => {
  it("leaves pending rows untouched: no consume, no clone", async () => {
    const { regenerateRecurringTasks } = await import("@/lib/task-utils");
    const pending = t({
      id: 9, title: "Take out trash", recurring: "weekly",
      completed: true, completedBy: "Jasmine", completedAt: "2026-08-26T12:00:00.000Z",
      completedInWeek: "2026-08-25",
      pendingApproval: { byName: "Jasmine", at: "2026-08-26T12:00:00.000Z", points: 5 },
    });
    const out = regenerateRecurringTasks([pending]);
    expect(out).toHaveLength(1);
    expect(out[0].pendingApproval).toEqual({ byName: "Jasmine", at: "2026-08-26T12:00:00.000Z", points: 5 });
    expect(out[0].completed).toBe(true);
  });

  it("control: the same row without pending is consumed and cloned", async () => {
    const { regenerateRecurringTasks } = await import("@/lib/task-utils");
    const done = t({
      id: 9, title: "Take out trash", recurring: "weekly",
      completed: true, completedBy: "Jasmine", completedAt: "2026-08-26T12:00:00.000Z",
      completedInWeek: "2026-08-25",
    });
    const out = regenerateRecurringTasks([done]);
    expect(out.some((r) => r.id === 9)).toBe(false);
    expect(out.some((r) => r.title === "Take out trash" && !r.completed)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tasks-pending-approval.test.ts`
Expected: FAIL — pending row is consumed and cloned like any completed prior-week row.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/task-utils.ts`, change the clone-sources filter (lines 170-172) from:

```ts
  const sources = tasks.filter(
    (t) => t.completed && t.recurring && t.completedInWeek !== monday
  );
```

to:

```ts
  const sources = tasks.filter(
    (t) => t.completed && t.recurring && t.completedInWeek !== monday && !t.pendingApproval
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tasks-pending-approval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-utils.ts tests/unit/tasks-pending-approval.test.ts
git commit -m "feat(tasks): recurring regen leaves pending-approval rows untouched"
```

### Task 5: Tasks page kid tap-to-complete, waiting rows, self-cancel, undo guard

**Files:**
- Modify: `src/app/tasks/page.tsx` (import line 37; `openPinEntry` at 685; Completed rows at 1469-1509; `submitUndo` after line 806)
- Test: `tests/unit/tasks-pending-flow.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3 (`tapCompletePending`, `sendBackPendingCompletion`, `isPendingApproval`, `shouldUsePendingTap`).
- Produces: PIN-less kid completion with optimistic UI. Used by Task 9 verification.

- [ ] **Step 1: Write the failing test file**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, todayISO, weekKey } from "@/lib/task-utils";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
  },
}));

const MONDAY = todayMondayISO();
const OPEN = { id: 51, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function stubGuestFetches() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}

function storedHistory(): any[] {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}").history || [];
}

function verifyCalls(): string {
  return ((globalThis.fetch as any)?.mock?.calls || []).flat().join(" ");
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
});

describe("kid tap-to-complete", () => {
  it("child tap marks done with pending record, zero earn tx, zero PIN traffic", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Jasmine", role: "child" };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toEqual({ byName: "Jasmine", at: expect.any(String), points: 5 });
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).not.toContain("/api/members/verify");
    expect(el.textContent || "").toContain("on the way");
  });

  it("adult tap still opens a real dialog and writes no pending record", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    await act(async () => { row.click(); });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
  });

  it("guest tap creates no pending record", async () => {
    stubGuestFetches();
    seed([OPEN]);
    await renderAsync(<TasksPage />);
    await settle();

    const row = document.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    await act(async () => { row.click(); });
    await settle();

    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("pending rows show On the way and the owner can self-cancel PIN-free", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Jasmine", role: "child" };
    mockAuth.isLoggedIn = true;
    seed([{ ...OPEN, completed: true, completedBy: "Jasmine", completedAt: new Date().toISOString(), completedInWeek: weekKey(), pendingApproval: { byName: "Jasmine", at: new Date().toISOString(), points: 5 } }]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    expect(el.textContent || "").toContain("On the way");
    const cancel = el.querySelector('[aria-label="Cancel completion of Make bed"]') as HTMLElement;
    expect(cancel).not.toBeNull();
    await act(async () => { cancel.click(); });
    await settle();

    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).not.toContain("/api/members/verify");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tasks-pending-flow.test.tsx`
Expected: FAIL — child tap opens the PIN modal instead of writing a pending record (`pendingApproval` undefined).

- [ ] **Step 3: Write minimal implementation**

Extend the `task-utils` import in `src/app/tasks/page.tsx` (line 37, `pickDefaultClaimMember, isSnatchable,`) to:

```ts
  pickDefaultClaimMember, isSnatchable, isPendingApproval, shouldUsePendingTap,
  tapCompletePending, sendBackPendingCompletion, approvePendingCompletion,
```

In `openPinEntry` (after the `if (task.completed)` block at lines 688-693, before `setPinTaskId(taskId);` at line 694), insert the kid branch:

```ts
    if (shouldUsePendingTap(currentUser?.role, task)) {
      // Trust-but-verify: a kid's tap lands immediately as done-but-unpaid —
      // no PIN round trip. Points move only on parent approval.
      if (task.completedInWeek === weekKey()) return;
      const now = new Date().toISOString();
      const me = currentUser!.name;
      setTasks((prev) => prev.map((t) => (t.id === taskId ? tapCompletePending(t, me, now, weekKey()) : t)));
      triggerConfetti();
      showToast(`Done! +${task.points}pts on the way — a parent approves.`);
      return;
    }
```

Replace the completed branch (lines 688-693) with self-cancel handling:

```ts
    if (task.completed) {
      if (isPendingApproval(task) && isLoggedIn && currentUser?.role === "child" && task.pendingApproval?.byName === currentUser.name) {
        // The kid who tapped can take it back PIN-free: nothing was verified,
        // so there is nothing to un-verify. No points ever moved.
        setTasks((prev) => sendBackPendingCompletion(prev, taskId));
        showToast("Back on the list — no points were given.");
        return;
      }
      setUndoTaskId(taskId);
      setUndoPin("");
      setUndoError("");
      return;
    }
```

In `submitUndo`, after line 806 (`const normalizedName = normalizeName(memberName);`), insert the pending guard before the existing `setTasks` reversal:

```ts
      if (isPendingApproval(task)) {
        // PIN verified above, but pending taps hold no points — reopen with no
        // ledger entry instead of the standard points-reversing undo.
        setTasks((prev) => sendBackPendingCompletion(prev, task.id));
        setUndoTaskId(null);
        setUndoPin("");
        showToast("Sent back — no points were given.");
        return;
      }
```

In the Completed section rows (`completed.map` at line 1469), insert a pending branch as the first statement of the map callback (before `const rowColor = ...` at line 1470):

```tsx
                      {completed.map((task) => {
                        if (isPendingApproval(task)) {
                          const owner = task.pendingApproval!;
                          const mine = isLoggedIn && currentUser?.role === "child" && owner.byName === currentUser.name;
                          return (
                          <div
                            key={task.id}
                            role={mine ? "button" : undefined}
                            tabIndex={mine ? 0 : undefined}
                            aria-label={mine ? `Cancel completion of ${task.title}` : `${task.title} waiting for parent approval`}
                            onClick={mine ? () => openPinEntry(task.id) : undefined}
                            onKeyDown={mine ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPinEntry(task.id); } } : undefined}
                            className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)]"
                            style={{
                              backgroundImage: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 40%, transparent) 0%, color-mix(in srgb, var(--color-accent-amber) 20%, transparent) 100%)`,
                            }}
                          >
                            <div
                              className="h-8 w-0.5 shrink-0 rounded-full"
                              style={{ backgroundColor: "var(--color-accent-amber)", boxShadow: `0 0 8px var(--color-accent-amber)` }}
                            />
                            <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-text-primary">{task.title}</div>
                              <div className="truncate text-xs text-text-secondary">{owner.byName.split(" ")[0]} · tapped {owner.at.split("T")[0]} · {task.points}pts on the way</div>
                            </div>
                            <span
                              className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                              style={{
                                background: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 55%, transparent), color-mix(in srgb, var(--color-accent-amber) 30%, transparent))`,
                              }}
                            >
                              ⏳ On the way
                            </span>
                          </div>
                          );
                        }
```

Note: the `completed` list must actually contain pending tasks — verify the `completed` memo includes completed rows regardless of earn status (it filters on `completed`, so pending rows appear; the "Done" pill path is skipped by the branch above).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tasks-pending-flow.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/page.tsx tests/unit/tasks-pending-flow.test.tsx
git commit -m "feat(tasks): kid tap-to-complete with pending points, self-cancel"
```

### Task 6: Needs approval section + approve/send-back modal

**Files:**
- Modify: `src/app/tasks/page.tsx` (state after lines 404-406; memo after line 1128; section after line 1456; modal after line 2000; handler beside `approveParentReward`)
- Test: append to `tests/unit/tasks-pending-flow.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 5 (`approvePendingCompletion`, `sendBackPendingCompletion`, parent PIN loop pattern).
- Produces: parents-only review queue. Used by Task 9 verification.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/tasks-pending-flow.test.tsx`:

```tsx
function pendingSeed() {
  return [{
    ...OPEN, id: 52, completed: true, completedBy: "Jasmine",
    completedAt: new Date().toISOString(), completedInWeek: weekKey(),
    pendingApproval: { byName: "Jasmine", at: new Date().toISOString(), points: 5 },
  }];
}

function stubVerifyOk() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member: { name: "Rebecca (Mom)", fullName: "Rebecca (Mom)" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
  }));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

async function clickByAriaLabel(label: string) {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(el).not.toBeNull();
  await act(async () => { el.click(); });
  await settle();
}

async function typeAndSubmit(placeholder: string, buttonText: string, pin = "1234") {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText(buttonText)!.click(); });
  await settle();
}

describe("needs approval queue", () => {
  it("hidden for kids and guests, shown for parents", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Jasmine", role: "child" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();
    expect(document.body.textContent || "").not.toContain("Needs approval");

    document.body.innerHTML = "";
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    await renderAsync(<TasksPage />);
    await settle();
    expect(document.body.textContent || "").toContain("Needs approval");
  });

  it("approve with parent PIN awards points and clears the queue", async () => {
    stubVerifyOk();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Approve Make bed");
    await settle();
    expect(document.body.textContent || "").toContain("Approve points");
    await typeAndSubmit("Parent PIN", "Approve");

    const week = JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
    expect(week.points["Jasmine"]).toBe(5);
    expect(week.history).toHaveLength(1);
    expect(week.history[0].type).toBe("earn");
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(document.body.textContent || "").not.toContain("Needs approval");
  });

  it("send-back reopens with zero ledger entries", async () => {
    stubVerifyOk();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Send back Make bed");
    await settle();
    await typeAndSubmit("Parent PIN", "Send back");

    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("wrong parent PIN keeps the queue and says Parent PIN required", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Approve Make bed");
    await settle();
    await typeAndSubmit("Parent PIN", "Approve", "0000");

    expect(document.body.textContent || "").toContain("Parent PIN required to review tapped tasks.");
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(storedHistory()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tasks-pending-flow.test.tsx`
Expected: FAIL — "Needs approval" text never renders.

- [ ] **Step 3: Write minimal implementation**

In `src/app/tasks/page.tsx`, after the parent-approval state (lines 404-406), insert:

```ts
  const [approvalTaskId, setApprovalTaskId] = useState<number | null>(null);
  const [approvalMode, setApprovalMode] = useState<"approve" | "sendback">("approve");
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalError, setApprovalError] = useState("");
```

After line 1128 (`const pending = filtered.filter((t) => !t.completed);`), insert:

```ts
  const pendingApprovals = useMemo(() => tasks.filter(isPendingApproval), [tasks]);
```

After `approveParentReward` (line 767, before `openPenaltyPin` at 769), insert the review handler (same parent loop, honest unreachable-first branches):

```ts
  const submitApproval = async () => {
    if (approvalTaskId === null || !approvalPin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, approvalPin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
      }
      if (unreachable) {
        setApprovalError(unreachableCopy());
        setApprovalPin("");
        setTimeout(() => setApprovalError(""), 2500);
        return;
      }
      if (!parent) {
        setApprovalError("Parent PIN required to review tapped tasks.");
        setApprovalPin("");
        setTimeout(() => setApprovalError(""), 2500);
        return;
      }
      if (approvalMode === "approve") {
        const target = tasks.find((x) => x.id === approvalTaskId);
        const { tasks: nt, weekData: nw } = approvePendingCompletion(tasks, weekData, approvalTaskId);
        setTasks(nt);
        setWeekData(nw);
        showToast(`Approved! +${target?.points ?? 0}pts for ${(target?.pendingApproval?.byName ?? "").split(" ")[0]}.`);
      } else {
        setTasks((prev) => sendBackPendingCompletion(prev, approvalTaskId));
        showToast("Sent back — no points were given.");
      }
      setApprovalTaskId(null);
      setApprovalPin("");
      setApprovalError("");
    } finally {
      setPinBusy(false);
    }
  };
```

After the Pending `</SectionCard>` (line 1456), before `{thisWeeksCompletedCount > 0 && (` at line 1458, insert the parents-only section:

```tsx
            {isLoggedIn && currentUser?.role === "parent" && pendingApprovals.length > 0 && (
              <SectionCard title="Needs approval" description={`${pendingApprovals.length} tapped — review to award points`} icon="⏳">
                <div className="space-y-2">
                  {pendingApprovals.map((task) => (
                    <div
                      key={task.id}
                      className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5"
                      style={{
                        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 40%, transparent) 0%, color-mix(in srgb, var(--color-accent-amber) 20%, transparent) 100%)`,
                      }}
                    >
                      <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text-primary">{task.title}</div>
                        <div className="truncate text-xs text-text-secondary">{task.pendingApproval!.byName.split(" ")[0]} · tapped {task.pendingApproval!.at.split("T")[0]} · {task.points}pts</div>
                      </div>
                      <button type="button" aria-label={`Approve ${task.title}`} onClick={() => { setApprovalTaskId(task.id); setApprovalMode("approve"); setApprovalPin(""); setApprovalError(""); }} className="tap-sm min-h-[44px] shrink-0 rounded-full px-3 text-xs font-bold text-text-primary glass-subtle">Approve</button>
                      <button type="button" aria-label={`Send back ${task.title}`} onClick={() => { setApprovalTaskId(task.id); setApprovalMode("sendback"); setApprovalPin(""); setApprovalError(""); }} className="tap-sm min-h-[44px] shrink-0 rounded-full px-3 text-xs font-semibold text-text-secondary">Send back</button>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
```

After the parent-approval modal (line 2000 `)}`), insert the review modal (mirrors its Modal/SoftButton/input pattern):

```tsx
      {approvalTaskId !== null && (
        <Modal
          open
          onClose={() => { setApprovalTaskId(null); setApprovalPin(""); }}
          title={approvalMode === "approve" ? "Approve points" : "Send back"}
          description={(() => {
            const target = tasks.find((x) => x.id === approvalTaskId);
            return approvalMode === "approve"
              ? `"${target?.title}" tapped by ${target?.pendingApproval?.byName} — award +${target?.points ?? 0}pts?`
              : `"${target?.title}" goes back on the list with no points.`;
          })()}
          footer={
            <>
              <SoftButton onClick={submitApproval} loading={pinBusy} disabled={!approvalPin || pinBusy} className="flex-1">{approvalMode === "approve" ? "Approve" : "Send back"}</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setApprovalTaskId(null); setApprovalPin(""); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Tapped completions need a parent PIN. Enter a parent PIN to continue.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={approvalPin}
              onChange={(e) => { setApprovalPin(e.target.value.replace(/[^0-9]/g, "")); setApprovalError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitApproval(); }}
              placeholder="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {approvalError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{approvalError}</p>}
          </div>
        </Modal>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tasks-pending-flow.test.tsx`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/page.tsx tests/unit/tasks-pending-flow.test.tsx
git commit -m "feat(tasks): parents-only needs-approval queue with PIN-gated review"
```

### Task 7: KidHome quest tap-to-complete goes pending

**Files:**
- Modify: `src/modes/kid/KidHome.tsx` (import lines 36-48; `submitQuestPin` non-universal branch lines 377-412; header comment lines 10-12)

**Interfaces:**
- Consumes: Tasks 1, 5 (`shouldUsePendingTap`, `tapCompletePending`).
- Produces: PIN-free quest completion in kid mode. Verified by existing KidHome suites staying green + Task 9 probe.

- [ ] **Step 1: Write the failing test**

Pure decision coverage already exists in Task 1 (`shouldUsePendingTap`). This task's regression net is the existing KidHome suites asserting current PIN behavior flips to pending:

Run baseline first: `npx vitest run tests/unit/kid-home-quest-pin-safety.test.tsx tests/unit/kid-pin-error-paths.test.tsx`
Expected: PASS (baseline — these encode the old PIN-mandatory behavior and WILL be updated in Step 3).

- [ ] **Step 2: Confirm baseline green**

Same command as Step 1. Record the pass, then proceed (the tests below replace PIN assertions with pending assertions).

- [ ] **Step 3: Write minimal implementation**

Extend the `task-utils` import in `src/modes/kid/KidHome.tsx` (lines 36-48) with two names:

```ts
  shouldUsePendingTap,
  tapCompletePending,
```

In `submitQuestPin`, replace the non-universal `else` branch (lines 377-412, from `} else {` through the closing `}` before line 414's `setQuestPinTask(null);`) with:

```ts
      } else {
        // Trust-but-verify: kid quests land immediately as done-but-unpaid —
        // no PIN round trip. Points move only on parent approval.
        const now = new Date().toISOString();
        const currentWeek = weekKey();
        const myName = user.name;
        const week = loadWeekData();
        const before = pointsFor(week.points, myName);
        const tasks = loadTasks().map((t: any) =>
          t.id === task.id ? tapCompletePending(t, myName, now, currentWeek) : t
        );
        saveTasks(tasks);
        void syncTasksToPB(tasks);
        celebrate(task.points || 0, before);
      }
```

Update the header comment (lines 10-12) from:

```
 *   - Tasks as "Quests" — completing one goes through the SAME server-side
 *     PIN gate the Tasks page uses (/api/members/verify, /api/tasks/claim);
 *     the PIN is typed per attempt and never persisted anywhere
```

to:

```
 *   - Tasks as "Quests" — tapping one completes it immediately as
 *     done-but-unpaid (pending parent approval, no PIN round trip); points
 *     land only when a parent approves on the Tasks page. Universal quests
 *     keep the server-side claim gate (/api/tasks/claim).
```

Update `tests/unit/kid-home-quest-pin-safety.test.tsx` non-universal cases from "requires PIN / awards earn on PIN ok" to "writes pendingApproval with zero earn tx and zero verify traffic". (Read the file's non-universal cases first — they follow the same jsdom harness as the Tasks page suites — and flip each assertion to the pending contract: `pendingApproval` present, `history` empty, no `/api/members/verify` call.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/kid-home-quest-pin-safety.test.tsx tests/unit/kid-pin-error-paths.test.tsx`
Expected: PASS with the flipped pending assertions.

- [ ] **Step 5: Commit**

```bash
git add src/modes/kid/KidHome.tsx tests/unit/kid-home-quest-pin-safety.test.tsx
git commit -m "feat(tasks): kid quests complete PIN-free into pending approval"
```

### Task 8: Home Tasks widget parents-only approval badge

**Files:**
- Modify: `src/app/page.tsx` (tasks widget footer, lines 575-579; count read in `read()` after line 203)

**Interfaces:**
- Consumes: Task 1 selector logic (inline filter — no new import needed).
- Produces: parents see pending count on Home. Verified by Task 9 probe.

- [ ] **Step 1: Write the failing check**

No new unit file — the badge is a two-line render branch. Failing check is the Task 9 probe assertion ("parent Home shows 'N need approval →'"). Implement directly, then verify in Task 9.

- [ ] **Step 2: Write minimal implementation**

In `src/app/page.tsx`, add state next to the existing `pendingTasks` state:

```ts
const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
```

In `read()` (after line 203 `setPendingTasks(pending);`), insert:

```ts
        setPendingApprovalCount(loadTasks().filter((t: any) => t.completed && t.pendingApproval).length);
```

Replace the tasks widget footer (lines 575-579):

```tsx
                        footer={
                          isParent && pendingApprovalCount > 0 ? (
                            <Link href="/tasks" className="tap-sm text-xs font-semibold widget-accent-text">{pendingApprovalCount} need approval →</Link>
                          ) : hiddenTasks > 0 ? (
                            <Link href="/tasks" className="tap-sm text-xs font-semibold widget-accent-text">+{hiddenTasks} more · See all →</Link>
                          ) : undefined
                        }>
```

(`isParent` comes from the existing `useAuth()` destructure at line 133 — no import change. `Link` is already imported in this file.)

- [ ] **Step 3: Verify in Task 9 probe**

Covered by Task 9 Steps 3-4 (parent Home badge assertion).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(tasks): parents-only pending-approval badge on Home tasks widget"
```

### Task 9: Docs, full verification, live probe

**Files:**
- Modify: `Home-ai/AGENTS.md` (Current Dashboard Snapshot line + UI Change Record entry, following the §1.1 delta format)
- Verify: full suite, typecheck, lint, live browser probe

- [ ] **Step 1: Update AGENTS.md**

Prepend one line to the Current Dashboard Snapshot stack:

```markdown
- **Last Updated:** 2026-09-06 | **Kid tap-to-complete with pending parent approval.** Child sessions complete assigned chores PIN-free: the tap marks the task done immediately (confetti + "+Npts on the way") but writes a `pendingApproval` record instead of an `earn` tx — zero points move. Parents review a "Needs approval" section on the Tasks page (Approve posts the earn, Send back reopens with nothing awarded), both parent-PIN-gated via the shared `verifyPinRemote` loop; Home shows a parents-only count badge. Universal/stealable claims, adult flows, and PIN undo semantics are unchanged. Tests +N (tasks-pending-approval, tasks-pending-merge, tasks-pending-flow, kid-home-quest-pin-safety flips); suite green, tsc/eslint clean. Spec: `docs/superpowers/specs/2026-09-06-tap-to-complete-pending-approval-design.md`.
```

Add a matching UI Change Record entry under §1.1 following the established delta format (Added/Changed, Visual/Motion, Agent action required, User-facing description).

- [ ] **Step 2: Run the full gates**

Run: `npx vitest run`
Expected: PASS — full suite green (no failures).

Run: `npm run typecheck`
Expected: clean, no output.

Run: `npx eslint src/types/tasks.ts src/lib/task-utils.ts src/lib/pb-seed.ts src/app/tasks/page.tsx src/app/page.tsx src/modes/kid/KidHome.tsx tests/unit/tasks-pending-approval.test.ts tests/unit/tasks-pending-merge.test.ts tests/unit/tasks-pending-flow.test.tsx tests/unit/kid-home-quest-pin-safety.test.tsx tests/unit/pb-seed-field-heal.test.ts`
Expected: no errors on touched files (pre-existing findings elsewhere untouched).

- [ ] **Step 3: Live browser probe**

Start the dev server (`npm run dev` in `Home-ai/`), then in a real browser at 390×844 and 1280×800, signed in as a child (Jasmine) and as a parent (Rebecca), assert:
1. Child taps an assigned chore → confetti + "on the way" toast, row shows "⏳ On the way", no PIN modal appears.
2. Parent Tasks page shows "Needs approval" with the tapped chore; kid/guest sessions show no such section.
3. Parent approves with parent PIN → points land, queue clears; send-back reopens with zero history.
4. Parent Home Tasks widget shows "N need approval →" linking to `/tasks`; child Home shows nothing extra.
5. Zero page errors, no horizontal overflow at either viewport.

- [ ] **Step 4: Commit docs**

```bash
git add Home-ai/AGENTS.md
git commit -m "docs(tasks): tap-to-complete pending approval snapshot + change record"
```

## Self-Review

- **Spec coverage:** data model (§1) → Tasks 1-3; kid flow (§2) → Tasks 5, 7; approval + badge (§3) → Tasks 6, 8; sync/rollover/edge (§4) → Tasks 3 (adopt rules), 4 (regen), 1 (rollover unit); testing (§5) → every task's Steps 1-2-4 plus Task 9 gates. No gaps.
- **Placeholder scan:** all steps carry exact file paths, line anchors, complete code, exact commands with expected output. The two deliberate non-code verifications (Task 8 badge, Task 7 UI) are pinned to Task 9 probe assertions — no open ends.
- **Type consistency:** `PendingApproval { byName, at, points }` spelled identically in type, helpers, payload, seed, merge, UI meta lines, and tests. `approvePendingCompletion(tasks, weekData, taskId)` / `sendBackPendingCompletion(tasks, taskId)` signatures match every call site. Locked copy strings (`on the way`, `⏳ On the way`, `Needs approval`, `Approve points`, `Parent PIN`, `Parent PIN required to review tapped tasks.`, `Approved!`, `Back on the list — no points were given.`, `Sent back — no points were given.`, `need approval →`) match between implementation steps and test assertions.
