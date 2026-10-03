// Pure merge for the chat tools' "today's events" surface (2026-09-09).
// The family `events` collection and the Google-synced
// `consuela_google_calendar_events` rows live in separate PB collections —
// only the Calendar PAGE merged them, so the LLM's calendar answers silently
// missed every Google event (the school calendar). These helpers merge both
// sources into one day-accurate, time-sorted list. No PB access here — the
// tool handlers fetch rows and call mergeTodaysEvents.

import { googleEventCoversDay, googleEventClockTime, googleEventLocalMinutes } from "@/lib/calendar/google-mapping";

export interface ToolEvent {
  title: string;
  /** Preformatted 12-hour time ("6:30 PM") or undefined for all-day rows. */
  time?: string;
  member?: string;
  emoji?: string;
  color?: string;
  icon?: string;
  source: "family" | "google";
  /** Minutes since midnight for ordering; all-day rows sort first (−1). */
  sortMinutes: number;
}

/** "18:30" | "6:30 PM" → minutes; null when unparseable. */
function parseMinutes(time?: string): number | null {
  if (!time) return null;
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
  const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (m12[3].toUpperCase() === "PM") h += 12;
    return h * 60 + Number(m12[2]);
  }
  return null;
}

/** Format a Google start_iso as a 12-hour clock time ("6:30 PM"), or
 *  "All day" for date-only (all-day) starts. Returns undefined when the
 *  string is unparseable — the honest-dash rule from the weather card.
 *
 *  DELEGATE, NOT A SECOND FORMATTER (2026-10-03). This used to slice the
 *  authored UTC offset out of the string, so Ask Consuela said "9:00 AM" about
 *  the school event the Calendar page rendered as "12:00 PM" — one event, two
 *  clocks, and no way for a family to tell which one to believe. The rule is
 *  family-local time (see the TIME RULE block in google-mapping.ts), which is
 *  the same frame this module already picks the DAY in via
 *  `googleEventCoversDay`. */
export function googleEventTime(startIso: string | undefined | null): string | undefined {
  return googleEventClockTime(startIso);
}

/**
 * Merge family + Google events for ONE day. Pure: no clock reads, no I/O.
 * - A Google row lands on EVERY day it covers (all-day end is exclusive;
 *   timed rows use local day boundaries).
 * - All-day rows sort first, then family/Google interleaved by time.
 */
export function mergeTodaysEvents(
  familyEvents: Array<Record<string, any>>,
  googleRows: Array<Record<string, any>>,
  dayISO: string,
): ToolEvent[] {
  const family: ToolEvent[] = (familyEvents || []).map((e) => {
    const minutes = parseMinutes(e.time);
    return {
      title: String(e.title || "Untitled"),
      time: e.time,
      member: e.member,
      emoji: e.emoji,
      color: e.color,
      icon: e.icon || "📅",
      source: "family" as const,
      sortMinutes: minutes ?? 24 * 60,
    };
  });

  const google: ToolEvent[] = (googleRows || [])
    .filter((r) => typeof r?.start_iso === "string" && googleEventCoversDay(r, dayISO))
    .map((r) => {
      const time = googleEventTime(r.start_iso);
      return {
        title: String(r.summary || r.title || "Untitled"),
        time,
        emoji: "📅",
        color: "cyan",
        icon: "📅",
        source: "google" as const,
        // Family-local minutes — the frame the printed clock is in. The old
        // regex sliced the AUTHORED offset, so a 08:00+02:00 event sorted as
        // 08:00 while printing "2:00 AM".
        sortMinutes: googleEventLocalMinutes(r.start_iso, r.all_day),
      };
    });

  return [...family, ...google].sort((a, b) => a.sortMinutes - b.sortMinutes);
}

/** Merge family + Google rows across an inclusive date range into per-day
 *  sorted lists. Pure. Caps at 30 days (guard against a runaway model arg). */
export function mergeEventsRange(
  familyEvents: Array<Record<string, any>>,
  googleRows: Array<Record<string, any>>,
  startISO: string,
  endISO: string,
): Record<string, ToolEvent[]> {
  const out: Record<string, ToolEvent[]> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) return out;
  let cur = new Date(`${startISO}T12:00:00Z`);
  const end = new Date(`${endISO}T12:00:00Z`);
  for (let i = 0; i < 30 && cur <= end; i++) {
    const dayISO = cur.toISOString().slice(0, 10);
    out[dayISO] = mergeTodaysEvents(
      (familyEvents || []).filter((e) => String(e.date || "") === dayISO),
      googleRows || [],
      dayISO,
    );
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}
