import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/db", () => ({
  db: {
    insertProactiveSuggestions: vi.fn(async () => ({ inserted: 0, rejected: 0 })),
  },
}));

import {
  scanPantryLow,
  scanTaskPenaltyStreak,
  scanCalendarConflicts,
} from "@/lib/consuela/engine";
import { weekKey } from "@/lib/task-utils";

/** pb mock whose collection(name).getFullList(args) resolves via table[name](args). */
function makePb(table: Record<string, (args?: any) => any[]>) {
  return {
    collection: (name: string) => ({
      getFullList: async (args?: any) => (table[name] ? table[name](args) : []),
    }),
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("scanPantryLow undefined guards", () => {
  it("falls back to 'Pantry item' when a row lacks item+name — no 'undefined', no double space", async () => {
    const pb = makePb({
      pantry_items: () => [{ id: "p1", status: "low", quantity: 2 }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanPantryLow("2026-09-02");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe("Pantry item is running low");
    expect(suggestions[0].title).not.toContain("undefined");
    expect(suggestions[0].body).toBe("Pantry shows 2 of Pantry item. Add to grocery list?");
    expect(suggestions[0].body).not.toContain("undefined");
    expect(suggestions[0].body).not.toMatch(/\s{2}/);
    expect(suggestions[0].actionPayload).toEqual({
      tool: "add_grocery_item",
      args: { items: "Pantry item" },
    });
  });

  it("uses the fallback for the 'out' variant too", async () => {
    const pb = makePb({
      pantry_items: () => [{ id: "p1", status: "out" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanPantryLow("2026-09-02");

    expect(suggestions[0].title).toBe("Pantry item is out");
  });

  it("renders quantity 0 with no unit as a single-spaced 'shows 0 of'", async () => {
    const pb = makePb({
      pantry_items: () => [{ id: "p1", item: "Milk", status: "low", quantity: 0 }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanPantryLow("2026-09-02");

    expect(suggestions[0].body).toBe("Pantry shows 0 of Milk. Add to grocery list?");
  });
});

describe("scanTaskPenaltyStreak undefined guards", () => {
  it("counts history entries missing member under 'A family member' — no 'undefined'", async () => {
    const now = new Date().toISOString();
    const pb = makePb({
      week_data: () => [
        {
          weekStart: weekKey(),
          history: [
            { type: "penalty", timestamp: now },
            { type: "penalty", timestamp: now },
            { type: "penalty", timestamp: now },
          ],
        },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanTaskPenaltyStreak("2026-09-02");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe("A family member got 3 penalties this week");
    expect(suggestions[0].title).not.toContain("undefined");
  });
});

describe("scanCalendarConflicts undefined guards", () => {
  it("falls back to 'Untitled event' when overlapping events lack titles — no 'undefined'", async () => {
    const pb = makePb({
      events: (args: any) => {
        if (args?.filter?.includes('date="2026-09-02"')) {
          return [
            { id: "e1", date: "2026-09-02", time: "10:00 AM" },
            { id: "e2", date: "2026-09-02", time: "10:15 AM" },
          ];
        }
        return [];
      },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanCalendarConflicts("2026-09-02");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe("Untitled event and Untitled event overlap");
    expect(suggestions[0].body).not.toContain("undefined");
    expect(suggestions[0].body).toContain('"Untitled event"');
  });

  it("uses the fallback in the overnight variant too (late + early events lacking titles)", async () => {
    const pb = makePb({
      events: (args: any) => {
        if (args?.filter?.includes('date="2026-09-02"')) {
          return [{ id: "e1", date: "2026-09-02", time: "12:10 AM" }];
        }
        return [{ id: "e9", date: "2026-09-01", time: "11:50 PM" }];
      },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanCalendarConflicts("2026-09-02");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe("Untitled event and Untitled event overlap");
    expect(suggestions[0].body).not.toContain("undefined");
  });

  it("does not crash on an event with no time (skipped instead of throwing)", async () => {
    const pb = makePb({
      events: (args: any) => {
        if (args?.filter?.includes('date="2026-09-02"')) {
          return [
            { id: "e1", title: "Soccer", date: "2026-09-02", time: "4:00 PM" },
            { id: "e2", title: "Dentist", date: "2026-09-02" },
          ];
        }
        return [];
      },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const suggestions = await scanCalendarConflicts("2026-09-02");

    // The time-less event is unparseable -> filtered out, no conflict, no throw.
    expect(suggestions).toHaveLength(0);
  });
});
