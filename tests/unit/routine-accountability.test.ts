import { describe, it, expect, vi, beforeEach } from "vitest";

const stateStore = new Map<string, { id: string; value: unknown }>();
const mocks = vi.hoisted(() => ({
  weekRows: [] as Array<{ weekStart: string; points: Record<string, number>; history: unknown[] }>,
  members: [
    { id: "p1", name: "Francisco", fullName: "Francisco Garcia", role: "parent", emoji: "👨" },
    { id: "c1", name: "Aurora", fullName: "Aurora Garcia", role: "child", emoji: "🌟" },
  ],
  applyWeekLedgerOperationLocked: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  mutateSnapshotWithMeta: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: (name: string) => {
        if (name === "members") {
          return { getFullList: async () => mocks.members };
        }
        if (name === "week_data") {
          return { getFullList: async () => mocks.weekRows };
        }
        return {
          getFirstListItem: async (filter: string) => {
            const match = /key="([^"]+)"/.exec(filter);
            const key = match ? match[1] : "";
            const found = stateStore.get(key);
            if (!found) throw new Error("not found");
            return found;
          },
          update: async (id: string, payload: { value: unknown }) => {
            for (const [k, rec] of stateStore.entries()) {
              if (rec.id === id) {
                stateStore.set(k, { id, value: payload.value });
                return { id };
              }
            }
            return { id };
          },
          create: async (payload: { key: string; value: unknown }) => {
            const id = `rec-${payload.key}`;
            stateStore.set(payload.key, { id, value: payload.value });
            return { id };
          },
        };
      },
    }),
}));

vi.mock("@/lib/ledger-operations", () => ({
  applyWeekLedgerOperationLocked: mocks.applyWeekLedgerOperationLocked,
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

vi.mock("@/lib/snapshot-tasks", () => ({
  mutateSnapshotWithMeta: mocks.mutateSnapshotWithMeta,
}));

import {
  ensureRoutineAccountability,
  excuseMissedRoutineEntry,
  ROUTINE_ACCOUNTABILITY_KEY,
  ROUTINE_SETTINGS_KEY,
  ROUTINES_STATE_KEY,
} from "@/lib/routine-service";

beforeEach(() => {
  vi.clearAllMocks();
  stateStore.clear();
  process.env.TZ = "America/Detroit";
  mocks.weekRows = [
    {
      weekStart: "2026-11-09",
      points: { "Francisco Garcia": 25, "Aurora Garcia": 3 },
      history: [
        { id: 1, timestamp: "2026-11-10T10:00:00Z", member: "Francisco Garcia", type: "earn", amount: 25, description: "Seed" },
        { id: 2, timestamp: "2026-11-10T10:00:00Z", member: "Aurora Garcia", type: "earn", amount: 3, description: "Seed" },
      ],
    },
  ];
  mocks.ensureCurrentTaskWeek.mockResolvedValue({ weekStart: "2026-11-09" });
  mocks.applyWeekLedgerOperationLocked.mockResolvedValue({
    ok: true,
    applied: true,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: true,
    operationId: "op-1",
    weekData: {
      weekStart: "2026-11-09",
      points: {},
      streak: {},
      lastActive: {},
      history: [],
    },
  });
});

describe("routine accountability & missed penalty sweep", () => {
  it("anchors lastSweptDay to yesterday on very first initialization with zero retroactive penalties", async () => {
    const monday = new Date("2026-11-16T14:00:00Z"); // 09:00 AM Detroit
    const acc = await ensureRoutineAccountability(monday);
    expect(acc.lastSweptDay).toBe("2026-11-15");
    expect(acc.missedEntries).toEqual([]);
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });

  it("detects missed Sunday routine for Dad, resets streak, clamps Aurora deduction, and prevents duplicate sweep", async () => {
    const trashSunday = {
      id: "rt-trash",
      title: "Take out the trash",
      emoji: "🗑️",
      slot: "evening",
      time: "19:30",
      assignee: "Francisco Garcia",
      daysOfWeek: ["sun"],
      points: 20,
      missedPenalty: 10,
      steps: [{ id: "s1", title: "Bins to curb", emoji: "🗑️" }],
    };
    const kidBedtime = {
      id: "rt-bed",
      title: "Bedtime",
      emoji: "🌙",
      slot: "evening",
      time: "20:00",
      assignee: "Aurora Garcia",
      daysOfWeek: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      points: 10,
      missedPenalty: 8,
      steps: [{ id: "e1", title: "Brush teeth", emoji: "🪥" }],
    };
    stateStore.set(ROUTINES_STATE_KEY, { id: "r1", value: [trashSunday, kidBedtime] });
    stateStore.set(ROUTINE_ACCOUNTABILITY_KEY, {
      id: "acc",
      value: {
        lastSweptDay: "2026-11-14", // Saturday already swept; Sunday 2026-11-15 pending check
        missedEntries: [],
        streaks: {
          "francisco garcia": { current: 4, longest: 4, lastCompletedDay: "2026-11-14" },
          "aurora garcia": { current: 2, longest: 5, lastCompletedDay: "2026-11-14" },
        },
      },
    });
    mocks.weekRows = [
      {
        weekStart: "2026-11-16",
        points: { "Francisco Garcia": 25, "Aurora Garcia": 3 },
        history: [
          { id: 1, timestamp: "2026-11-16T08:00:00Z", member: "Francisco Garcia", type: "earn", amount: 25, description: "Seed" },
          { id: 2, timestamp: "2026-11-16T08:00:00Z", member: "Aurora Garcia", type: "earn", amount: 3, description: "Seed" },
        ],
      },
    ];

    const monday = new Date("2026-11-16T14:00:00Z"); // local date 2026-11-16 (Monday)
    const swept = await ensureRoutineAccountability(monday);
    expect(swept.lastSweptDay).toBe("2026-11-15");
    expect(swept.missedEntries).toHaveLength(2);

    const dadMiss = swept.missedEntries.find((e) => e.memberKey === "francisco garcia")!;
    const kidMiss = swept.missedEntries.find((e) => e.memberKey === "aurora garcia")!;

    expect(dadMiss.routineId).toBe("rt-trash");
    expect(dadMiss.deductedPoints).toBe(10);
    expect(kidMiss.routineId).toBe("rt-bed");
    // Clamped to Aurora's 3-point balance so week_data never goes negative
    expect(kidMiss.deductedPoints).toBe(3);
    expect(swept.streaks["francisco garcia"].current).toBe(0);
    expect(swept.streaks["aurora garcia"].current).toBe(0);

    // Repeating sweep on the same day is an idempotent no-op
    mocks.applyWeekLedgerOperationLocked.mockClear();
    const again = await ensureRoutineAccountability(monday);
    expect(again.missedEntries).toHaveLength(2);
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();

    // Parent excuses Dad's missed trash -> refunds 10 pts once
    const excuse = await excuseMissedRoutineEntry({
      entryId: dadMiss.id,
      excusedBy: "Sarah Garcia",
    });
    expect(excuse.ok).toBe(true);
    expect(excuse.entry?.excused).toBe(true);
    expect(excuse.entry?.refundedPoints).toBe(10);
    expect(mocks.applyWeekLedgerOperationLocked).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          source: "routine-penalty-excuse",
          entries: [
            expect.objectContaining({
              type: "adjust",
              member: "Francisco Garcia",
              amount: 10,
            }),
          ],
        }),
      }),
    );
  });

  it("respects parentCountsTowardRace: false by recording missed alert & streak reset without deducting parent race points", async () => {
    stateStore.set(ROUTINES_STATE_KEY, {
      id: "r1",
      value: [
        {
          id: "rt-trash",
          title: "Trash",
          emoji: "🗑️",
          slot: "evening",
          time: "19:30",
          assignee: "Francisco Garcia",
          daysOfWeek: ["sun"],
          points: 20,
          missedPenalty: 10,
          steps: [{ id: "s1", title: "Take out", emoji: "🗑️" }],
        },
      ],
    });
    stateStore.set(ROUTINE_SETTINGS_KEY, {
      id: "s1",
      value: {
        defaultPoints: 15,
        defaultMissedPenalty: 5,
        accountabilityEnabled: true,
        parentCountsTowardRace: false,
        defaultRequiresApproval: false,
        streakBonusEveryDays: 7,
        streakBonusPoints: 10,
      },
    });
    stateStore.set(ROUTINE_ACCOUNTABILITY_KEY, {
      id: "acc",
      value: {
        lastSweptDay: "2026-11-14",
        missedEntries: [],
        streaks: { "francisco garcia": { current: 2, longest: 2 } },
      },
    });

    const swept = await ensureRoutineAccountability(new Date("2026-11-16T14:00:00Z"));
    expect(swept.missedEntries).toHaveLength(1);
    expect(swept.missedEntries[0].deductedPoints).toBe(0);
    expect(swept.missedEntries[0].countedTowardRace).toBe(false);
    expect(swept.streaks["francisco garcia"].current).toBe(0);
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });
});

