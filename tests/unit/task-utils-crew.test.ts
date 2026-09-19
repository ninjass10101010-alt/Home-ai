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

import {
  mergeTasksSnapshot,
  isCrewTask,
  crewMembers,
  crewMemberCount,
  crewFull,
  crewHasMember,
  canJoinCrew,
  crewMemberCheckedIn,
  crewCheckinProgress,
  crewAllCheckedIn,
  unionCrewMembers,
} from "@/lib/task-utils";
import type { Task, WeekData, CrewMember } from "@/types/tasks";

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

function member(name: string, extra: Partial<CrewMember> = {}): CrewMember {
  return { name, emoji: "🧒", joinedAt: "2026-09-18T10:00:00.000Z", ...extra };
}

function createWeekData(): WeekData {
  return {
    weekStart: "2026-09-04",
    points: {},
    streak: {},
    lastActive: {},
    history: [],
  };
}

describe("Task crew fields — data model", () => {
  it("emptyTask defaults crew fields to null/undefined", async () => {
    const { emptyTask } = await import("@/lib/task-utils");
    const task = emptyTask({ name: "Alex", emoji: "🦊" });
    expect(task.crewSize).toBeNull();
    expect(task.crew).toBeNull();
    expect(task.speedBonus).toBeUndefined();
  });

  it("mergeTasksSnapshot preserves a crew object from the snapshot", async () => {
    const existing = makeTask({ id: 10 });
    const snapshotTask = makeTask({
      id: 10,
      title: "Team Garage Clean",
      crewSize: 3,
      crew: { members: [member("Alex"), member("Lily")] },
      speedBonus: 2,
    });
    const { tasks: merged } = mergeTasksSnapshot([existing], createWeekData(), { tasks: [snapshotTask] });
    expect(merged[0].crewSize).toBe(3);
    expect(merged[0].crew).toEqual({ members: [member("Alex"), member("Lily")] });
    expect(merged[0].speedBonus).toBe(2);
  });

  it("mergeTasksSnapshot union-merges members by name with set-once check-ins", () => {
    const existing = makeTask({
      id: 11,
      crewSize: 3,
      crew: { members: [member("Alex", { joinedAt: "2026-09-18T12:00:00.000Z", checkedInAt: "2026-09-18T13:00:00.000Z" })] },
    });
    const snapshotTask = makeTask({
      id: 11,
      crewSize: 3,
      crew: {
        members: [
          member("Alex", { joinedAt: "2026-09-18T09:00:00.000Z" }),
          member("Lily"),
        ],
      },
    });
    const { tasks: merged } = mergeTasksSnapshot([existing], createWeekData(), { tasks: [snapshotTask] });
    const names = crewMembers(merged[0]).map((m) => m.name);
    expect(names.sort()).toEqual(["Alex", "Lily"]);
    // earliest join time wins; the local check-in is never lost
    expect(crewMembers(merged[0]).find((m) => m.name === "Alex")?.joinedAt).toBe("2026-09-18T09:00:00.000Z");
    expect(crewMemberCheckedIn(merged[0], "Alex")).toBe(true);
  });

  it("mergeTasksSnapshot drops crew when the snapshot has none", () => {
    const existing = makeTask({ id: 12, crewSize: 2, crew: { members: [member("A")] } });
    const snapshotTask = makeTask({ id: 12, crewSize: 0 } as any);
    const { tasks: merged } = mergeTasksSnapshot([existing], createWeekData(), { tasks: [snapshotTask] });
    expect(merged[0].crewSize).toBeNull();
    expect(merged[0].crew).toBeNull();
  });

  it("does NOT churn when PocketBase coerces unset crew numbers to 0", () => {
    // Regression: a non-crew row comes back from PB as crewSize:0/speedBonus:0
    // while local carries null/undefined. The merge must see no change.
    const existing = makeTask({ id: 13, crewSize: null, speedBonus: undefined });
    const snapshotTask = makeTask({ id: 13, crewSize: 0, speedBonus: 0 } as any);
    const result = mergeTasksSnapshot([existing], createWeekData(), { tasks: [snapshotTask] });
    expect(result.tasksChanged).toBe(false);
    expect(result.tasks[0]).toBe(existing);
    expect(result.tasks[0].crewSize).toBeNull();  });
});

describe("Crew helpers", () => {
  const crewTask = makeTask({
    id: 20,
    crewSize: 3,
    crew: {
      members: [
        member("Alex", { checkedInAt: "2026-09-18T12:00:00.000Z" }),
        member("Lily"),
      ],
    },
  });

  it("identifies crew tasks", () => {
    expect(isCrewTask(crewTask)).toBe(true);
    expect(isCrewTask(makeTask({ crewSize: 1 } as any))).toBe(false);
    expect(isCrewTask(makeTask())).toBe(false);
    expect(isCrewTask(undefined)).toBe(false);
  });

  it("counts members and fullness", () => {
    expect(crewMemberCount(crewTask)).toBe(2);
    expect(crewFull(crewTask)).toBe(false);
    expect(crewFull({ ...crewTask, crew: { members: [member("A"), member("B"), member("C")] } })).toBe(true);
  });

  it("allows joining only when not full and not already in", () => {
    expect(canJoinCrew(crewTask, "Caspian")).toBe(true);
    expect(canJoinCrew(crewTask, "Alex")).toBe(false);
    expect(canJoinCrew({ ...crewTask, crew: { members: [member("A"), member("B"), member("C")] } }, "Caspian")).toBe(false);
    expect(canJoinCrew({ ...crewTask, completed: true }, "Caspian")).toBe(false);
  });

  it("reports check-in progress and the all-checked-in trigger", () => {
    expect(crewCheckinProgress(crewTask)).toEqual({ checkedIn: 1, total: 3 });
    expect(crewAllCheckedIn(crewTask)).toBe(false);
    const full = makeTask({
      crewSize: 2,
      crew: { members: [member("A", { checkedInAt: "x" }), member("B", { checkedInAt: "y" })] },
    });
    expect(crewAllCheckedIn(full)).toBe(true);
  });

  it("unionCrewMembers is order-independent and set-once", () => {
    const a = [member("Alex", { joinedAt: "2026-09-18T12:00:00.000Z" })];
    const b = [member("Alex", { joinedAt: "2026-09-18T08:00:00.000Z", checkedInAt: "2026-09-18T14:00:00.000Z" })];
    const merged = unionCrewMembers(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].joinedAt).toBe("2026-09-18T08:00:00.000Z");
    expect(merged[0].checkedInAt).toBe("2026-09-18T14:00:00.000Z");
    expect(crewHasMember({ crew: { members: merged } }, "Alex")).toBe(true);
  });

  it("respects a removed-member tombstone on merge (no cross-device resurrection)", () => {
    const local = makeTask({
      id: 14,
      crewSize: 3,
      crew: { members: [member("Alex"), member("Lily")], removed: ["Lily"] },
    });
    const snapshotTask = makeTask({
      id: 14,
      crewSize: 3,
      // A stale device still carries Lily as joined.
      crew: { members: [member("Alex"), member("Lily")] },
    });
    const { tasks: merged } = mergeTasksSnapshot([local], createWeekData(), { tasks: [snapshotTask] });
    expect(crewMembers(merged[0]).map((m) => m.name)).toEqual(["Alex"]);
    expect(merged[0].crew?.removed).toContain("Lily");
  });
});

describe("Recurring crew regeneration", () => {
  it("clones a recurring crew task with an empty crew and preserved size/bonus", async () => {
    localStorage.clear();
    const { regenerateRecurringTasks } = await import("@/lib/task-utils");
    const completed = makeTask({
      id: 30,
      title: "Deep clean the playroom",
      recurring: "weekly",
      completed: true,
      completedInWeek: "2026-09-07",
      completedBy: "Alex",
      assignee: "Alex",
      crewSize: 3,
      crew: { members: [member("Alex", { checkedInAt: "x" }), member("Lily")] },
      speedBonus: undefined,
    });
    const regen = regenerateRecurringTasks([completed]);
    const clone = regen.find((t) => t.title === "Deep clean the playroom");
    expect(clone).toBeTruthy();
    expect(clone!.completed).toBe(false);
    expect(clone!.crewSize).toBe(3);
    expect(clone!.crew).toEqual({ members: [] });
    // the consumed source is removed (no compounding duplicates)
    expect(regen.some((t) => t.id === 30)).toBe(false);
  });
});
