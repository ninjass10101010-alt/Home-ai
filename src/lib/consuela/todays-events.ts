// Pure merge for the chat tools' "today's events" surface (2026-09-09).
// The family `events` collection and the Google-synced
// `consuela_google_calendar_events` rows live in separate PB collections —
// only the Calendar PAGE merged them, so the LLM's calendar answers silently
// missed every Google event (the school calendar). These helpers merge both
// sources into one day-accurate, time-sorted list. No PB access here — the
// tool handlers fetch rows and call mergeTodaysEvents.

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
 *  string is unparseable — the honest-dash rule from the weather card. */
export function googleEventTime(startIso: string | undefined | null): string | undefined {
  if (!startIso) return undefined;
  // Date-only → all-day row.
  if (!startIso.includes("T")) return "All day";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(startIso);
  if (!m) return undefined;
  const h24 = Number(m[4]);
  const min = m[5];
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "AM" : "PM";
  return `${h12}:${min} ${suffix}`;
}

/**
 * Merge family + Google events for ONE day. Pure: no clock reads, no I/O.
 * - Google rows outside `dayISO` are dropped (start_iso prefix match).
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
    .filter((r) => typeof r?.start_iso === "string" && r.start_iso.slice(0, 10) === dayISO)
    .map((r) => {
      const time = googleEventTime(r.start_iso);
      const isAllDay = time === "All day";
      const m = /^T(\d{2}):(\d{2})/.exec(r.start_iso.slice(10));
      const minutes = isAllDay ? -1 : m ? Number(m[1]) * 60 + Number(m[2]) : 24 * 60;
      return {
        title: String(r.summary || r.title || "Untitled"),
        time,
        emoji: "📅",
        color: "cyan",
        icon: "📅",
        source: "google" as const,
        sortMinutes: minutes,
      };
    });

  return [...family, ...google].sort((a, b) => a.sortMinutes - b.sortMinutes);
}
