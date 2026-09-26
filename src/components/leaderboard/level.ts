import { BADGES, getLevel, type Badge } from "@/types/tasks";
import type { AllTimeReadState } from "@/hooks/useAllTimeTotals";

export const LOADING_LABEL = "Loading all-time…";
export const UNAVAILABLE_LABEL = "All-time unavailable";
export const OFFLINE_LABEL = "offline cache";
export const COMPLETION_UNAVAILABLE_LABEL = "completion count unavailable";
export const LEVEL_UNAVAILABLE_LABEL = "Level unavailable";
export const PROGRESS_UNAVAILABLE_LABEL = "level progress unavailable";

export type BadgeRequirement = "points" | "completions" | "streak" | "never";

export const BADGE_REQUIREMENT: Record<string, BadgeRequirement> = {
  first_task: "completions",
  streak_3: "streak",
  streak_7: "streak",
  century: "points",
  half_k: "points",
  thousand: "points",
  helper_10: "completions",
  helper_50: "completions",
  early_bird: "never",
  high_value: "never",
  instant_redeem: "never",
  week_champ: "never",
};

export type AllTimeLevel = {
  known: boolean;
  level: number;
  title: string;
  emoji: string;
  next: number | null;
  progress: number;
};

export function resolveAllTimeLevel(allTimePoints: number | null): AllTimeLevel {
  if (allTimePoints === null) {
    return { known: false, level: 0, title: "", emoji: "", next: null, progress: 0 };
  }
  const resolved = getLevel(allTimePoints);
  return { known: true, ...resolved };
}

export function allTimeLevelLabel(level: AllTimeLevel): string {
  if (!level.known) return LEVEL_UNAVAILABLE_LABEL;
  return `${level.emoji} ${level.title}`.trim();
}

type LevelLike = { levelKnown: boolean; levelEmoji: string; levelTitle: string };

export function entryLevelLabel(entry: LevelLike): string {
  if (!entry.levelKnown) return LEVEL_UNAVAILABLE_LABEL;
  return `${entry.levelEmoji} ${entry.levelTitle}`.trim();
}

export function isBadgeEarned(
  badge: Badge,
  allTimePoints: number | null,
  streak: number,
  allTimeCompletions: number | null,
): boolean {
  const requirement = BADGE_REQUIREMENT[badge.id];
  if (requirement === "points" && allTimePoints === null) return false;
  if (requirement === "completions" && allTimeCompletions === null) return false;
  return badge.condition(allTimePoints ?? 0, streak, allTimeCompletions ?? 0);
}

export function earnedBadges(
  allTimePoints: number | null,
  streak: number,
  allTimeCompletions: number | null,
): Badge[] {
  return BADGES.filter((badge) => isBadgeEarned(badge, allTimePoints, streak, allTimeCompletions));
}

export function earnedBadgeEmojis(
  allTimePoints: number | null,
  streak: number,
  allTimeCompletions: number | null,
): string[] {
  return earnedBadges(allTimePoints, streak, allTimeCompletions).map((badge) => badge.emoji);
}

export function splitBadges(
  allTimePoints: number | null,
  streak: number,
  allTimeCompletions: number | null,
): { earned: Badge[]; locked: Badge[] } {
  const earned = earnedBadges(allTimePoints, streak, allTimeCompletions);
  const earnedIds = new Set(earned.map((badge) => badge.id));
  return { earned, locked: BADGES.filter((badge) => !earnedIds.has(badge.id)) };
}

export function splitBadgesWithWeeklyChamp(
  allTimePoints: number | null,
  streak: number,
  allTimeCompletions: number | null,
  hasWeeklyChamp: boolean,
): { earned: Badge[]; locked: Badge[] } {
  if (!hasWeeklyChamp) return splitBadges(allTimePoints, streak, allTimeCompletions);
  const earned = BADGES.filter(
    (badge) =>
      badge.id === "week_champ" || isBadgeEarned(badge, allTimePoints, streak, allTimeCompletions),
  );
  const earnedIds = new Set(earned.map((badge) => badge.id));
  return { earned, locked: BADGES.filter((badge) => !earnedIds.has(badge.id)) };
}

export function formatAllTimeStamp(updatedAt: string): string {
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return updatedAt;
  return parsed.toLocaleString();
}

export function allTimeCaption(
  points: number | null | undefined,
  read: AllTimeReadState,
  updatedAt: string | null,
  label = "all-time",
): string {
  if (read === "loading") return LOADING_LABEL;
  if (typeof points !== "number") return UNAVAILABLE_LABEL;
  const stamp =
    read === "offline_cache" && updatedAt ? ` · ${OFFLINE_LABEL} ${formatAllTimeStamp(updatedAt)}` : "";
  return `${points} ${label}${stamp}`;
}

export function allTimeCompletionsCaption(
  completions: number | null | undefined,
  read: AllTimeReadState,
): string {
  if (read === "loading") return LOADING_LABEL;
  if (typeof completions !== "number") return COMPLETION_UNAVAILABLE_LABEL;
  return `${completions} tasks completed`;
}
