import { describe, it, expect } from "vitest";
import {
  effectiveDaysOfWeek,
  formatRoutineDaysLabel,
  getMemberCheckedSteps,
  getMemberCompletionMeta,
  isRoutineScheduledForDate,
  resolveRoutineTargets,
  routineAppliesToMember,
  sanitizeDailyRoutineProgress,
  sanitizeRoutine,
  sanitizeRoutineSettings,
  weekdayCodeForDateISO,
  type RoutineRosterMember,
} from "@/lib/routine-rules";
import { DEFAULT_ROUTINE_SETTINGS, type FamilyRoutine } from "@/types/routines";

const SAMPLE_ROSTER: RoutineRosterMember[] = [
  { id: "m1", name: "Francisco", fullName: "Francisco Garcia", role: "parent", emoji: "👨" },
  { id: "m2", name: "Sarah", fullName: "Sarah Garcia", role: "parent", emoji: "👩" },
  { id: "m3", name: "Aurora", fullName: "Aurora Garcia", role: "child", emoji: "🌟" },
  { id: "m4", name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🦊" },
  { id: "m5", name: "Biscuit", fullName: "Biscuit", role: "pet", emoji: "🐶" },
];

describe("routine-rules scheduling & targets", () => {
  it("computes weekday code reliably across dates (Sunday trash check)", () => {
    expect(weekdayCodeForDateISO("2026-11-15")).toBe("sun");
    expect(weekdayCodeForDateISO("2026-11-16")).toBe("mon");
    expect(weekdayCodeForDateISO("2026-11-14")).toBe("sat");
  });

  it("matches single-day Sunday routine only on Sundays", () => {
    const trashRoutine: FamilyRoutine = {
      id: "rt-trash",
      title: "Take out the trash",
      emoji: "🗑️",
      slot: "evening",
      time: "19:30",
      assignee: "Francisco Garcia",
      daysOfWeek: ["sun"],
      points: 20,
      steps: [{ id: "s1", title: "Roll bins to curb", emoji: "🗑️" }],
    };

    expect(isRoutineScheduledForDate(trashRoutine, "2026-11-15")).toBe(true); // Sun
    expect(isRoutineScheduledForDate(trashRoutine, "2026-11-16")).toBe(false); // Mon
    expect(formatRoutineDaysLabel(trashRoutine.daysOfWeek, trashRoutine.slot)).toBe("Every Sun");
  });

  it("defaults weekend slot without daysOfWeek to sat+sun and active=false disables routine", () => {
    const rt: FamilyRoutine = {
      id: "rt-wk",
      title: "Weekend clean",
      emoji: "🧹",
      slot: "weekend",
      time: "10:00",
      assignee: "All",
      points: 15,
      steps: [],
    };
    expect(effectiveDaysOfWeek(rt)).toEqual(["sat", "sun"]);
    expect(isRoutineScheduledForDate(rt, "2026-11-14")).toBe(true);
    expect(isRoutineScheduledForDate(rt, "2026-11-13")).toBe(false);
    expect(isRoutineScheduledForDate({ ...rt, active: false }, "2026-11-14")).toBe(false);
  });

  it("expands All, Kids, Adults, and individual/first names while excluding pets from groups", () => {
    expect(resolveRoutineTargets({ assignee: "All" }, SAMPLE_ROSTER).map((m) => m.name)).toEqual([
      "Francisco Garcia",
      "Sarah Garcia",
      "Aurora Garcia",
      "Caspian Garcia",
    ]);
    expect(resolveRoutineTargets({ assignee: "Kids" }, SAMPLE_ROSTER).map((m) => m.name)).toEqual([
      "Aurora Garcia",
      "Caspian Garcia",
    ]);
    expect(resolveRoutineTargets({ assignee: "Adults" }, SAMPLE_ROSTER).map((m) => m.name)).toEqual([
      "Francisco Garcia",
      "Sarah Garcia",
    ]);
    expect(
      routineAppliesToMember(
        { assignee: "Francisco" },
        SAMPLE_ROSTER[0],
        SAMPLE_ROSTER,
      ),
    ).toBe(true);
    expect(
      routineAppliesToMember(
        { assignee: "Francisco" },
        SAMPLE_ROSTER[2],
        SAMPLE_ROSTER,
      ),
    ).toBe(false);
  });

  it("isolates per-member step progress on shared routines while supporting legacy single-target fallback", () => {
    const prog = sanitizeDailyRoutineProgress({
      checkedSteps: { "rt-solo": ["s1"] },
      completedRoutines: { "rt-solo": true },
      memberCheckedSteps: {
        "rt-kids::aurora garcia": ["m1", "m2"],
        "rt-kids::caspian garcia": ["m1"],
      },
      memberCompleted: {
        "rt-kids::aurora garcia": {
          status: "completed",
          at: "2026-11-11T12:00:00Z",
          by: "Aurora Garcia",
          pointsAwarded: 15,
          countedTowardRace: true,
        },
      },
    });

    expect(getMemberCheckedSteps(prog, "rt-kids", "Aurora Garcia", false)).toEqual(["m1", "m2"]);
    expect(getMemberCheckedSteps(prog, "rt-kids", "Caspian Garcia", false)).toEqual(["m1"]);
    expect(getMemberCompletionMeta(prog, "rt-kids", "Aurora Garcia", false)?.pointsAwarded).toBe(15);
    expect(getMemberCompletionMeta(prog, "rt-kids", "Caspian Garcia", false)).toBeNull();
    // Legacy single-assignee fallback when member map is absent
    expect(getMemberCheckedSteps(prog, "rt-solo", "Dad", true)).toEqual(["s1"]);
    expect(getMemberCompletionMeta(prog, "rt-solo", "Dad", true)?.status).toBe("completed");
  });

  it("sanitizes custom non-preset points and global settings safely", () => {
    const settings = sanitizeRoutineSettings({
      defaultPoints: 25,
      defaultMissedPenalty: 8,
      accountabilityEnabled: false,
      parentCountsTowardRace: false,
      defaultRequiresApproval: true,
      streakBonusEveryDays: 5,
      streakBonusPoints: 12,
    });
    expect(settings).toEqual({
      defaultPoints: 25,
      defaultMissedPenalty: 8,
      accountabilityEnabled: false,
      parentCountsTowardRace: false,
      defaultRequiresApproval: true,
      streakBonusEveryDays: 5,
      streakBonusPoints: 12,
    });

    const rt = sanitizeRoutine(
      {
        id: "rt-custom",
        title: "Trash Sunday",
        points: 37,
        missedPenalty: 12,
        daysOfWeek: ["sun"],
        requiresApproval: true,
        steps: [{ id: "st1", title: "Bins out" }],
      },
      DEFAULT_ROUTINE_SETTINGS,
    );
    expect(rt?.points).toBe(37);
    expect(rt?.missedPenalty).toBe(12);
    expect(rt?.daysOfWeek).toEqual(["sun"]);
    expect(rt?.requiresApproval).toBe(true);
  });
});

