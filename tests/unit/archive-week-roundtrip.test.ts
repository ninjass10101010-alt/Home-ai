// F8b user-visible payoff: after the rollover writes a finished week into
// week_archive, the assistant's get_past_weeks (which reads week_archive live)
// returns that week. Both the db layer (the rollover write) and the PB layer
// (the live read) share one in-memory week_archive so the round trip is real.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Record<string, any[]> = { week_archive: [], members: [] };

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) =>
    fn({
      collection: (name: string) => ({
        getFullList: async () => rows[name] ?? [],
        getFirstListItem: async () => {
          throw new Error("404");
        },
        update: async (id: string, d: any) => ({ id, ...d }),
        create: async (d: any) => {
          const rec = { id: `wa_${(rows[name] ||= []).length}`, ...d };
          rows[name].push(rec);
          return rec;
        },
        delete: async () => true,
      }),
    })
  ),
}));

vi.mock("@/db", () => ({
  db: {
    listArchivedWeeks: async () => rows.week_archive,
    archiveWeek: async (data: any) => {
      const rec = { id: `wa_${rows.week_archive.length}`, ...data };
      rows.week_archive.push(rec);
      return rec;
    },
  },
}));

import { archiveWeekIfMissing } from "@/lib/task-utils";
import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  rows.week_archive.length = 0;
  rows.members = [];
});

describe("rollover → get_past_weeks", () => {
  it("returns the archived week (champion + top3) after the rollover writes it", async () => {
    await archiveWeekIfMissing({
      weekStart: "2026-08-31",
      points: { "Emily G": 42, "Caspian G": 7 },
      streak: { "Emily G": 3 },
      lastActive: {},
      history: [
        { id: 1, timestamp: "2026-09-01T12:00:00.000Z", member: "Emily G", type: "earn", amount: 5, description: "Dishes" },
      ],
    } as any);

    expect(rows.week_archive).toHaveLength(1);

    const out = JSON.parse(await getTool("get_past_weeks")!.handler({}));
    expect(out.weeks).toHaveLength(1);
    expect(out.weeks[0].weekStart).toBe("2026-08-31");
    expect(out.weeks[0].champion).toBe("Emily G");
    expect(out.weeks[0].champion_points).toBe(42);
    expect(out.weeks[0].top3.map((t: any) => t.name)).toEqual(["Emily G", "Caspian G"]);
  });

  it("does not duplicate the week when the rollover runs twice", async () => {
    const week = {
      weekStart: "2026-08-31",
      points: { "Emily G": 42 },
      streak: {},
      lastActive: {},
      history: [],
    } as any;

    await archiveWeekIfMissing(week);
    await archiveWeekIfMissing({ ...week, points: { "Emily G": 99 } });

    expect(rows.week_archive).toHaveLength(1);
    const out = JSON.parse(await getTool("get_past_weeks")!.handler({}));
    expect(out.weeks).toHaveLength(1);
    expect(out.weeks[0].champion_points).toBe(42);
  });
});
