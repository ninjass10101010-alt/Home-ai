export type CrewCloseMode = "strict" | "parent" | "deadline";

export interface Task {
  id: number;
  title: string;
  assignee: string;
  assigneeEmoji: string;
  due: string;
  points: number;
  recurring: string | null;
  category: string;
  completed: boolean;
  priority: "high" | "medium" | "low";
  completedBy?: string;
  completedAt?: string;
  completedInWeek?: string;
  universal?: boolean;
  stealable?: boolean;
  pendingApproval?: PendingApproval;
  // Durable send-back proof: set when a parent sends a pending tap back, so
  // cross-device snapshot merge can distinguish "rejected elsewhere" from a
  // stale snapshot that simply predates the tap. Cleared by the next tap.
  sentBackAt?: string;
  // Crew tasks (spec §1): crewSize 2–5, presence implies a crew task. `crew`
  // is the joined-member roster (empty/absent = nobody joined yet). `speedBonus`
  // applies to open (universal) tasks — the first claimer earns points + bonus.
  crewSize?: number | null;
  crew?: Crew | null;
  speedBonus?: number;
  // Crew close modes (spec 2026-09-29): absent = "strict". Meaningful only on
  // crew tasks. "parent" lets a parent close with partial check-ins;
  // "deadline" auto-closes at the day sweep after the due date; every close
  // stages a crew pendingApproval — points still only move on parent approval.
  crewCloseMode?: CrewCloseMode | null;
  /** One-time tasks only: auto-remove this many days after the due date.
   *  Integer 1–30; absent/null = never. Refused when `recurring` is set. */
  expiresAfterDays?: number | null;
}

export interface CrewMember {
  name: string;
  emoji: string;
  joinedAt: string;
  // Set-once ("done my part") — never unset except by a crew reset/send-back.
  checkedInAt?: string;
}

export interface Crew {
  members: CrewMember[];
  // Names a parent removed from the crew. A tombstone so a stale device's
  // union-merge can't resurrect a removed member cross-device. Cleared on
  // regeneration (a fresh week's crew starts empty).
  removed?: string[];
}

export interface PendingApproval {
  byName: string;
  at: string;
  points: number;
  // Crew completions carry the AUTHORITATIVE award list: the members an
  // approval will pay (full points each). Full crews list everyone; a partial
  // close lists only the checked-in members. Absent for solo pending taps.
  crew?: string[];
}

export type LedgerOperationSource =
  | "assigned-complete"
  | "open-claim"
  | "late-snatch"
  | "task-approval"
  | "reward-redeem"
  | "planner-adjust"
  | "task-undo"
  | "task-penalty"
  | "manual-adjust"
  | "legacy-migration";

export type LedgerOperationAction =
  | "approve"
  | "approve-all"
  | "send-back"
  | "penalty"
  | "adjust";

export interface LedgerOperationMeta {
  operationId: string;
  source: LedgerOperationSource;
  fingerprint?: string;
  actorId?: string;
  action?: LedgerOperationAction;
  taskIds?: number[];
}

export interface Transaction {
  id: number;
  timestamp: string;
  member: string;
  type: "earn" | "redeem" | "penalty" | "adjust";
  amount: number;
  description: string;
  taskId?: number;
  appliedBy?: string;
  meta?: LedgerOperationMeta;
}

export interface LedgerEntryInput {
  type: Transaction["type"];
  member: string;
  amount: number;
  description: string;
  taskId?: number;
  appliedBy?: string;
}

export interface LedgerOperationInput {
  operationId: string;
  source: LedgerOperationSource;
  fingerprint?: string;
  actorId?: string;
  action?: LedgerOperationAction;
  taskIds?: number[];
  entries: LedgerEntryInput[];
}

export interface WeekData {
  weekStart: string;
  points: Record<string, number>;
  streak: Record<string, number>;
  lastActive: Record<string, string>;
  history: Transaction[];
}

export type WeekArchive = Record<string, WeekData>;

export interface FamilyGoal {
  id: number;
  title: string;
  emoji: string;
  targetPoints: number;
  reward: string;
  weekStart: string;
}

export interface HallOfFameEntry {
  member: string;
  emoji: string;
  weekStart: string;
  points: number;
  rank: number;
  prize?: string;
  celebrated?: boolean;
}

export interface WeekGraphPoint {
  day: string;
  points: number;
}

export interface WeeklyPrize {
  id: string;
  rank: 1 | 2 | 3;
  emoji: string;
  text: string;
}

export interface LeaderboardEntry {
  name: string;
  emoji: string;
  color: string;
  points: number;
  streak: number;
  rank: number;
  level: number;
  levelTitle: string;
  levelEmoji: string;
  levelKnown: boolean;
  progressToNext: number;
  badges: string[];
  completedInWeek: number;
  allTimePoints: number | null;
  allTimeCompletions: number | null;
}

export interface Reward {
  id: number;
  name: string;
  emoji: string;
  cost: number;
}

export interface Penalty {
  id: number;
  name: string;
  emoji: string;
  points: number;
}

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  description: string;
  condition: (totalPoints: number, streak: number, completions: number) => boolean;
}

export const LEVELS = [
  { points: 0, title: "Rookie Helper", emoji: "🌱" },
  { points: 50, title: "Task Scout", emoji: "⭐" },
  { points: 150, title: "Chore Champ", emoji: "🏅" },
  { points: 300, title: "Star Performer", emoji: "🌟" },
  { points: 500, title: "Task Master", emoji: "👑" },
  { points: 1000, title: "Legend", emoji: "🔥" },
];

export const BADGES: Badge[] = [
  { id: "first_task", name: "First Task", emoji: "🎯", description: "Complete your first task", condition: (total, streak, comps) => comps >= 1 },
  { id: "streak_3", name: "3-Day Streak", emoji: "🔥", description: "Complete a task 3 days in a row", condition: (total, streak, comps) => streak >= 3 },
  { id: "streak_7", name: "7-Day Streak", emoji: "💪", description: "Complete a task 7 days in a row", condition: (total, streak, comps) => streak >= 7 },
  { id: "century", name: "Century Club", emoji: "💯", description: "Earn 100 points total", condition: (total, streak, comps) => total >= 100 },
  { id: "half_k", name: "Half K", emoji: "🏆", description: "Earn 500 points total", condition: (total, streak, comps) => total >= 500 },
  { id: "thousand", name: "Grand Champion", emoji: "👑", description: "Earn 1000 points total", condition: (total, streak, comps) => total >= 1000 },
  { id: "helper_10", name: "Helper Hero", emoji: "🦸", description: "Complete 10 tasks", condition: (total, streak, comps) => comps >= 10 },
  { id: "helper_50", name: "Super Helper", emoji: "🚀", description: "Complete 50 tasks", condition: (total, streak, comps) => comps >= 50 },
  { id: "early_bird", name: "Early Bird", emoji: "🌅", description: "Complete 5 tasks before noon", condition: (total, streak, comps) => false },
  { id: "high_value", name: "Big Points", emoji: "💎", description: "Complete a 25+ pt task", condition: (total, streak, comps) => false },
  { id: "instant_redeem", name: "Shopper", emoji: "🛍️", description: "Redeem your first reward", condition: (total, streak, comps) => false },
  { id: "week_champ", name: "Weekly Champ", emoji: "🥇", description: "Finish #1 on the weekly leaderboard", condition: (total, streak, comps) => false },
];

export function getLevel(points: number): { level: number; title: string; emoji: string; next: number | null; progress: number } {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (points >= LEVELS[i].points) {
      const next = i < LEVELS.length - 1 ? LEVELS[i + 1].points : null;
      const currentMin = LEVELS[i].points;
      const range = next ? next - currentMin : currentMin || 1;
      const progress = next ? Math.min(100, Math.round(((points - currentMin) / range) * 100)) : 100;
      return { level: i + 1, title: LEVELS[i].title, emoji: LEVELS[i].emoji, next, progress };
    }
  }
  return { level: 1, title: LEVELS[0].title, emoji: LEVELS[0].emoji, next: LEVELS[1]?.points ?? null, progress: 0 };
}
