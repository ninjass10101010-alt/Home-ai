// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upsertTask: vi.fn(),
  upsertWeekData: vi.fn(),
  listArchivedWeeks: vi.fn(),
  archiveWeek: vi.fn(),
  upsertReward: vi.fn(),
  upsertWeeklyPrize: vi.fn(),
  upsertPenalty: vi.fn(),
  upsertFamilyGoal: vi.fn(),
  selectHallOfFame: vi.fn(),
  selectHallOfFameAuthoritative: vi.fn(),
  insertHallOfFameEntry: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: h,
}));

import {
  emptyWeekData,
  syncAllTasksToPB,
  syncFamilyGoalToPB,
  syncHallOfFameToPB,
  syncTasksToPB,
} from "@/lib/task-utils";

function task(id: number, title: string) {
  return {
    id,
    title,
    assignee: "Bailey",
    assigneeEmoji: "👧",
    due: "2026-09-21",
    points: 1,
    recurring: null,
    category: "chores",
    completed: false,
    priority: "medium",
  } as any;
}

beforeEach(() => {
  for (const mock of Object.values(h)) mock.mockReset();
  h.listArchivedWeeks.mockResolvedValue([]);
  h.selectHallOfFame.mockResolvedValue([]);
  h.selectHallOfFameAuthoritative.mockResolvedValue([]);
});

describe("task sync outcome reporting", () => {
  it("counts a partial task batch as one success and one error", async () => {
    h.upsertTask.mockResolvedValueOnce({ id: "task-1" }).mockResolvedValueOnce(null);

    await expect(syncTasksToPB([task(1, "One"), task(2, "Two")])).resolves.toEqual({
      pushed: 1,
      errors: 1,
    });
  });

  it("counts an all-failed task batch without rejecting", async () => {
    h.upsertTask.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("gateway unavailable"));

    await expect(syncTasksToPB([task(1, "One"), task(2, "Two")])).resolves.toEqual({
      pushed: 0,
      errors: 2,
    });
  });

  it("reports a swallowed family-goal failure", async () => {
    h.upsertFamilyGoal.mockResolvedValue(null);

    await expect(syncFamilyGoalToPB({
      title: "Family goal",
      emoji: "🏆",
      targetPoints: 10,
      reward: "Treat",
      weekStart: "2026-09-21",
    } as any)).resolves.toEqual({ pushed: 0, errors: 1 });
  });

  it("aggregates the actual task-leg result", async () => {
    h.upsertTask.mockResolvedValueOnce({ id: "task-1" }).mockResolvedValueOnce(null);

    await expect(syncAllTasksToPB(
      [task(1, "One"), task(2, "Two")],
      null as any,
      {},
      [],
      [],
      [],
    )).resolves.toEqual({ pushed: 1, errors: 1 });
  });

  it("does not count an empty sync as a write", async () => {
    await expect(syncAllTasksToPB([], null as any, {}, [], [], [])).resolves.toEqual({
      pushed: 0,
      errors: 0,
    });
    expect(h.upsertWeekData).not.toHaveBeenCalled();
  });

  it("reports a Hall of Fame read failure and performs no Hall of Fame inserts", async () => {
    h.selectHallOfFameAuthoritative.mockRejectedValueOnce(new Error("hall read unavailable"));

    await expect(syncHallOfFameToPB([{
      member: "Rebecca",
      emoji: "👩",
      weekStart: "2026-09-21",
      points: 10,
      rank: 1,
    }])).resolves.toEqual({ pushed: 0, errors: 1 });
    expect(h.insertHallOfFameEntry).not.toHaveBeenCalled();
  });
});
