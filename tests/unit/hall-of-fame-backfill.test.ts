// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { hallEntriesForWeek, ensureArchivedWeeksEnshrined } from "@/lib/hall-of-fame-backfill";
import { GET as syncGET } from "@/app/api/tasks/sync/route";
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
}) {
  const archive = opts?.archive ?? [];
  const hall = opts?.hall ?? [];
  const members = opts?.members ?? [{ name: "Aurora", emoji: "🌈" }];
  const prizes = opts?.prizes ?? [];
  const creates: any[] = [];
  const pb = {
    collection: (name: string) => ({
      getFullList: async (params?: any) => {
        if (name === "week_archive") return archive;
        if (name === "hall_of_fame") return hall;
        if (name === "members") return members;
        if (name === "weekly_prizes") return prizes;
        return [];
      },
      create: async (payload: any) => {
        creates.push(payload);
        return payload;
      },
    }),
  };
  return { pb, creates, hall };
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

  it("is idempotent — already-enshrined weeks create nothing", async () => {
    const { pb, creates } = makePb({
      archive: [{ weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13 }) }],
      hall: [{ member: "Aurora", weekStart: "2026-09-07", points: 13, rank: 1, celebrated: true }],
      prizes: [],
    });
    const written = await ensureArchivedWeeksEnshrined(pb as any);
    expect(written).toBe(0);
    expect(creates).toHaveLength(0);
  });

  it("GET /api/tasks/sync runs the enshrinement before answering", async () => {
    const creates: any[] = [];
    const archive = [{ weekStart: "2026-09-07", points: JSON.stringify({ Aurora: 13 }) }];
    const hall: any[] = [];
    const pb = {
      collection: (name: string) => ({
        getFullList: async () => {
          if (name === "consuela_data_snapshots") {
            return [{ data: JSON.stringify({ tasks: [], weekData: { weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [] } }) }];
          }
          if (name === "week_archive") return archive;
          if (name === "hall_of_fame") return hall;
          if (name === "members") return [{ name: "Aurora", emoji: "🌈" }];
          if (name === "weekly_prizes") return [{ id: "p1", rank: 1, emoji: "🥇", text: "Picks Friday's family movie" }];
          return [];
        },
        create: async (payload: any) => { creates.push(payload); return payload; },
      }),
    };
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await syncGET();
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.snapshot).toBeTruthy();
    // The champion was enshrined as a side effect of the 60s sync read.
    expect(creates.some((c: any) => c.member === "Aurora" && c.rank === 1)).toBe(true);
  });
});
