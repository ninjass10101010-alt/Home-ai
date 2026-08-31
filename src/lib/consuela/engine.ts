import { db } from "@/db";
import { withAdmin } from "@/lib/pb-auth";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { weekKey } from "@/lib/task-utils";
import { localTodayISO, localPreviousDayISO } from "@/lib/local-date";
import type { NewSuggestion } from "./types";

export async function scanGroceryStoreOptimization(scopeDate: string): Promise<NewSuggestion[]> {
  const groceryItems = await withAdmin(async (pb) =>
    pb.collection("grocery_list_items").getFullList({ requestKey: null }) as unknown as Array<{
      id: string; name?: string; needed?: boolean; store?: string;
    }>
  );
  const needed = groceryItems.filter((i) => i.needed !== false);
  if (needed.length < 3) return [];

  const anyItems = needed.filter((i) => !i.store || i.store === "any");
  if (anyItems.length < 2) return [];

  return [{
    kind: "grocery_store_optimization" as const,
    severity: "info" as const,
    title: `${anyItems.length} items have no store assigned`,
    body: `Assign stores to your grocery items for smarter shopping and price comparison.`,
    emoji: "🛒",
    actionLabel: "Assign stores",
    actionPayload: { tool: "open_grocery", args: {} },
    scopeDate,
  }];
}

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
      // L2 (boundary) — events starting exactly 30 min apart are back-to-back,
      // not a conflict: use `< 30`, not `<= 30`.
      if (parsed[j].mins - parsed[i].mins < 30) {
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

  // L2 (overnight) — a late-night event (>= 23:00) on the previous day spills
  // into the early hours; catch overlaps against today's pre-01:30 events.
  const previousDay = localPreviousDayISO(scopeDate);
  const lateEvents = await withAdmin(async (pb) =>
    pb.collection("events").getFullList({
      filter: `date="${previousDay}"`,
      requestKey: null,
    }) as unknown as Array<{ id: string; title: string; date: string; time: string; icon?: string; color?: string; member?: string }>
  );
  const earlyEvents = parsed.filter(e => e.mins < 90); // before 01:30
  if (lateEvents.length > 0 && earlyEvents.length > 0) {
    for (const late of lateEvents) {
      const lateMins = parseMinutes(late.time);
      if (isNaN(lateMins) || lateMins < 23 * 60) continue; // only >= 23:00
      for (const early of earlyEvents) {
        // 23:50 + 30min = 00:20 next day (1440+20); overlaps 00:10 (1450 > 1450? no).
        // Overlap iff lateEnd (in next-day minutes) > early start (next-day minutes).
        if (lateMins + 30 > 24 * 60 + early.mins) {
          suggestions.push({
            kind: "calendar_conflict",
            severity: "warn" as const,
            title: `${late.title} and ${early.title} overlap`,
            body: `"${late.title}" (${late.time} on ${previousDay}) runs into "${early.title}" (${early.time} on ${scopeDate}).`,
            emoji: "📅",
            actionLabel: "View calendar",
            actionPayload: { tool: "open_calendar", args: { date: scopeDate } },
            scopeDate,
          });
        }
      }
    }
  }

  return suggestions;
}

export async function scanStaleData(scopeDate: string): Promise<NewSuggestion[]> {
  const meals = await withAdmin(async (pb) =>
    pb.collection("meal_plan_entries").getFullList({ requestKey: null }) as unknown as Array<{ weekOf?: string }>
  );
  const currentWeek = weekStartForDate(localTodayISO());
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

// C1 — engine-level condition dedup: keep exactly ONE pending row per
// condition (kind + normalized title), regardless of scopeDate or snooze
// state. Without this, a persistent condition (pantry low, no-meals-this-week,
// streak >= 3, nightly conflict) accumulates one visible row per day because
// the idempotency hash includes scopeDate. Snoozing hides the single row;
// acting/dismissing frees the condition for re-creation on the next scan.
// This also gracefully absorbs the L1 hash-format migration: old-format
// pending rows (different hash, same condition) block new inserts until acted
// on — intended.
async function fetchExistingConditionKeys(): Promise<Set<string>> {
  return withAdmin(async (pb) => {
    const rows = await pb.collection("proactive_suggestions").getFullList({
      filter: 'status="pending"',
      requestKey: null,
    }) as unknown as Array<{ kind?: string; title?: string }>;
    return new Set(rows.map((r) => `${r.kind ?? ""}|${(r.title ?? "").trim().toLowerCase()}`));
  });
}

export async function runEngine({ scopeDate }: { scopeDate: string }): Promise<{ scanned: number; inserted: number; rejected: number }> {
  const scanners = [scanPantryLow, scanTaskPenaltyStreak, scanCalendarConflicts, scanStaleData, scanGroceryStoreOptimization];
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
  const existingKeys = await fetchExistingConditionKeys();
  const seen = new Set<string>();
  const fresh = all.filter((s) => {
    const key = `${s.kind}|${s.title.trim().toLowerCase()}`;
    if (existingKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return { scanned: all.length, inserted: 0, rejected: 0 };
  const result = await db.insertProactiveSuggestions(fresh);
  return { scanned: all.length, inserted: result.inserted, rejected: result.rejected };
}
