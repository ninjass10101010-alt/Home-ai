// Kid quest presentation helpers — pure, testable. A five-year-old reads
// "Today" and "⚠️ Late", never "2026-09-16"; a claimable row says so instead
// of wearing another kid's name.
import type { Task } from "@/types/tasks";
import { raceGap, prizeForRank } from "@/lib/task-utils";

/** Due-date → kid words. Empty string renders nothing. */
export function kidDueLabel(dueISO: string | undefined, todayISO: string): string {
  if (!dueISO || !/^\d{4}-\d{2}-\d{2}$/.test(dueISO)) return "";
  if (dueISO === todayISO) return "Today";
  // Lexical compare on ISO dates — offset-immune (the established pattern).
  if (dueISO > todayISO) {
    const tomorrow = new Date(`${todayISO}T12:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().slice(0, 10);
    if (dueISO === tomorrowISO) return "Tomorrow";
    return new Date(`${dueISO}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  }
  return "⚠️ Late";
}

/** Warm-glass accent token per due state. */
export function dueTone(label: string): string {
  if (label === "Today") return "var(--color-accent-mint)";
  if (label === "Tomorrow") return "var(--color-accent-cyan)";
  if (label === "⚠️ Late") return "var(--color-accent-rose)";
  if (label === "") return "var(--color-text-muted)";
  return "var(--color-accent-cyan)"; // future weekday
}

/** The who-line for a quest row: honest framing per task mode. */
export function questWhoLabel(task: any): string {
  if (typeof task?.crewSize === "number" && task.crewSize >= 2) return "🤝 Crew";
  if (task?.universal) return "🫳 Up for grabs";
  return String(task?.assignee ?? "").split(" ")[0] || "";
}

/**
 * The weekly prize-race line — positive framing only (never "losing").
 * ONE source for every kid surface (hero week card + the leaderboard card),
 * so the two can never drift. `prizes` sorts internally; pointsMap keys must
 * match `raceName` (full names from the roster).
 */
export function kidRaceLine(
  raceName: string,
  pointsMap: Record<string, number>,
  prizes: { rank: number; text: string }[],
): string | null {
  if (!prizes || prizes.length === 0) return null;
  const ordered = [...prizes].sort((a, b) => a.rank - b.rank);
  const gap = raceGap(raceName, pointsMap, ordered.length);
  const heldPrize = gap.onPodium && gap.rank ? prizeForRank(ordered as any, gap.rank) : undefined;
  if (heldPrize) return `🎉 You're winning ${heldPrize.text}!`;
  if (gap.gapToPodium !== null && gap.gapToPodium > 0) {
    return `${gap.gapToPodium} more points to win ${ordered[ordered.length - 1].text}!`;
  }
  return "Earn points to win this week's prize!";
}
