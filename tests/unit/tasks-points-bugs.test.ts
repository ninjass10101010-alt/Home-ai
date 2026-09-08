import { describe, it, expect, vi } from "vitest";
import type { Task, WeekData, Transaction } from "@/types/tasks";

vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));

import {
  approvePendingCompletion,
  mergeTasksSnapshot,
} from "@/lib/task-utils";

function t(over: Partial<Task>): Task {
  return {
    id: 1, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧",
    due: "2026-09-06", points: 5, recurring: null, category: "Chores",
    completed: false, priority: "low", ...over,
  };
}

function wk(over: Partial<WeekData> = {}): WeekData {
  return { weekStart: "2026-09-07", points: {}, streak: {}, lastActive: {}, history: [], ...over };
}

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 1, timestamp: "2026-09-08T12:00:00.000Z", member: "Jasmine",
    type: "earn", amount: 5, description: "Completed: Make bed (+5pts)", taskId: 1,
    ...over,
  };
}

const PENDING = { byName: "Jasmine", at: "2026-09-08T12:00:00.000Z", points: 5 };

describe("approve after an undo (reversal-aware idempotency)", () => {
  it("a completed-then-undone task can be tapped and approved again — the reversal does not block a new earn", () => {
    // Kid tapped → approved (+5) → parent undid (adjust -5). Kid tapped again;
    // the row is pending once more. Approving must pay again.
    const tasks = [t({ completed: true, completedInWeek: "2026-09-07", pendingApproval: PENDING })];
    const week = wk({
      points: { Jasmine: 0 },
      history: [
        tx({ id: 7, timestamp: "2026-09-08T09:00:00.000Z", type: "earn", amount: 5 }),
        tx({ id: 8, timestamp: "2026-09-08T10:00:00.000Z", type: "adjust", amount: -5, description: "Undo: Make bed (-5pts)" }),
      ],
    });
    const { weekData: nw } = approvePendingCompletion(tasks, week, 1);
    const earns = nw.history.filter((x) => x.type === "earn");
    expect(earns).toHaveLength(2);
    expect(nw.points["Jasmine"]).toBe(5);
  });

  it("a pending task whose earn was undone and NOT re-tapped does not pay from stale state", () => {
    // Guard the guard: a live (unreversed) earn still blocks a double pay.
    const tasks = [t({ completed: true, completedInWeek: "2026-09-07", pendingApproval: PENDING })];
    const week = wk({
      history: [tx({ id: 7, timestamp: "2026-09-08T09:00:00.000Z", type: "earn", amount: 5 })],
    });
    const { weekData: nw } = approvePendingCompletion(tasks, week, 1);
    expect(nw.history.filter((x) => x.type === "earn")).toHaveLength(1);
    expect(nw.points["Jasmine"] ?? 0).toBe(0);
  });
});

describe("mergeTasksSnapshot week guard", () => {
  it("a snapshot from a PREVIOUS week never overwrites the current fresh week", () => {
    const current = wk(); // fresh current week, no history yet
    const snapshot = {
      tasks: [],
      weekData: {
        weekStart: "2026-08-31", // last week
        points: { Jasmine: 42 },
        streak: { Jasmine: 3 },
        lastActive: { Jasmine: "2026-09-04T12:00:00.000Z" },
        history: [tx({ id: 7 })],
      },
    };
    const { weekData, weekChanged } = mergeTasksSnapshot([], current, snapshot);
    expect(weekChanged).toBe(false);
    expect(weekData.weekStart).toBe("2026-09-07");
    expect(weekData.points["Jasmine"] ?? 0).toBe(0);
  });

  it("a same-week richer snapshot is still adopted", () => {
    const current = wk();
    const snapshot = {
      tasks: [],
      weekData: {
        weekStart: "2026-09-07",
        points: { Jasmine: 42 },
        streak: {},
        lastActive: {},
        history: [tx({ id: 7 })],
      },
    };
    const { weekData, weekChanged } = mergeTasksSnapshot([], current, snapshot);
    expect(weekChanged).toBe(true);
    expect(weekData.points["Jasmine"]).toBe(42);
  });

  it("a different-week snapshot when local week ALSO differs (device was off for two weeks) still adopts the server week", () => {
    const current = wk({ weekStart: "2026-08-17" }); // local is two weeks stale
    const snapshot = {
      tasks: [],
      weekData: {
        weekStart: "2026-09-07", // server is current
        points: { Jasmine: 42 },
        streak: {},
        lastActive: {},
        history: [tx({ id: 7 })],
      },
    };
    const { weekData, weekChanged } = mergeTasksSnapshot([], current, snapshot);
    expect(weekChanged).toBe(true);
    expect(weekData.weekStart).toBe("2026-09-07");
    expect(weekData.points["Jasmine"]).toBe(42);
  });
});
