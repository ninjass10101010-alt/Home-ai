// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { hallEntriesForWeek, ensureArchivedWeeksEnshrined } from "@/lib/hall-of-fame-backfill";
import { DEFAULT_WEEKLY_PRIZES } from "@/lib/task-utils";

// ─── Pure: entry computation ──────────────────────────────────────────────────

describe("hallEntriesForWeek", () => {
  const emojis = { Aurora: "🌈", Bailey: "👧", Emily: "👧", Jasmine: "👧", Caspian: "🧒" };

  it("competition-ranks ties (last week's real shape: Aurora 13, three kids at 10)", () => {
    const entries = hallEntriesForWeek(
      { Aurora: 13, Bailey: 10, Emily: 10, Jasmine: 10 },
      "2026-09-07",
      emojis,
      DEFAULT_WEEKLY_PRIZES,
    );
    expect(entries.map((e) => [e.member, e.rank])).toEqual([
      ["Aurora", 1],
      ["Bailey", 2],
      ["Emily", 2],
      ["Jasmine", 2],
    ]);
  });

  it("skips zero-point members and caps at rank 3", () => {
    const entries = hallEntriesForWeek(
      { Aurora: 13, Bailey: 10, Emily: 10, Jasmine: 10, Caspian: 7, Nobody: 0 },
      "2026-09-07",
      emojis,
      DEFAULT_WEEKLY_PRIZES,
    );
    expect(entries.some((e) => e.member === "Nobody")).toBe(false);
    expect(entries.every((e) => e.rank <= 3)).toBe(true);
    expect(entries.some((e) => e.member === "Caspian")).toBe(false); // rank 5
  });

  it("freezes the prize text per rank and falls back emoji", () => {
    const entries = hallEntriesForWeek({ Aurora: 20 }, "2026-09-07", {}, DEFAULT_WEEKLY_PRIZES);
    expect(entries[0].prize).toBe("Picks Friday's family movie");
    expect(entries[0].emoji).toBe("🏅");
  });

  it("no prizes configured → no prize field, entries still recorded", () => {
    const entries = hallEntriesForWeek({ Aurora: 20 }, "2026-09-07", emojis, []);
    expect(entries[0].prize).toBeUndefined();
    expect(entries[0].rank).toBe(1);
  });

  it("empty/zero weeks produce no entries", () => {
    expect(hallEntriesForWeek({}, "2026-09-07", emojis, DEFAULT_WEEKLY_PRIZES)).toEqual([]);
    expect(hallEntriesForWeek({ A: 0 }, "2026-09-07", emojis, DEFAULT_WEEKLY_PRIZES)).toEqual([]);
  });
});

// ─── Impure: PB enshrinement ─────────────────────────────────────────────────

function makePb(opts?: {
  archive?: Record<string, any>[];
  hall?: Record<string, any>[];
  members?: Record<string, any>[];
  prizes?: Record<string, any>[];
  preserveMissingHistory?: boolean;
}) {
  const archive = (opts?.archive ?? []).map((row) => {
    if (row.history !== undefined || opts?.preserveMissingHistory) return row;
    const rawPoints = typeof row.points === "string" ? JSON.parse(row.points) : row.points ?? {};
    const history = Object.entries(rawPoints as Record<string, number>).map(([member, amount], index) => ({
      id: index + 1,
      timestamp: `2026-09-07T10:00:0${index}.000Z`,
      member,
      type: "earn",
      amount,
      description: "Fixture",
    }));
    return { ...row, history };
  });
  const hall = opts?.hall ?? [];
  const members = opts?.members ?? [{ name: "Aurora", emoji: "🌈" }];
  const prizes = opts?.prizes ?? [];
  const creates: any[] = [];
  const updates: any[] = [];
  const deletes: string[] = [];
  const reads: Record<string, number> = {};
  let sequence = 0;
  const pb = {
    collection: (name: string) => ({
      getFullList: async (params?: any) => {
        reads[name] = (reads[name] ?? 0) + 1;
        if (name === "week_archive") return archive;
        if (name === "hall_of_fame") return hall;
        if (name === "members") return members;
        if (name === "weekly_prizes") return prizes;
        return [];
      },
      create: async (payload: any) => {
        const row = { id: `hall-${++sequence}`, ...payload };
        if (name === "hall_of_fame") hall.push(row);
        creates.push(payload);
        return row;
      },
      update: async (id: string, payload: any) => {
        const index = hall.findIndex((row) => row.id === id);
        if (index >= 0) hall[index] = { ...hall[index], ...payload };
        updates.push({ id, payload });
        return hall[index] ?? payload;
      },
      delete: async (id: string) => {
        const index = hall.findIndex((row) => row.id === id);
        if (index >= 0) hall.splice(index, 1);
        deletes.push(id);
        return true;
      },
    }),
  };
  return { pb, creates, updates, deletes, reads, hall };
}

describe("ensureArchivedWeeksEnshrined", () => {
  beforeEach(() => { mocks.withAdmin.mockReset(); });

  it("enshrines every archived week with points, with prize text + emoji", async () => {
    const { pb, creates } = makePb({
      archive: [
        { weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13, Bailey: 10, Emily: 10, Jasmine: 10 }) },
        { weekStart: "2026-08-31", points: JSON.stringify({}) },
      ],
      prizes: DEFAULT_WEEKLY_PRIZES.map((p) => ({ ...p })),
    });
    const written = await ensureArchivedWeeksEnshrined(pb as any);
    expect(written).toBe(4);
    const aurora = creates.find((c) => c.member === "Aurora");
    expect(aurora).toMatchObject({ weekStart: "2026-09-07", points: 13, rank: 1, prize: "Picks Friday's family movie", emoji: "🌈" });
    expect(creates.filter((c) => c.rank === 2)).toHaveLength(3);
    // The zero-point week produced nothing.
    expect(creates.every((c) => c.weekStart === "2026-09-07")).toBe(true);
  });

  it("creates OLDER weeks pre-celebrated (no stale ceremonies); the newest week stays uncelebrated", async () => {
    const { pb, creates } = makePb({
      archive: [
        { weekStart: "2026-06-15", points: JSON.stringify({ Emily: 65 }) },
        { weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13 }) },
      ],
      prizes: [{ id: "p1", rank: 1, emoji: "🥇", text: "Picks Friday's family movie" }],
    });
    await ensureArchivedWeeksEnshrined(pb as any);
    const old = creates.find((c) => c.weekStart === "2026-06-15");
    const latest = creates.find((c) => c.weekStart === "2026-09-07");
    expect(old.celebrated).toBe(true);
    expect(latest.celebrated).toBeUndefined();
  });

  it("repairs stale existing fields without trusting stale celebration state", async () => {
    const { pb, creates, updates, hall } = makePb({
      archive: [{ weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13 }) }],
      hall: [{ id: "hall-1", member: "Aurora", emoji: "stale", weekStart: "2026-09-07", points: 1, rank: 3, prize: "stale", celebrated: true }],
      prizes: [{ id: "p1", rank: 1, text: "Movie night" }],
    });

    const written = await ensureArchivedWeeksEnshrined(pb as any);

    expect(written).toBe(1);
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      member: "Aurora",
      emoji: "🌈",
      weekStart: "2026-09-07",
      points: 13,
      rank: 1,
      prize: "Movie night",
       celebrated: false,

    });
    expect(hall[0]).toMatchObject({ points: 13, rank: 1, prize: "Movie night" });
  });

  it("retains celebration only from a valid same-key hall row", async () => {
    const { pb, hall } = makePb({
      archive: [{
        weekStart: "2026-09-07",
        history: [
          { id: 1, timestamp: "2026-09-07T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "Done" },
        ],
      }],
      hall: [
        { id: "hall-stale", member: "Aurora", emoji: "🌈", weekStart: "2026-09-07", points: 999, rank: 1, prize: "Movie night", celebrated: true },
        { id: "hall-valid", member: "Aurora", emoji: "🌈", weekStart: "2026-09-07", points: 5, rank: 1, prize: "Movie night", celebrated: true },
      ],
      prizes: [{ id: "p1", rank: 1, text: "Movie night" }],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(hall).toHaveLength(1);
    expect(hall[0]).toMatchObject({ id: "hall-stale", points: 5, celebrated: true });
  });

  it("skips non-Monday archive week starts without aborting valid weeks", async () => {
    const { pb, creates } = makePb({
      archive: [
        {
          weekStart: "2026-09-08",
          history: [{ id: 1, timestamp: "2026-09-08T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "Done" }],
        },
        {
          weekStart: "2026-09-14",
          history: [{ id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Aurora", type: "earn", amount: 7, description: "Done" }],
        },
      ],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ weekStart: "2026-09-14", points: 7 });
  });

  it("quarantines conflicting duplicate archive weeks deterministically", async () => {
    const { pb, creates } = makePb({
      archive: [
        {
          weekStart: "2026-09-07",
          history: [{ id: 1, timestamp: "2026-09-07T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "One" }],
        },
        {
          weekStart: "2026-09-07",
          history: [{ id: 2, timestamp: "2026-09-07T11:00:00.000Z", member: "Aurora", type: "earn", amount: 6, description: "Two" }],
        },
        {
          weekStart: "2026-09-14",
          history: [{ id: 3, timestamp: "2026-09-14T10:00:00.000Z", member: "Aurora", type: "earn", amount: 7, description: "Three" }],
        },
      ],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ weekStart: "2026-09-14", points: 7 });
  });

  it("recomputes archive balances from canonical history before enshrining", async () => {
    const { pb, creates } = makePb({
      archive: [{
        weekStart: "2026-09-07",
        points: { Aurora: 999 },
        history: [
          { id: 1, timestamp: "2026-09-07T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "Done" },
        ],
      }],
      prizes: [],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(creates[0]).toMatchObject({ member: "Aurora", points: 5 });
  });

  it("skips a stale-points archive with no canonical history", async () => {
    const { pb, creates } = makePb({
      archive: [{ weekStart: "2026-09-07", points: { Aurora: 999 } }],
      prizes: [],
      preserveMissingHistory: true,
    });

    await ensureArchivedWeeksEnshrined(pb as any);
    expect(creates).toHaveLength(0);
  });

  it("removes hall rows absent from canonical expected entries", async () => {
    const { pb, hall } = makePb({
      archive: [{
        weekStart: "2026-09-07",
        points: {},
        history: [
          { id: 1, timestamp: "2026-09-07T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "Done" },
        ],
      }],
      hall: [
        { id: "hall-stale", member: "Stale", emoji: "🧒", weekStart: "2026-09-07", points: 5, rank: 1 },
      ],
      prizes: [],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(hall.some((row) => row.member === "Stale")).toBe(false);
  });

  it("never deletes hall rows for a week whose archive history is unreadable", async () => {
    const { pb, creates, deletes, hall } = makePb({
      archive: [
        { weekStart: "2026-09-07", history: "not-a-transaction-list" },
        {
          weekStart: "2026-09-14",
          history: [{ id: 3, timestamp: "2026-09-14T10:00:00.000Z", member: "Aurora", type: "earn", amount: 7, description: "Done" }],
        },
      ],
      hall: [
        { id: "hall-keep", member: "Aurora", emoji: "🌈", weekStart: "2026-09-07", points: 5, rank: 1, celebrated: true },
      ],
      prizes: [],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(deletes).not.toContain("hall-keep");
    expect(hall.some((row) => row.id === "hall-keep")).toBe(true);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ weekStart: "2026-09-14", points: 7 });
  });

  it("never deletes hall rows for a week whose archive week start is invalid", async () => {
    const { pb, deletes, hall } = makePb({
      archive: [
        { weekStart: "2026-09-08", history: [{ id: 1, timestamp: "2026-09-08T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "Done" }] },
        {
          weekStart: "2026-09-14",
          history: [{ id: 3, timestamp: "2026-09-14T10:00:00.000Z", member: "Aurora", type: "earn", amount: 7, description: "Done" }],
        },
      ],
      hall: [
        { id: "hall-week-keep", member: "Aurora", emoji: "🌈", weekStart: "2026-09-08", points: 5, rank: 1, celebrated: true },
      ],
      prizes: [],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(deletes).not.toContain("hall-week-keep");
    expect(hall.some((row) => row.id === "hall-week-keep")).toBe(true);
  });

  it("never deletes a hall row whose week has no archive row at all", async () => {
    const { pb, deletes, hall, creates } = makePb({
      archive: [{
        weekStart: "2026-09-14",
        history: [{ id: 4, timestamp: "2026-09-14T10:00:00.000Z", member: "Aurora", type: "earn", amount: 7, description: "Done" }],
      }],
      hall: [
        { id: "hall-orphan", member: "Bailey", emoji: "👧", weekStart: "2026-07-06", points: 9, rank: 1, celebrated: true },
      ],
      prizes: [],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(deletes).not.toContain("hall-orphan");
    expect(hall.some((row) => row.id === "hall-orphan")).toBe(true);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ weekStart: "2026-09-14" });
  });

  it("keeps celebration from a valid duplicate core when the primary row is stale", async () => {
    const { pb, hall } = makePb({
      archive: [{
        weekStart: "2026-09-07",
        history: [{ id: 1, timestamp: "2026-09-07T10:00:00.000Z", member: "Aurora", type: "earn", amount: 5, description: "Done" }],
      }],
      hall: [
        { id: "hall-a", member: "Aurora", emoji: "🌈", weekStart: "2026-09-07", points: 999, rank: 3, prize: "stale", celebrated: false },
        { id: "hall-b", member: "Aurora", emoji: "🌈", weekStart: "2026-09-07", points: 5, rank: 1, prize: "Movie night", celebrated: true },
      ],
      prizes: [{ id: "p1", rank: 1, text: "Movie night" }],
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(hall).toHaveLength(1);
    expect(hall[0]).toMatchObject({ id: "hall-a", points: 5, rank: 1, prize: "Movie night", celebrated: true });
  });

  it("preloads the hall collection once instead of re-reading it per entry", async () => {
    const { pb, creates, reads } = makePb({
      archive: [{ weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13, Bailey: 10, Emily: 10 }) }],
      prizes: DEFAULT_WEEKLY_PRIZES.map((p) => ({ ...p })),
    });

    await ensureArchivedWeeksEnshrined(pb as any);

    expect(creates).toHaveLength(3);
    expect(reads.hall_of_fame).toBeLessThanOrEqual(3);
  });

  it("is idempotent — already-enshrined weeks create nothing", async () => {
    const { pb, creates } = makePb({
      archive: [{ weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13 }) }],
      hall: [{ member: "Aurora", emoji: "🌈", weekStart: "2026-09-07", points: 13, rank: 1, prize: DEFAULT_WEEKLY_PRIZES[0].text, celebrated: true }],
      prizes: [],
    });
    const written = await ensureArchivedWeeksEnshrined(pb as any);
    expect(written).toBe(0);
    expect(creates).toHaveLength(0);
  });

});
