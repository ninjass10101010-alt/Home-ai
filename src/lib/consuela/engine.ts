import { db } from "@/db";
import { withAdmin } from "@/lib/pb-auth";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { weekKey } from "@/lib/task-utils";
import type { NewSuggestion } from "./types";

function todayISO(): string { return new Date().toISOString().split("T")[0]; }

export async function scanPantryLow(scopeDate: string): Promise<NewSuggestion[]> {
  const pantry = await withAdmin(async (pb) =>
    pb.collection("pantry_items").getFullList({ requestKey: null }) as unknown as Array<{
      id: string; item?: string; name?: string; status?: string; quantity?: number; unit?: string;
    }>
  );
  const emitting = pantry.filter(p => p.status === "low" || p.status === "out");
  return emitting.map(p => ({
    kind: "pantry_low" as const,
    severity: p.status === "out" ? "warn" as const : "info" as const,
    title: `${p.item || p.name} is ${p.status === "out" ? "out" : "running low"}`,
    body: `Pantry shows ${p.quantity ?? 0} ${p.unit ?? ""} of ${p.item || p.name}. Add to grocery list?`,
    emoji: "🥫",
    actionLabel: "Add to grocery",
    actionPayload: { tool: "add_grocery_item", args: { items: p.item || p.name } },
    scopeDate,
  }));
}

export async function scanTaskPenaltyStreak(scopeDate: string): Promise<NewSuggestion[]> {
  const weekStr = weekKey();
  const week = await withAdmin(async (pb) => {
    const rows = await pb.collection("week_data").getFullList({ requestKey: null }) as Array<{
      weekStart: string; history?: Array<{ type?: string; member?: string; timestamp?: string }>;
    }>;
    return rows.find(r => r.weekStart === weekStr) || null;
  });
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const penaltiesByChild: Record<string, number> = {};
  if (week?.history && Array.isArray(week.history)) {
    for (const tx of week.history) {
      if (tx.type === "penalty" && tx.member && tx.timestamp && new Date(tx.timestamp).getTime() > weekAgo) {
        penaltiesByChild[tx.member] = (penaltiesByChild[tx.member] ?? 0) + 1;
      }
    }
  }
  return Object.entries(penaltiesByChild)
    .filter(([, count]) => count >= 3)
    .map(([child, count]) => ({
      kind: "task_penalty_streak" as const,
      severity: "warn" as const,
      title: `${child} got ${count} penalties this week`,
      body: `Consider checking in — their bedtime chore has tripped ${count} times in 7 days.`,
      emoji: "⚠️",
      actionLabel: "View tasks",
      actionPayload: { tool: "get_pending_tasks", args: { member: child } },
      scopeDate,
    }));
}

function parseMinutes(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const time24Match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (time24Match) return parseInt(time24Match[1], 10) * 60 + parseInt(time24Match[2], 10);
  const d = new Date(time);
  if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  return NaN;
}

export async function scanCalendarConflicts(scopeDate: string): Promise<NewSuggestion[]> {
  const events = await withAdmin(async (pb) =>
    pb.collection("events").getFullList({
      filter: `date="${scopeDate}"`,
      requestKey: null,
    }) as unknown as Array<{ id: string; title: string; date: string; time: string; icon?: string; color?: string; member?: string }>
  );

  const parsed = events
    .map(e => ({ ...e, mins: parseMinutes(e.time) }))
    .filter(e => !isNaN(e.mins))
    .sort((a, b) => a.mins - b.mins);

  const suggestions: NewSuggestion[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (parsed[j].mins - parsed[i].mins <= 30) {
        suggestions.push({
          kind: "calendar_conflict",
          severity: "warn" as const,
          title: `${parsed[i].title} and ${parsed[j].title} overlap`,
          body: `"${parsed[i].title}" (${parsed[i].time}) and "${parsed[j].title}" (${parsed[j].time}) on ${scopeDate} are within 30 minutes of each other.`,
          emoji: "📅",
          actionLabel: "View calendar",
          actionPayload: { tool: "open_calendar", args: { date: scopeDate } },
          scopeDate,
        });
      }
    }
  }
  return suggestions;
}

export async function scanStaleData(scopeDate: string): Promise<NewSuggestion[]> {
  const meals = await withAdmin(async (pb) =>
    pb.collection("meal_plan_entries").getFullList({ requestKey: null }) as unknown as Array<{ weekOf?: string }>
  );
  const currentWeek = weekStartForDate(todayISO());
  if (meals.filter(m => m.weekOf === currentWeek).length === 0) {
    return [{
      kind: "stale_data",
      severity: "info" as const,
      title: "No meals planned for this week",
      body: "Open the Meals tab and tap ✨ Generate or copy last week's plan.",
      emoji: "🍽️",
      actionLabel: "Open meals",
      actionPayload: { tool: "get_weekly_meals", args: {} },
      scopeDate,
    }];
  }
  return [];
}

export async function runEngine({ scopeDate }: { scopeDate: string }): Promise<{ scanned: number; inserted: number; rejected: number }> {
  const scanners = [scanPantryLow, scanTaskPenaltyStreak, scanCalendarConflicts, scanStaleData];
  let all: NewSuggestion[] = [];
  for (const s of scanners) {
    try {
      const items = await s(scopeDate);
      all = all.concat(items);
    } catch (e) {
      console.error("[consuela.engine] scanner failed:", (e as Error).message);
    }
  }
  if (all.length === 0) return { scanned: 0, inserted: 0, rejected: 0 };
  const result = await db.insertProactiveSuggestions(all);
  return { scanned: all.length, inserted: result.inserted, rejected: result.rejected };
}
