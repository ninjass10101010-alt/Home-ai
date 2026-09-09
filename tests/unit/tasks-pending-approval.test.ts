import { describe, it, expect, vi } from "vitest";
import type { Task, WeekData } from "@/types/tasks";

vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));

import {
  isPendingApproval, pendingApprovals, pendingPointsFor, completesWithoutPin,
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

// Re-pointed Task 8: the deprecated age-blind pending-tap seam is gone; the
// under-10 PIN-free behavior it pinned now lives in completesWithoutPin, so
// every assertion below runs with age 7 (strictly under PIN_FREE_MAX_AGE).
describe("completesWithoutPin (under-10 — re-pointed from the deleted pre-age seam)", () => {
  it("true only for child role on open assigned non-universal tasks", () => {
    expect(completesWithoutPin("child", 7, t({}))).toBe(true);
    expect(completesWithoutPin("parent", 7, t({}))).toBe(false);
    expect(completesWithoutPin(undefined, 7, t({}))).toBe(false);
    expect(completesWithoutPin("child", 7, t({ completed: true }))).toBe(false);
    expect(completesWithoutPin("child", 7, t({ universal: true }))).toBe(false);
    expect(completesWithoutPin("child", 7, t({ stealable: true, due: "2026-09-01" }))).toBe(false);
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

  it("carries sentBackAt to the PB row (cross-device send-back proof rides existing rails)", async () => {
    const { syncTasksToPB } = await import("@/lib/task-utils");
    const { db } = await import("@/db");
    await syncTasksToPB([t({ sentBackAt: NOW })]);
    // mock.calls accumulates across tests in this file — read the latest call.
    const calls = vi.mocked(db.upsertTask).mock.calls;
    expect(calls.at(-1)![0].sentBackAt).toBe(NOW);
  });
});

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
