// F8b — the rollover archive step must persist a finished week into PB's
// week_archive collection (previously nothing wrote it, so the assistant's
// get_past_weeks always returned empty). Contract:
//   - no existing row → exactly one row with points/streak/history intact,
//   - idempotent per weekStart (a second rollover writes nothing),
//   - PB failure degrades without throwing (the sync loop must not crash).
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listArchivedWeeks: vi.fn(),
  archiveWeek: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    listArchivedWeeks: dbMocks.listArchivedWeeks,
    archiveWeek: dbMocks.archiveWeek,
  },
}));

import { archiveWeekIfMissing, emptyWeekData } from "@/lib/task-utils";
import type { WeekData } from "@/types/tasks";

function finishedWeek(): WeekData {
  const week = emptyWeekData("2026-08-31");
  return {
    ...week,
    points: { "Emily G": 42, "Caspian G": 7 },
    streak: { "Emily G": 3 },
    history: [
      {
        id: 1,
        timestamp: "2026-09-01T12:00:00.000Z",
        member: "Emily G",
        type: "earn",
        amount: 5,
        description: "Dishes",
      },
    ],
  };
}

beforeEach(() => {
  dbMocks.listArchivedWeeks.mockReset();
  dbMocks.archiveWeek.mockReset();
  dbMocks.listArchivedWeeks.mockResolvedValue([]);
  dbMocks.archiveWeek.mockResolvedValue({ id: "wa1" });
});

describe("archiveWeekIfMissing", () => {
  it("writes exactly one week_archive row with points/streak/history intact", async () => {
    const week = finishedWeek();

    const wrote = await archiveWeekIfMissing(week);

    expect(wrote).toBe(true);
    expect(dbMocks.archiveWeek).toHaveBeenCalledTimes(1);
    const payload = dbMocks.archiveWeek.mock.calls[0][0];
    expect(payload.weekStart).toBe("2026-08-31");
    expect(typeof payload.archivedAt).toBe("string");
    expect(payload.points).toEqual(week.points);
    expect(payload.streak).toEqual(week.streak);
    expect(payload.history).toEqual(week.history);
  });

  it("is idempotent per weekStart — a second rollover writes nothing", async () => {
    const week = finishedWeek();
    await archiveWeekIfMissing(week);
    expect(dbMocks.archiveWeek).toHaveBeenCalledTimes(1);

    // PB now holds the row for that week.
    dbMocks.listArchivedWeeks.mockResolvedValue([{ id: "wa1", weekStart: "2026-08-31" }]);
    const wrote = await archiveWeekIfMissing(week);

    expect(wrote).toBe(false);
    expect(dbMocks.archiveWeek).toHaveBeenCalledTimes(1);
  });

  it("skips a week already present in the provided existing set", async () => {
    const week = finishedWeek();
    const existing = new Set(["2026-08-31"]);

    const wrote = await archiveWeekIfMissing(week, existing);

    expect(wrote).toBe(false);
    expect(dbMocks.listArchivedWeeks).not.toHaveBeenCalled();
    expect(dbMocks.archiveWeek).not.toHaveBeenCalled();
  });

  it("degrades without throwing when the archive read fails", async () => {
    dbMocks.listArchivedWeeks.mockRejectedValue(new Error("PB down"));

    await expect(archiveWeekIfMissing(finishedWeek())).resolves.toBe(false);
    expect(dbMocks.archiveWeek).not.toHaveBeenCalled();
  });

  it("degrades without throwing when the archive write fails", async () => {
    dbMocks.archiveWeek.mockRejectedValue(new Error("PB down"));

    await expect(archiveWeekIfMissing(finishedWeek())).resolves.toBe(false);
  });

  it("no-ops on a week with no weekStart", async () => {
    const wrote = await archiveWeekIfMissing({} as WeekData);

    expect(wrote).toBe(false);
    expect(dbMocks.archiveWeek).not.toHaveBeenCalled();
  });
});
