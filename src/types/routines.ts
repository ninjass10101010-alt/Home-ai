export type RoutineSlot = "morning" | "afternoon" | "evening" | "weekend";

export type RoutineDayCode = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export const ALL_ROUTINE_DAYS: readonly RoutineDayCode[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export const WEEKDAY_ROUTINE_DAYS: readonly RoutineDayCode[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
] as const;

export const WEEKEND_ROUTINE_DAYS: readonly RoutineDayCode[] = [
  "sat",
  "sun",
] as const;

export const ROUTINE_DAY_META: Record<
  RoutineDayCode,
  { short: string; label: string; initial: string }
> = {
  sun: { short: "Sun", label: "Sunday", initial: "S" },
  mon: { short: "Mon", label: "Monday", initial: "M" },
  tue: { short: "Tue", label: "Tuesday", initial: "T" },
  wed: { short: "Wed", label: "Wednesday", initial: "W" },
  thu: { short: "Thu", label: "Thursday", initial: "T" },
  fri: { short: "Fri", label: "Friday", initial: "F" },
  sat: { short: "Sat", label: "Saturday", initial: "S" },
};

export interface RoutineStep {
  id: string;
  title: string;
  emoji: string;
}

export interface FamilyRoutine {
  id: string;
  title: string;
  emoji: string;
  slot: RoutineSlot;
  time: string;
  /** Legacy/primary target: "All" | "Kids" | "Adults" | member name */
  assignee: string;
  /** Optional explicit multi-member list (takes precedence over single assignee when non-empty). */
  assignees?: string[];
  /** Specific scheduled days ("sun".."sat"). Defaults to daily (or sat+sun for slot="weekend"). */
  daysOfWeek?: RoutineDayCode[];
  points: number;
  /** Optional per-routine penalty override (0 = no penalty; undefined = settings.defaultMissedPenalty). */
  missedPenalty?: number;
  /** Optional per-routine approval gate (undefined = settings.defaultRequiresApproval). */
  requiresApproval?: boolean;
  /** Set false to pause a routine without deleting it. */
  active?: boolean;
  /** ISO creation timestamp (prevents retroactive accountability before creation day). */
  createdAt?: string;
  steps: RoutineStep[];
}

export interface RoutineSettings {
  defaultPoints: number;
  defaultMissedPenalty: number;
  accountabilityEnabled: boolean;
  parentCountsTowardRace: boolean;
  defaultRequiresApproval: boolean;
  streakBonusEveryDays: number;
  streakBonusPoints: number;
}

export const DEFAULT_ROUTINE_SETTINGS: RoutineSettings = {
  defaultPoints: 15,
  defaultMissedPenalty: 5,
  accountabilityEnabled: true,
  parentCountsTowardRace: true,
  defaultRequiresApproval: false,
  streakBonusEveryDays: 7,
  streakBonusPoints: 10,
};

export interface RoutineCompletionMeta {
  status: "completed" | "pending_approval" | "approved";
  at: string;
  by: string;
  pointsAwarded: number;
  countedTowardRace: boolean;
  operationId?: string;
  approvedBy?: string;
  approvedAt?: string;
  streakAtCompletion?: number;
  streakBonusAwarded?: number;
}

export interface DailyRoutineProgress {
  date?: string;
  /** Canonical per-member checked step IDs keyed by `${routineId}::${memberKey}`. */
  memberCheckedSteps?: Record<string, string[]>;
  /** Canonical per-member completion metadata keyed by `${routineId}::${memberKey}`. */
  memberCompleted?: Record<string, RoutineCompletionMeta>;
  /** Legacy / projected maps kept for backward compatibility. */
  checkedSteps: Record<string, string[]>;
  completedRoutines: Record<string, boolean>;
}

export interface RoutineMissedEntry {
  id: string;
  date: string;
  routineId: string;
  routineTitle: string;
  routineEmoji: string;
  memberName: string;
  memberKey: string;
  penaltyPoints: number;
  deductedPoints: number;
  countedTowardRace: boolean;
  excused: boolean;
  excusedBy?: string;
  excusedAt?: string;
  refundedPoints?: number;
  detectedAt: string;
  operationId?: string;
  excuseOperationId?: string;
}

export interface RoutineStreakStats {
  current: number;
  longest: number;
  lastCompletedDay?: string;
}

export interface RoutineAccountabilityState {
  lastSweptDay: string;
  missedEntries: RoutineMissedEntry[];
  streaks: Record<string, RoutineStreakStats>;
}

export const DEFAULT_ACCOUNTABILITY_STATE: RoutineAccountabilityState = {
  lastSweptDay: "",
  missedEntries: [],
  streaks: {},
};

export const ROUTINE_SLOT_META: Record<
  RoutineSlot,
  { label: string; emoji: string; timeDefault: string; toneKey: string }
> = {
  morning: { label: "Morning", emoji: "☀️", timeDefault: "07:15", toneKey: "amber" },
  afternoon: { label: "After School", emoji: "🎒", timeDefault: "15:30", toneKey: "cyan" },
  evening: { label: "Bedtime", emoji: "🌙", timeDefault: "20:00", toneKey: "violet" },
  weekend: { label: "Weekend", emoji: "🧹", timeDefault: "10:00", toneKey: "emerald" },
};

export const DEFAULT_ROUTINES: FamilyRoutine[] = [
  {
    id: "rt-morning",
    title: "Morning Launchpad",
    emoji: "☀️",
    slot: "morning",
    time: "07:15",
    assignee: "Kids",
    daysOfWeek: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
    points: 15,
    steps: [
      { id: "m1", title: "Make bed & tidy pillows", emoji: "🛏️" },
      { id: "m2", title: "Brush teeth & wash face", emoji: "🪥" },
      { id: "m3", title: "Get dressed for the day", emoji: "👕" },
      { id: "m4", title: "Pack water bottle & backpack", emoji: "🎒" },
    ],
  },
  {
    id: "rt-afterschool",
    title: "After-School Reset",
    emoji: "🎒",
    slot: "afternoon",
    time: "15:45",
    assignee: "Kids",
    daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],
    points: 15,
    steps: [
      { id: "a1", title: "Shoes & coat put away", emoji: "👟" },
      { id: "a2", title: "Empty lunchbox & wash bottle", emoji: "🥪" },
      { id: "a3", title: "Homework & reading session", emoji: "📚" },
    ],
  },
  {
    id: "rt-bedtime",
    title: "Evening Wind-Down",
    emoji: "🌙",
    slot: "evening",
    time: "20:00",
    assignee: "All",
    daysOfWeek: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
    points: 10,
    steps: [
      { id: "e1", title: "Put away clothes & tidy floor", emoji: "🧺" },
      { id: "e2", title: "Brush teeth & wash up", emoji: "🪥" },
      { id: "e3", title: "Screens off & lights dimmed", emoji: "📖" },
    ],
  },
  {
    id: "rt-weekend",
    title: "Weekend Zone Blitz",
    emoji: "🧹",
    slot: "weekend",
    time: "10:00",
    assignee: "All",
    daysOfWeek: ["sat", "sun"],
    points: 25,
    steps: [
      { id: "w1", title: "Clear bedroom floor & desk", emoji: "🧸" },
      { id: "w2", title: "Bring laundry hamper down", emoji: "🧺" },
      { id: "w3", title: "Help wipe shared surfaces", emoji: "🧽" },
    ],
  },
];
