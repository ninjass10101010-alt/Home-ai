import { describe, it, expect, vi } from "vitest";
import type { Task, WeekData } from "@/types/tasks";

vi.mock("@/db", () => ({ db: {} }));

import {
  isPendingApproval, pendingApprovals, pendingPointsFor, completesWithoutPin,
  tapCompletePending, approvePendingCompletion, sendBackPendingCompletion, adoptAuthoritativeWeekData,
} from "@/lib/task-utils";
import { taskProjectionRecord } from "@/lib/snapshot-tasks";

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

describe("approvePendingCompletion pays the recorded approval amount (B1)", () => {
  it("pays pendingApproval.points (incl. speed bonus), not task.points", () => {
    const tasks = [t({
      id: 42, title: "Open grab", assignee: "Caspian Garcia", assigneeEmoji: "🧒",
      points: 6, completed: true, completedBy: "Caspian Garcia", completedAt: NOW,
      completedInWeek: "2026-09-01",
      pendingApproval: { byName: "Caspian Garcia", at: NOW, points: 8 },
    })];
    const { weekData: next } = approvePendingCompletion(tasks, wk(), 42);
    expect(next.points["Caspian Garcia"]).toBe(8);
    const earn = next.history.find((tx) => tx.type === "earn");
    expect(earn?.amount).toBe(8);
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

describe("pendingApproval persistence — the server task projection", () => {
  it("writes the pending record when set, null otherwise", () => {
    const record = taskProjectionRecord(
      t({ completed: true, pendingApproval: { byName: "Jasmine", at: NOW, points: 5 } }) as any,
    );
    expect(record.pendingApproval).toEqual({ byName: "Jasmine", at: NOW, points: 5 });
    expect(taskProjectionRecord(t({ id: 2, title: "No pending" }) as any).pendingApproval).toBeNull();
  });

  it("carries sentBackAt to the PB row (cross-device send-back proof rides existing rails)", () => {
    expect(taskProjectionRecord(t({ sentBackAt: NOW }) as any).sentBackAt).toBe(NOW);
  });
});

describe("adoptAuthoritativeWeekData (Task 10 \u2014 outbox/snapshot adoption, no history heuristic)", () => {
  const offlineTx = {
    id: 1, timestamp: "2026-09-22T10:00:00.000Z", member: "Jasmine Rose",
    type: "earn", amount: 8, description: "Completed: Dishes (+8pts)", taskId: 101,
  } as any;

  it("same week, server ledger SHORTER than local \u2192 the server is the truth and wins", () => {
    const prev = wk({ history: [offlineTx] as any });
    const server = wk({ history: [] });
    const adopted = adoptAuthoritativeWeekData(prev, server);
    expect(adopted.history).toHaveLength(0);
    expect(adopted).not.toBe(prev);
  });

  it("same week, server ledger at least as long \u2192 adopted", () => {
    const prev = wk({ history: [offlineTx] as any });
    const server = wk({
      points: { "Caspian Garcia": 8 },
      history: [offlineTx, { id: 2, timestamp: "2026-09-22T11:00:00.000Z", member: "Caspian Garcia", type: "earn", amount: 8, description: "x", taskId: 102 }] as any,
    });
    const adopted = adoptAuthoritativeWeekData(prev, server);
    expect(adopted.points["Caspian Garcia"]).toBe(8);
    expect(adopted.history).toHaveLength(2);
  });

  it("server carries a NEWER week \u2192 adopted (Monday rollover)", () => {
    const prev = wk({ weekStart: "2026-09-01", history: [offlineTx] as any });
    const server = wk({ weekStart: "2026-09-08", history: [] });
    expect(adoptAuthoritativeWeekData(prev, server)).toMatchObject({ weekStart: "2026-09-08" });
  });

  it("server carries an OLDER week (stale server) \u2192 local kept", () => {
    const prev = wk({ weekStart: "2026-09-08" });
    const server = wk({ weekStart: "2026-09-01" });
    expect(adoptAuthoritativeWeekData(prev, server)).toBe(prev);
  });

  it("empty/absent server week \u2192 local kept; empty local \u2192 server adopted", () => {
    const prev = wk();
    expect(adoptAuthoritativeWeekData(prev, {} as WeekData)).toBe(prev);
    const server = wk();
    expect(adoptAuthoritativeWeekData({} as WeekData, server)).toMatchObject({ weekStart: server.weekStart });
  });
});
