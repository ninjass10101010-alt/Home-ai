// @vitest-environment jsdom
process.env.TZ = "UTC";

import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({
  db: {},
}));

import {
  approvePendingCompletion,
  sendBackPendingCompletion,
  pendingPointsFor,
  emptyWeekData,
  isPendingApproval,
  crewAllCheckedIn,
} from "@/lib/task-utils";
import type { Task, WeekData, CrewMember } from "@/types/tasks";

function member(name: string, checkedInAt?: string): CrewMember {
  return { name, emoji: "🧒", joinedAt: "2026-09-18T10:00:00.000Z", ...(checkedInAt ? { checkedInAt } : {}) };
}

function crewPendingTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 77,
    title: "Wash the van",
    assignee: "Crew",
    assigneeEmoji: "🤝",
    due: "2026-09-18",
    points: 15,
    recurring: null,
    category: "chores",
    completed: true,
    priority: "medium",
    completedBy: "Crew",
    completedAt: "2026-09-18T20:00:00.000Z",
    completedInWeek: "2026-09-14",
    crewSize: 2,
    crew: { members: [member("Alex", "t1"), member("Lily", "t2")] },
    pendingApproval: { byName: "Crew", at: "2026-09-18T20:00:00.000Z", points: 15, crew: ["Alex", "Lily"] },
    ...overrides,
  } as Task;
}

describe("Crew approval", () => {
  it("pays every crew member full points with one 'Crew:' earn each", () => {
    const task = crewPendingTask();
    const week = emptyWeekData("2026-09-14");
    const { tasks, weekData } = approvePendingCompletion([task], week, task.id);

    expect(isPendingApproval(tasks[0])).toBe(false);
    expect(weekData.points["Alex"]).toBe(15);
    expect(weekData.points["Lily"]).toBe(15);
    const earns = weekData.history.filter((tx) => tx.type === "earn" && tx.taskId === task.id);
    expect(earns).toHaveLength(2);
    expect(earns.every((tx) => tx.description.startsWith("Crew:"))).toBe(true);
  });

  it("is idempotent per member on a second approval", () => {
    const task = crewPendingTask();
    const first = approvePendingCompletion([task], emptyWeekData("2026-09-14"), task.id);
    // Simulate a stale second device approving again.
    const again = crewPendingTask();
    const second = approvePendingCompletion([again], first.weekData, again.id);
    expect(second.weekData.points["Alex"]).toBe(15);
    expect(second.weekData.points["Lily"]).toBe(15);
    expect(second.weekData.history.filter((tx) => tx.type === "earn")).toHaveLength(2);
  });

  it("re-pays a member whose earn was reversed", () => {
    const task = crewPendingTask();
    const base = emptyWeekData("2026-09-14");
    const withReversed: WeekData = {
      ...base,
      points: { Alex: 0, Lily: 15 },
      history: [
        { id: 1, timestamp: "2026-09-18T20:01:00.000Z", member: "Alex", type: "earn", amount: 15, description: "Crew: Wash the van", taskId: 77 },
        { id: 2, timestamp: "2026-09-18T20:02:00.000Z", member: "Alex", type: "adjust", amount: -15, description: "Undo", taskId: 77 },
        { id: 3, timestamp: "2026-09-18T20:01:00.000Z", member: "Lily", type: "earn", amount: 15, description: "Crew: Wash the van", taskId: 77 },
      ],
    };
    const { weekData } = approvePendingCompletion([task], withReversed, task.id);
    // Alex is re-paid (his earn was reversed); Lily stays paid once.
    expect(weekData.points["Alex"]).toBe(15);
    expect(weekData.points["Lily"]).toBe(15);
    expect(weekData.history.filter((tx) => tx.type === "earn" && tx.member === "Alex" && tx.taskId === 77)).toHaveLength(2);
    expect(weekData.history.filter((tx) => tx.type === "earn" && tx.member === "Lily" && tx.taskId === 77)).toHaveLength(1);
  });

  it("send-back clears the crew check-ins and the pending state", () => {
    const task = crewPendingTask();
    expect(crewAllCheckedIn(task)).toBe(true);
    const next = sendBackPendingCompletion([task], task.id);
    expect(next[0].completed).toBe(false);
    expect(next[0].pendingApproval).toBeUndefined();
    expect(next[0].sentBackAt).toBeTruthy();
    expect(crewAllCheckedIn(next[0])).toBe(false);
    // Crew membership survives; only the check-ins reset.
    expect(next[0].crew?.members.map((m) => m.name)).toEqual(["Alex", "Lily"]);
    expect(next[0].crew?.members.every((m) => !m.checkedInAt)).toBe(true);
  });

  it("pendingPointsFor includes an in-flight crew value", () => {
    const task = crewPendingTask();
    expect(pendingPointsFor("Alex", [task])).toBe(15);
    expect(pendingPointsFor("Lily", [task])).toBe(15);
    expect(pendingPointsFor("Caspian", [task])).toBe(0);
  });

  it("still pays a solo pending tap exactly once (regression)", () => {
    const solo: Task = {
      ...crewPendingTask(),
      id: 55,
      title: "Trash",
      points: 5,
      crewSize: null,
      crew: null,
      pendingApproval: { byName: "Caspian", at: "2026-09-18T20:00:00.000Z", points: 5 },
    };
    const first = approvePendingCompletion([solo], emptyWeekData("2026-09-14"), solo.id);
    expect(first.weekData.points["Caspian"]).toBe(5);
    expect(first.weekData.history.filter((tx) => tx.type === "earn")).toHaveLength(1);
  });
});
