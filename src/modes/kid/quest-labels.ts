// Kid quest presentation helpers — pure, testable. A five-year-old reads
// "Today" and "⚠️ Late", never "2026-09-16"; a claimable row says so instead
// of wearing another kid's name.
import type { Task } from "@/types/tasks";

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
