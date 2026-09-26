import { describe, it, expect } from "vitest";

import {
  buildAllTimeTotals,
  type ArchiveWeekRow,
} from "@/lib/all-time-totals";
import type { WeekData } from "@/types/tasks";

function currentWeek(history: unknown, points: Record<string, number>): WeekData {
  return {
    weekStart: "2026-09-21",
    points,
    streak: {},
    lastActive: {},
    history,
  } as unknown as WeekData;
}

describe("all-time totals — canonical history", () => {
  it("recomputes balances from canonical history instead of trusting points", () => {
    const payload = buildAllTimeTotals(
      {
        weekStart: "2026-09-21",
        points: { "Member A": 999 },
        streak: {},
        lastActive: {},
        history: [
          { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
          { id: 2, timestamp: "2026-09-21T11:00:00.000Z", member: "Member A", type: "redeem", amount: -2, description: "Reward" },
        ],
        meta: undefined,
      } as WeekData,
      [{
        weekStart: "2026-09-14",
        points: { "Member A": 777 },
        history: [
          { id: 3, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
        ],
      }],
    );
    expect(payload.totals["Member A"].points).toBe(43);
    expect(payload.totals["Member A"].completions).toBe(2);
    expect(payload.historyComplete).toBe(true);
  });

  it("uses an honest unknown fallback when any canonical history is missing", () => {
    const payload = buildAllTimeTotals(null, [{
      weekStart: "2026-09-14",
      points: { "Member A": 40 },
    }]);
    expect(payload.historyComplete).toBe(false);
    expect(payload.totals["Member A"].points).toBeNull();
    expect(payload.totals["Member A"].completions).toBeNull();
  });

  it("carries the payload contract (pocketbase source + ISO fetchedAt)", () => {
    const payload = buildAllTimeTotals(null, []);
    expect(payload.source).toBe("pocketbase");
    expect(payload.weekStart).toBe("");
    expect(payload.totals).toEqual({});
    expect(Number.isFinite(Date.parse(payload.fetchedAt))).toBe(true);
  });
});

describe("all-time totals — honest unknown is total, never per-week", () => {
  it("nulls EVERY member when one archive week is unreadable, never the stored points map", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [
          { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
          { id: 2, timestamp: "2026-09-21T10:05:00.000Z", member: "Member B", type: "earn", amount: 7, description: "Task" },
        ],
        { "Member A": 999, "Member B": 999 },
      ),
      [
        {
          weekStart: "2026-09-07",
          points: { "Member A": 500, "Member B": 500 },
          history: [
            { id: 3, timestamp: "2026-09-07T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
          ],
        },
        { weekStart: "2026-09-14", points: { "Member A": 40, "Member B": 40 } },
      ],
    );

    expect(payload.historyComplete).toBe(false);
    expect(Object.keys(payload.totals).sort()).toEqual(["Member A", "Member B"]);
    expect(payload.totals["Member A"]).toEqual({ points: null, completions: null });
    expect(payload.totals["Member B"]).toEqual({ points: null, completions: null });
  });

  it("treats an unparseable history string as unknown, never as an empty week", () => {
    const payload = buildAllTimeTotals(
      currentWeek([], { "Member A": 1 }),
      [
        { weekStart: "2026-09-14", history: "{not json" },
        { weekStart: "2026-09-07", history: { nope: true } },
        { weekStart: "2026-08-31", history: [{}] },
      ],
    );
    expect(payload.historyComplete).toBe(false);
    expect(payload.totals["Member A"]).toEqual({ points: null, completions: null });
  });

  it("reports an honest unknown when one transaction id carries conflicting content", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [{ id: 9, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" }],
        { "Member A": 999 },
      ),
      [{
        weekStart: "2026-09-14",
        history: [
          { id: 9, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 5000, description: "Different" },
        ],
      }],
    );
    expect(payload.historyComplete).toBe(false);
    expect(payload.totals["Member A"].points).toBeNull();
  });

  it("reports an honest unknown for an archive row with no usable weekStart", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [{ id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" }],
        { "Member A": 999 },
      ),
      [{ weekStart: "", history: [] } as unknown as ArchiveWeekRow],
    );
    expect(payload.historyComplete).toBe(false);
    expect(payload.totals["Member A"].points).toBeNull();
  });
});

describe("all-time totals — no double counting", () => {
  it("keeps the freshest archive row per weekStart and drops the stale duplicate", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [{ id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" }],
        { "Member A": 999 },
      ),
      [
        {
          weekStart: "2026-09-14",
          archivedAt: "2026-09-15T06:00:00.000Z",
          history: [
            { id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 1000, description: "Stale" },
          ],
        },
        {
          weekStart: "2026-09-14",
          archivedAt: "2026-09-15T06:00:00.000Z",
          history: [
            { id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 1000, description: "Stale" },
          ],
        },
        {
          weekStart: "2026-09-14",
          archivedAt: "2026-09-21T06:00:00.000Z",
          history: [
            { id: 3, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
          ],
        },
      ],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"].points).toBe(45);
    expect(payload.totals["Member A"].completions).toBe(2);
  });

  it("counts a repeated transaction id across weeks exactly once", () => {
    const shared = { id: 7, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" };
    const payload = buildAllTimeTotals(
      currentWeek(
        [
          { ...shared, id: 8, timestamp: "2026-09-21T10:00:00.000Z", amount: 5 },
        ],
        { "Member A": 999 },
      ),
      [
        { weekStart: "2026-09-07", history: [shared] },
        { weekStart: "2026-09-14", history: [shared] },
      ],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"].points).toBe(45);
    expect(payload.totals["Member A"].completions).toBe(2);
  });

  it("excludes the current week archive row so this week is never counted twice", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [{ id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" }],
        { "Member A": 999 },
      ),
      [
        {
          weekStart: "2026-09-21",
          history: [
            { id: 50, timestamp: "2026-09-21T12:00:00.000Z", member: "Member A", type: "earn", amount: 777, description: "Rolled copy" },
          ],
        },
        {
          weekStart: "2026-09-14",
          history: [
            { id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
          ],
        },
      ],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"].points).toBe(45);
    expect(payload.totals["Member A"].completions).toBe(2);
  });
});

describe("all-time totals — history shape and completion counting", () => {
  it("parses history stored as a JSON string", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        JSON.stringify([
          { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
        ]),
        { "Member A": 999 },
      ),
      [{
        weekStart: "2026-09-14",
        history: JSON.stringify([
          { id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
        ]),
      }],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"].points).toBe(45);
  });

  it("counts completions from earn transactions only", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [
          { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
          { id: 2, timestamp: "2026-09-21T11:00:00.000Z", member: "Member A", type: "redeem", amount: -2, description: "Reward" },
          { id: 3, timestamp: "2026-09-21T12:00:00.000Z", member: "Member A", type: "penalty", amount: -1, description: "Late" },
          { id: 4, timestamp: "2026-09-21T13:00:00.000Z", member: "Member A", type: "adjust", amount: 3, description: "Bonus" },
        ],
        { "Member A": 999 },
      ),
      [],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"].points).toBe(5);
    expect(payload.totals["Member A"].completions).toBe(1);
  });

  it("never reads the stored points map as authority, even for a readable week", () => {
    const payload = buildAllTimeTotals(
      currentWeek([], { "Member A": 999, "Member B": 999 }),
      [{ weekStart: "2026-09-14", points: { "Member A": 777, "Member B": 777 }, history: [] }],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"]).toEqual({ points: 0, completions: 0 });
    expect(payload.totals["Member B"]).toEqual({ points: 0, completions: 0 });
  });

  it("keeps members only present in the stored points map in the payload", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [{ id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" }],
        { "Member A": 0, "Member C": 12 },
      ),
      [],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"]).toEqual({ points: 5, completions: 1 });
    expect(payload.totals["Member C"]).toEqual({ points: 0, completions: 0 });
  });

  it("adds per-member balances across the whole history", () => {
    const payload = buildAllTimeTotals(
      currentWeek(
        [
          { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
          { id: 2, timestamp: "2026-09-21T10:10:00.000Z", member: "Member B", type: "earn", amount: 3, description: "Task" },
        ],
        { "Member A": 0, "Member B": 0 },
      ),
      [{
        weekStart: "2026-09-14",
        history: [
          { id: 3, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
          { id: 4, timestamp: "2026-09-14T10:20:00.000Z", member: "Member B", type: "redeem", amount: -8, description: "Reward" },
        ],
      }],
    );
    expect(payload.totals["Member A"]).toEqual({ points: 45, completions: 2 });
    expect(payload.totals["Member B"]).toEqual({ points: -5, completions: 1 });
  });
});

describe("all-time totals — the roster decides who is on the board", () => {
  const HISTORY = [
    { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
  ];

  it("a roster member with no history at all is emitted as a real zero", () => {
    const payload = buildAllTimeTotals(currentWeek(HISTORY, {}), [], ["Member A", "Brand New"]);
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Member A"]).toEqual({ points: 5, completions: 1 });
    expect(payload.totals["Brand New"]).toEqual({ points: 0, completions: 0 });
  });

  it("an incomplete history still nulls a roster member who never earned", () => {
    const payload = buildAllTimeTotals(currentWeek(HISTORY, {}), [
      { weekStart: "2026-09-14", history: "not-json" },
    ], ["Member A", "Brand New"]);
    expect(payload.historyComplete).toBe(false);
    expect(payload.totals["Member A"]).toEqual({ points: null, completions: null });
    expect(payload.totals["Brand New"]).toEqual({ points: null, completions: null });
  });

  it("blank roster names are ignored and no roster argument changes existing behavior", () => {
    const withRoster = buildAllTimeTotals(currentWeek(HISTORY, {}), [], ["  ", ""]);
    const without = buildAllTimeTotals(currentWeek(HISTORY, {}), []);
    expect(withRoster.totals).toEqual(without.totals);
    expect(Object.keys(withRoster.totals)).toEqual(["Member A"]);
  });

  it("a roster name that already has history keeps the recomputed balance", () => {
    const payload = buildAllTimeTotals(currentWeek(HISTORY, {}), [], ["Member A"]);
    expect(payload.totals["Member A"]).toEqual({ points: 5, completions: 1 });
  });
});
