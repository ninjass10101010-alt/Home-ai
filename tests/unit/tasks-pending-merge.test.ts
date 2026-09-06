import { describe, it, expect, vi } from "vitest";
import type { Task, WeekData } from "@/types/tasks";

vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));

import { mergeTasksSnapshot } from "@/lib/task-utils";

const NOW = "2026-09-06T12:00:00.000Z";

function t(over: any = {}): any {
  return {
    id: 1, title: "Make bed", assignee: "Megan", assigneeEmoji: "👧",
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
    const remote = [t({ completed: true, completedBy: "Megan", completedAt: NOW, completedInWeek: "2026-09-01", pendingApproval: { byName: "Megan", at: NOW, points: 5 } })];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect(out.tasksChanged).toBe(true);
    expect((out.tasks[0] as any).pendingApproval).toEqual({ byName: "Megan", at: NOW, points: 5 });
    expect(out.tasks[0].completed).toBe(true);
  });

  it("keeps a fresh local pending when the snapshot lacks it and no earn exists", () => {
    const local = [t({ completed: true, pendingApproval: { byName: "Megan", at: NOW, points: 5 } })];
    const remote = [t({})];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect((out.tasks[0] as any).pendingApproval).toEqual({ byName: "Megan", at: NOW, points: 5 });
  });

  it("adopts a remote clear when the earn tx proves approval happened elsewhere", () => {
    const local = [t({ completed: true, pendingApproval: { byName: "Megan", at: NOW, points: 5 } })];
    const remote = [t({ completed: true, completedBy: "Megan", completedAt: NOW, completedInWeek: "2026-09-01" })];
    const paid = wk({ history: [{ id: 7, timestamp: NOW, member: "Megan", type: "earn", amount: 5, description: "Completed: Make bed (+5pts)", taskId: 1 }] });
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, paid));
    expect(out.tasksChanged).toBe(true);
    expect((out.tasks[0] as any).pendingApproval).toBeUndefined();
    expect(out.weekChanged).toBe(true);
  });

  it("adopts a remote completion on a locally open row", () => {
    const local = [t({})];
    const remote = [t({ completed: true, completedBy: "Megan", completedAt: NOW, completedInWeek: "2026-09-01" })];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect(out.tasksChanged).toBe(true);
    expect(out.tasks[0].completed).toBe(true);
    expect(out.tasks[0].completedBy).toBe("Megan");
  });

  it("no-change refresh returns inputs by reference", () => {
    const local = [t({})];
    const week = wk();
    const out = mergeTasksSnapshot(local as Task[], week, snap([t({})], wk()));
    expect(out.tasksChanged).toBe(false);
    expect(out.tasks).toBe(local);
  });

  it("adopts a remote send-back (cleared row with sentBackAt, no earn) over a locally-pending row", () => {
    const local = [t({ completed: true, pendingApproval: { byName: "Megan", at: NOW, points: 5 } })];
    // Sent back on another device: reopened, no earn tx, durable sentBackAt proof.
    const remote = [t({ sentBackAt: NOW })];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect(out.tasksChanged).toBe(true);
    expect(out.tasks[0].completed).toBe(false);
    expect((out.tasks[0] as any).pendingApproval).toBeUndefined();
    expect((out.tasks[0] as any).sentBackAt).toBe(NOW);
  });

  it("remote clear with NEITHER sentBackAt NOR earn still does not wipe a locally-pending row (fresh-tap protection)", () => {
    const local = [t({ completed: true, pendingApproval: { byName: "Megan", at: NOW, points: 5 } })];
    const remote = [t({})];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect((out.tasks[0] as any).pendingApproval).toEqual({ byName: "Megan", at: NOW, points: 5 });
    expect(out.tasks[0].completed).toBe(true);
  });

  it("locally paid completion (completed, no pending) is not reverted by a stale open snapshot", () => {
    const local = [t({ completed: true, completedBy: "Megan", completedAt: NOW, completedInWeek: "2026-09-01" })];
    const remote = [t({})];
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, wk()));
    expect(out.tasks[0].completed).toBe(true);
    expect(out.tasks[0].completedBy).toBe("Megan");
    expect(out.tasksChanged).toBe(false);
  });

  it("locally paid completion is adopted when the snapshot carries proof (earn tx)", () => {
    const local = [t({ completed: true, completedBy: "Megan", completedAt: NOW, completedInWeek: "2026-09-01" })];
    const remote = [t({})];
    const paid = wk({ history: [{ id: 7, timestamp: NOW, member: "Megan", type: "earn", amount: 5, description: "Completed: Make bed", taskId: 1 }] });
    const out = mergeTasksSnapshot(local as Task[], wk(), snap(remote, paid));
    expect(out.tasksChanged).toBe(true);
    expect(out.tasks[0].completed).toBe(false);
    expect(out.tasks[0].completedBy).toBeUndefined();
  });
});
