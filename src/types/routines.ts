export type RoutineSlot = "morning" | "afternoon" | "evening" | "weekend";

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
  assignee: string; // "All" or member name
  points: number;
  steps: RoutineStep[];
}

export interface DailyRoutineProgress {
  checkedSteps: Record<string, string[]>; // routineId -> stepIds[]
  completedRoutines: Record<string, boolean>; // routineId -> true
}

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
    assignee: "All",
    points: 15,
    steps: [
      { id: "s1", title: "Brush teeth & wash face", emoji: "🪥" },
      { id: "s2", title: "Make bed neatly", emoji: "🛏️" },
      { id: "s3", title: "Get dressed for the day", emoji: "👕" },
      { id: "s4", title: "Pack backpack & water bottle", emoji: "🎒" },
    ],
  },
  {
    id: "rt-afternoon",
    title: "After-School Reset",
    emoji: "🎒",
    slot: "afternoon",
    time: "15:30",
    assignee: "All",
    points: 20,
    steps: [
      { id: "s1", title: "Shoes & coat on hooks", emoji: "👟" },
      { id: "s2", title: "Empty lunchbox into sink", emoji: "🍱" },
      { id: "s3", title: "20 mins homework or reading", emoji: "📚" },
      { id: "s4", title: "Healthy afternoon snack", emoji: "🍎" },
    ],
  },
  {
    id: "rt-evening",
    title: "Evening Wind-Down",
    emoji: "🌙",
    slot: "evening",
    time: "20:00",
    assignee: "All",
    points: 15,
    steps: [
      { id: "s1", title: "10-minute room tidy", emoji: "🧸" },
      { id: "s2", title: "Shower & pajamas on", emoji: "🚿" },
      { id: "s3", title: "Lay out tomorrow's clothes", emoji: "👕" },
      { id: "s4", title: "Read in bed (screens off)", emoji: "📖" },
    ],
  },
  {
    id: "rt-weekend",
    title: "Saturday Power Hour",
    emoji: "🧹",
    slot: "weekend",
    time: "10:00",
    assignee: "All",
    points: 30,
    steps: [
      { id: "s1", title: "Bring laundry hamper down", emoji: "🧺" },
      { id: "s2", title: "Water indoor plants", emoji: "🪴" },
      { id: "s3", title: "Brush pet & refill bowls", emoji: "🐕" },
      { id: "s4", title: "Wipe down desk & dresser", emoji: "✨" },
    ],
  },
];
