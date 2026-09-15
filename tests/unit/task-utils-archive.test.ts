// F8b — the rollover archive step must persist a finished week into PB's
// week_archive collection (previously nothing wrote it, so the assistant's
// get_past_weeks always returned empty). Contract:
//   - no existing row → exactly one row with points/streak/history intact,
//   - idempotent per weekStart (a second rollover writes nothing),
//   - the DB layer is the real duplicate guard: production read adapters
//     resolve [] on a transient failure (they do NOT reject), so a failed
//     pre-read must still not duplicate a row that already exists — the DB
//     upsert by weekStart updates it instead,
//   - a silently-failed write (db.archiveWeek → null) reports false,
//   - PB failure degrades without throwing (the sync loop must not crash).
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listArchivedWeeks: vi.fn(),
  archiveWeek: vi.fn(),
  // The in-memory PB week_archive the upsert mock reads/writes, so tests can
  // model the production failure mode (pre-read resolves [] while the row
  // already exists). Real PB access lives in pb-db-archive-upsert.test.ts.
  weekArchive: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    listArchivedWeeks: dbMocks.listArchivedWeeks,
    archiveWeek: dbMocks.archiveWeek,
  },
}));

import { archiveWeekIfMissing, syncArchiveToPB, emptyWeekData } from "@/lib/task-utils";
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
  dbMocks.weekArchive.length = 0;
  dbMocks.listArchivedWeeks.mockReset();
  dbMocks.archiveWeek.mockReset();
  // Normal reads see the collection; a test may override to [] to simulate the
  // transient read failure the real adapters swallow.
  dbMocks.listArchivedWeeks.mockImplementation(async () => [...dbMocks.weekArchive]);
  // The DB layer's upsert-by-weekStart — the real guarantee against dupes.
  dbMocks.archiveWeek.mockImplementation(async (data: any) => {
    const existing = dbMocks.weekArchive.find((r: any) => r.weekStart === data.weekStart);
    if (existing) {
      Object.assign(existing, data);
      return existing;
    }
    const rec = { id: `wa_${dbMocks.weekArchive.length + 1}`, ...data };
    dbMocks.weekArchive.push(rec);
    return rec;
  });
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
    expect(dbMocks.weekArchive).toHaveLength(1);
  });

  it("is idempotent per weekStart — a second rollover writes nothing", async () => {
    const week = finishedWeek();
    await archiveWeekIfMissing(week);
    expect(dbMocks.archiveWeek).toHaveBeenCalledTimes(1);

    // PB now holds the row for that week, so the fast path skips it.
    const wrote = await archiveWeekIfMissing(week);

    expect(wrote).toBe(false);
    expect(dbMocks.archiveWeek).toHaveBeenCalledTimes(1);
    expect(dbMocks.weekArchive).toHaveLength(1);
  });

  it("skips a week already present in the provided existing set", async () => {
    const week = finishedWeek();
    const existing = new Set(["2026-08-31"]);

    const wrote = await archiveWeekIfMissing(week, existing);

    expect(wrote).toBe(false);
    expect(dbMocks.listArchivedWeeks).not.toHaveBeenCalled();
    expect(dbMocks.archiveWeek).not.toHaveBeenCalled();
  });

  it("upserts instead of duplicating when the pre-read fails but the row already exists", async () => {
    const week = finishedWeek();
    // The row already lives in PB…
    dbMocks.weekArchive.push({
      id: "wa1",
      weekStart: "2026-08-31",
      points: { "Emily G": 1 },
      streak: {},
      history: [],
    });
    // …but a transient read failure makes the fast-path pre-read resolve [].
    dbMocks.listArchivedWeeks.mockResolvedValueOnce([]);

    const wrote = await archiveWeekIfMissing(week);

    expect(wrote).toBe(true);
    expect(dbMocks.archiveWeek).toHaveBeenCalledTimes(1);
    // Exactly one create-or-update for that weekStart — no second row.
    expect(dbMocks.weekArchive.filter((r) => r.weekStart === "2026-08-31")).toHaveLength(1);
    // It updated the existing row with the fresh payload, not a stale copy.
    expect(dbMocks.weekArchive[0].points).toEqual(week.points);
  });

  it("reports false when the archive write silently fails (returns null)", async () => {
    dbMocks.archiveWeek.mockResolvedValue(null);

    await expect(archiveWeekIfMissing(finishedWeek())).resolves.toBe(false);
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

describe("syncArchiveToPB", () => {
  it("keeps exactly one row per weekStart across repeated rollover passes", async () => {
    const archive = {
      "2026-08-24": { ...emptyWeekData("2026-08-24"), points: { "Emily G": 5 } },
      "2026-08-31": finishedWeek(),
    } as any;

    // Production read-failure mode: every pre-read resolves [] (never rejects),
    // so only the DB upsert can prevent duplicates across passes.
    dbMocks.listArchivedWeeks.mockResolvedValue([]);

    await syncArchiveToPB(archive);
    await syncArchiveToPB(archive);

    expect(dbMocks.weekArchive.filter((r) => r.weekStart === "2026-08-24")).toHaveLength(1);
    expect(dbMocks.weekArchive.filter((r) => r.weekStart === "2026-08-31")).toHaveLength(1);
  });
});
