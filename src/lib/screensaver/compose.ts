/**
 * Pure composer for the ambient wall-display screensaver payload.
 * Spec: docs/superpowers/specs/2026-09-07-ambient-screensaver-design.md
 * Data in, decisions out — no PB, no fetch, no React.
 */
import { parseMinutes } from "@/lib/consuela/chat-context";

export interface ScreensaverEvent {
  title: string;
  time: string; // display form: "4:00 PM" | "6:30 PM" | "All day"
  allDay: boolean;
  color?: string;
}

export interface ScreensaverPayload {
  ok: true;
  generatedAt: string;
  date: string; // YYYY-MM-DD, family-local
  events: ScreensaverEvent[];
  dinner: { name: string } | null;
  tasks: { done: number; total: number };
  briefing: string[];
  weather: { tempF: number; hiF: number; loF: number; condition: string } | null;
}

/** "16:30" → "4:30 PM". Assumes valid input (guarded by parseMinutes upstream). */
function hm24to12(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

/**
 * Today's board: family rows (PB `events`, `date` is YYYY-MM-DD) merged with
 * Google rows (PB `consuela_google_calendar_events`, `start_iso` local wall
 * time). Past timed events drop off; all-day rows sort first; cap 4.
 */
export function selectTodayEvents(
  family: Array<{ title?: string; date?: string; time?: string; color?: string }>,
  google: Array<{ summary?: string; start_iso?: string; all_day?: boolean }>,
  todayISO: string,
  now: Date = new Date()
): ScreensaverEvent[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const rows: Array<ScreensaverEvent & { min: number }> = [];
  for (const e of family) {
    if (!e.title || e.date !== todayISO) continue;
    const min = parseMinutes(e.time ?? "");
    if (min === null) {
      rows.push({ title: e.title, time: "All day", allDay: true, color: e.color, min: -1 });
    } else if (min >= nowMin) {
      rows.push({ title: e.title, time: e.time ?? "", allDay: false, color: e.color, min });
    }
  }
  for (const g of google) {
    const iso = g.start_iso ?? "";
    if (!g.summary || !iso.startsWith(todayISO)) continue;
    if (g.all_day) {
      rows.push({ title: g.summary, time: "All day", allDay: true, min: -1 });
    } else {
      const min = parseMinutes(iso.slice(11, 16));
      if (min !== null && min >= nowMin) {
        rows.push({ title: g.summary, time: hm24to12(iso.slice(11, 16)), allDay: false, min });
      }
    }
  }
  rows.sort((a, b) => a.min - b.min);
  return rows.slice(0, 4).map(({ min: _min, ...rest }) => rest);
}

/**
 * Family-wide week scoreboard. done = completed THIS week (completedInWeek is
 * the Monday-ISO week key written by task-utils). open = not done, not
 * completed this week, and due by week end (or no due date at all).
 */
export function choreProgress(
  tasks: Array<{ status?: string; completedInWeek?: string; due?: string }>,
  weekKey: string,
  weekEndISO: string
): { done: number; total: number } {
  const done = tasks.filter((t) => t.completedInWeek === weekKey).length;
  const open = tasks.filter(
    (t) => t.status !== "done" && t.completedInWeek !== weekKey && (!t.due || t.due <= weekEndISO)
  ).length;
  return { done, total: done + open };
}

/** ≤3 digest lines from today's stored BriefingSummary (see lib/consuela/briefing.ts). */
export function briefingDigest(
  summary: {
    events?: unknown[];
    tasks?: unknown[];
    suggestions?: Array<{ title?: string }>;
  } | null
): string[] {
  if (!summary) return [];
  const ev = summary.events?.length ?? 0;
  const tk = summary.tasks?.length ?? 0;
  const lines = [
    ev === 0 ? "📅 No events today" : `📅 ${ev} event${ev === 1 ? "" : "s"} today`,
    tk === 0 ? "✅ No chores open" : `✅ ${tk} chore${tk === 1 ? "" : "s"} still open`,
  ];
  const first = summary.suggestions?.[0]?.title;
  if (first) lines.push(`💡 ${first}`);
  return lines.slice(0, 3);
}

/** Compact WMO code → label (Fahrenheit-only board). */
export function wxConditionLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code >= 1 && code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "—";
}
