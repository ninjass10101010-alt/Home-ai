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
}

export interface WeekGraphPoint {
  day: string;
  points: number;
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
  progressToNext: number;
  badges: string[];
  completedInWeek: number;
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
