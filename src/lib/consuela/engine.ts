import { db } from "@/db";
import { withAdmin } from "@/lib/pb-auth";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { localTodayISO, localPreviousDayISO, localWeekStartISO, localDayPlusISO } from "@/lib/local-date";
import { scheduleCoversWeekday, scheduleTimeMinutes, formatScheduleTime12h } from "@/lib/schedule-time";
import { googleEventClockTime, googleEventCoveredDays } from "@/lib/calendar/google-mapping";
import { ROUTINE_LEAD_MS } from "@/lib/ha/alerts";
import type { NewSuggestion } from "./types";
import { conditionKey } from "./suggestion-key";

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
    actionPayload: { tool: "get_grocery_list", args: {} },
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
  return emitting.map(p => {
    const name = p.item || p.name || "Pantry item";
    const qty = p.quantity ?? 0;
    const unit = (p.unit ?? "").toString().trim();
    const qtyUnit = unit ? `${qty} ${unit}` : `${qty}`;
    return {
      kind: "pantry_low" as const,
      severity: p.status === "out" ? "warn" as const : "info" as const,
      title: `${name} is ${p.status === "out" ? "out" : "running low"}`,
      body: `Pantry shows ${qtyUnit} of ${name}. Add to grocery list?`,
      emoji: "🥫",
      actionLabel: "Add to grocery",
      actionPayload: { tool: "add_grocery_item", args: { items: name } },
      scopeDate,
    };
  });
}

export async function scanTaskPenaltyStreak(scopeDate: string): Promise<NewSuggestion[]> {
  const weekStr = localWeekStartISO();
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
      const member = tx.member || "A family member";
      if (tx.type === "penalty" && tx.timestamp && new Date(tx.timestamp).getTime() > weekAgo) {
        penaltiesByChild[member] = (penaltiesByChild[member] ?? 0) + 1;
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

function parseMinutes(time: string | undefined): number {
  if (!time) return NaN;
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

// ─── Calendar conflicts — 7-day cache window (2026-10-05) ───────────────────
// Was today-only. The scanner now walks the next 7 local days (today + 6) over
// the family `events` collection and the cached Google rows — the SAME cache
// window `get_week_events` reads, with no live Composio/Google call. Visibility
// rules are unchanged (calendar_conflict was and stays visible to every role).

interface ConflictRow {
  id: string;
  title: string;
  date: string;
  time: string;
  icon?: string;
  color?: string;
  member?: string;
}

const CONFLICT_WINDOW_DAYS = 7;

function conflictSuggestionsForDay(rows: ConflictRow[], dayISO: string): NewSuggestion[] {
  const parsed = rows
    .map(e => ({ ...e, mins: parseMinutes(e.time) }))
    .filter(e => !isNaN(e.mins))
    .sort((a, b) => a.mins - b.mins);

  const suggestions: NewSuggestion[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      // L2 (boundary) — events starting exactly 30 min apart are back-to-back,
      // not a conflict: use `< 30`, not `<= 30`.
      if (parsed[j].mins - parsed[i].mins < 30) {
        const t1 = parsed[i].title || "Untitled event";
        const t2 = parsed[j].title || "Untitled event";
        const time1 = parsed[i].time || "unknown time";
        const time2 = parsed[j].time || "unknown time";
        suggestions.push({
          kind: "calendar_conflict",
          severity: "warn" as const,
          title: `${t1} and ${t2} overlap`,
          body: `"${t1}" (${time1}) and "${t2}" (${time2}) on ${dayISO} are within 30 minutes of each other.`,
          emoji: "📅",
          actionLabel: "View calendar",
          actionPayload: { tool: "open_calendar", args: { date: dayISO } },
          scopeDate: dayISO,
        });
      }
    }
  }
  return suggestions;
}

function overnightConflictsForDay(
  previousRows: ConflictRow[],
  dayRows: ConflictRow[],
  previousDayISO: string,
  dayISO: string,
): NewSuggestion[] {
  // L2 (overnight) — a late-night event (>= 23:00) on the previous day spills
  // into the early hours; catch overlaps against this day's pre-01:30 events.
  const earlyEvents = dayRows
    .map(e => ({ ...e, mins: parseMinutes(e.time) }))
    .filter(e => !isNaN(e.mins) && e.mins < 90); // before 01:30
  const suggestions: NewSuggestion[] = [];
  if (previousRows.length === 0 || earlyEvents.length === 0) return suggestions;
  for (const late of previousRows) {
    const lateMins = parseMinutes(late.time);
    if (isNaN(lateMins) || lateMins < 23 * 60) continue; // only >= 23:00
    for (const early of earlyEvents) {
      // 23:50 + 30min = 00:20 next day (1440+20); overlaps 00:10 (1450 > 1450? no).
      // Overlap iff lateEnd (in next-day minutes) > early start (next-day minutes).
      if (lateMins + 30 > 24 * 60 + early.mins) {
        const lateTitle = late.title || "Untitled event";
        const earlyTitle = early.title || "Untitled event";
        const lateTime = late.time || "unknown time";
        const earlyTime = early.time || "unknown time";
        suggestions.push({
          kind: "calendar_conflict",
          severity: "warn" as const,
          title: `${lateTitle} and ${earlyTitle} overlap`,
          body: `"${lateTitle}" (${lateTime} on ${previousDayISO}) runs into "${earlyTitle}" (${earlyTime} on ${dayISO}).`,
          emoji: "📅",
          actionLabel: "View calendar",
          actionPayload: { tool: "open_calendar", args: { date: dayISO } },
          scopeDate: dayISO,
        });
      }
    }
  }
  return suggestions;
}

export async function scanCalendarConflicts(scopeDate: string): Promise<NewSuggestion[]> {
  const windowDays: string[] = [];
  for (let i = 0; i < CONFLICT_WINDOW_DAYS; i++) windowDays.push(localDayPlusISO(scopeDate, i));
  const lastDay = windowDays[windowDays.length - 1];
  const previousDay = localPreviousDayISO(scopeDate);

  // Exact-day reads for today + yesterday keep the original scanner semantics;
  // one range read adds the rest of the week. Every row is re-checked against
  // its own `date` below, so a loose filter/mock can never smear a row into a
  // neighbouring day.
  const familyRead = (filter: string) =>
    withAdmin(async (pb) =>
      pb.collection("events").getFullList({ filter, requestKey: null })
    ) as Promise<ConflictRow[]>;
  const [todayRows, laterRows, previousRows, googleRows] = await Promise.all([
    familyRead(`date="${scopeDate}"`),
    familyRead(`date>"${scopeDate}" && date<="${lastDay}"`),
    familyRead(`date="${previousDay}"`),
    withAdmin(async (pb) =>
      pb.collection("consuela_google_calendar_events").getFullList({
        fields: "google_id,summary,start_iso,end_iso,all_day,calendar_id",
        requestKey: null,
      })
    ).catch(() => []) as Promise<any[]>,
  ]);

  const byDay = new Map<string, ConflictRow[]>();
  for (const day of windowDays) byDay.set(day, []);
  byDay.set(previousDay, []);
  const addRow = (day: string, row: ConflictRow) => {
    const list = byDay.get(day);
    if (list) list.push(row);
  };

  for (const row of todayRows) if (row?.date === scopeDate) addRow(scopeDate, row);
  const windowSet = new Set(windowDays);
  for (const row of laterRows) {
    const day = String(row?.date || "");
    if (day !== scopeDate && windowSet.has(day)) addRow(day, row);
  }
  for (const row of previousRows) if (row?.date === previousDay) addRow(previousDay, row);

  // Cached Google rows join the window (and the previous day used by the
  // overnight check) so school events participate. All-day / unparseable rows
  // carry no clock and are skipped — they cannot overlap a time.
  for (const g of googleRows) {
    const title = String(g?.summary || "Untitled event");
    const time = googleEventClockTime(g?.start_iso, g?.all_day);
    if (!time || !/\d{1,2}:\d{2}/.test(time)) continue;
    const covered = googleEventCoveredDays({ start_iso: g?.start_iso, end_iso: g?.end_iso, all_day: g?.all_day });
    for (const day of covered) {
      if (byDay.has(day)) {
        addRow(day, { id: `google_${g?.google_id ?? g?.id ?? title}`, title, date: day, time });
      }
    }
  }

  const suggestions: NewSuggestion[] = [];
  for (const day of windowDays) {
    const dayRows = byDay.get(day) ?? [];
    const dayPrevious = localPreviousDayISO(day);
    suggestions.push(...conflictSuggestionsForDay(dayRows, day));
    suggestions.push(...overnightConflictsForDay(byDay.get(dayPrevious) ?? [], dayRows, dayPrevious, day));
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

// Routines due soon — the in-app "schedule" tier. Today's Family Routines
// (the `schedules` collection, weekday-matched) that start within ~30 min
// surface as a routine_due suggestion (never pushed to phones). expiresAt is
// the routine's start time, so the "due soon" chip vanishes once it's due and
// (with the fetchExistingConditionKeys expiry filter) the routine can re-surface
// the next day.
export async function scanRoutinesDue(scopeDate: string, now: Date = new Date()): Promise<NewSuggestion[]> {
  const schedules = await withAdmin(async (pb) =>
    pb.collection("schedules").getFullList({ requestKey: null }) as unknown as Array<{
      id: string; title?: string; time?: string; days?: string; icon?: string;
    }>
  );
  const weekdayShort = now.toLocaleString("en-US", { weekday: "short" }); // "Wed"
  const wdIndex = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekdayShort.toLowerCase()) + 7) % 7;
  const nowM = now.getHours() * 60 + now.getMinutes();
  const leadMin = ROUTINE_LEAD_MS / 60000;

  const out: NewSuggestion[] = [];
  for (const s of schedules) {
    if (!scheduleCoversWeekday(s.days, weekdayShort, wdIndex)) continue;
    const mins = scheduleTimeMinutes(s.time);
    if (mins == null) continue;
    const delta = mins - nowM;
    if (delta <= 0 || delta > leadMin) continue;
    const startISO = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(mins / 60), mins % 60
    ).toISOString();
    out.push({
      kind: "routine_due",
      severity: "info",
      title: `${s.title || "Routine"} · at ${formatScheduleTime12h(s.time)}`,
      body: `Starting in about ${Math.round(delta)} min.`,
      emoji: s.icon || "🕐",
      actionLabel: "View calendar",
      actionPayload: { tool: "open_calendar", args: { date: scopeDate } },
      scopeDate,
      expiresAt: startISO,
    });
  }
  return out;
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
// Condition identity for dedup lives in ./suggestion-key (pure, unit-tested).
async function fetchExistingConditionKeys(): Promise<Set<string>> {
  const nowISO = new Date().toISOString();
  return withAdmin(async (pb) => {
    const rows = await pb.collection("proactive_suggestions").getFullList({
      // Ignore expired rows so a transient notice (e.g. routine_due) that has
      // passed its start time stops blocking the next day's re-fire. Unset
      // expiresAt is stored as "" in PB and must stay in the dedupe set.
      filter: `status="pending" && (expiresAt = "" || expiresAt > "${nowISO}")`,
      requestKey: null,
    }) as unknown as Array<{ kind?: string; title?: string }>;
    return new Set(rows.map((r) => conditionKey(r.kind, r.title)));
  });
}

export async function runEngine({ scopeDate }: { scopeDate: string }): Promise<{ scanned: number; inserted: number; rejected: number }> {
  const scanners = [scanPantryLow, scanTaskPenaltyStreak, scanCalendarConflicts, scanStaleData, scanGroceryStoreOptimization, scanRoutinesDue];
  const results = await Promise.all(scanners.map(async (s) => {
    try {
      return await s(scopeDate);
    } catch (e) {
      console.error("[consuela.engine] scanner failed:", (e as Error).message);
      return [] as NewSuggestion[];
    }
  }));
  const all = results.flat();
  if (all.length === 0) return { scanned: 0, inserted: 0, rejected: 0 };
  const existingKeys = await fetchExistingConditionKeys();
  const seen = new Set<string>();
  const fresh = all.filter((s) => {
    const key = conditionKey(s.kind, s.title);
    if (existingKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return { scanned: all.length, inserted: 0, rejected: 0 };
  const result = await db.insertProactiveSuggestions(fresh);
  return { scanned: all.length, inserted: result.inserted, rejected: result.rejected };
}
