// @vitest-environment jsdom
process.env.TZ = "UTC";

import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => null),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

import { mergeTasksSnapshot, saveWeekData } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    due: "2026-09-04",
    points: 5,
    recurring: null,
    category: "kitchen",
    completed: false,
    priority: "medium",
    crewSize: null,
    crew: null,
    speedBonus: undefined,
    ...overrides,
  } as Task;
}

import type { WeekData } from "@/types/tasks";

function createWeekData(): WeekData {
  return {
    weekStart: "2026-09-04",
    points: {},
    streak: {},
    lastActive: {},
    history: [],
  };
}

describe("Task crew fields", () => {
  it("emptyTask defaults crew fields to null/undefined", async () => {
    const { emptyTask } = await import("@/lib/task-utils");
    const task = emptyTask({ name: "Alex", emoji: "🦊" });
    expect(task.crewSize).toBeNull();
    expect(task.crew).toBeNull();
    expect(task.speedBonus).toBeUndefined();
  });

  it("mergeTasksSnapshot preserves crew fields from snapshot", async () => {
    const existing = makeTask({ id: 10 });
    const weekData = createWeekData();
    const snapshotTask = makeTask({
      id: 10,
      title: "Team Garage Clean",
      crewSize: 3,
      crew: ["Alex", "Lily"],
      speedBonus: 2,
    });
    const { tasks: merged } = mergeTasksSnapshot([existing], weekData, { tasks: [snapshotTask] });
    expect(merged[0].crewSize).toBe(3);
    expect(merged[0].crew).toEqual(["Alex", "Lily"]);
    expect(merged[0].speedBonus).toBe(2);
  });

  it("mergeTasksSnapshot uses snapshot crew when both exist", async () => {
    const existing = makeTask({ id: 11, crewSize: 2, crew: ["Old"] } as any);
    const weekData = createWeekData();
    const snapshotTask = makeTask({ id: 11, crewSize: 4, crew: ["New"] } as any);
    const { tasks: merged } = mergeTasksSnapshot([existing], weekData, { tasks: [snapshotTask] });
    expect(merged[0].crewSize).toBe(4);
    expect(merged[0].crew).toEqual(["New"]);
  });

  it("mergeTasksSnapshot drops crew fields when snapshot omits them", async () => {
    const existing = makeTask({ id: 12, crewSize: 2, crew: ["A"] } as any);
    const weekData = createWeekData();
    const snapshotTask = makeTask({ id: 12 });
    const { tasks: merged } = mergeTasksSnapshot([existing], weekData, { tasks: [snapshotTask] });
    expect(merged[0].crewSize).toBeNull();
    expect(merged[0].crew).toBeNull();
  });

  it("mergeTasksSnapshot includes crewSize, crew, speedBonus in field map", async () => {
    const existing = makeTask({ id: 13 });
    const weekData = createWeekData();
    const snapshotTask = makeTask({
      id: 13,
      crewSize: 2,
      crew: ["Alex"],
      speedBonus: 1,
    } as any);
    const { tasks: merged } = mergeTasksSnapshot([existing], weekData, { tasks: [snapshotTask] });
    expect(merged[0]).toHaveProperty("crewSize", 2);
    expect(merged[0]).toHaveProperty("crew", ["Alex"]);
    expect(merged[0]).toHaveProperty("speedBonus", 1);
  });
});
