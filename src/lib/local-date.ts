// Local-date helper for suggestion/briefing scope dates.
//
// I7 — the dashboard runs on a host whose local day may differ from UTC
// (e.g. Pacific time: 23:00 PT is 06:00 UTC tomorrow). Suggestions and the
// morning briefing are "what's relevant TODAY" in the family's local timezone,
// so they must be anchored to the local calendar date, not the UTC date.
//
// `toLocaleString("en-CA", ...)` formats as YYYY-MM-DD, so splitting on "," is
// deterministic across Node and browsers.
export function localTodayISO(now: Date = new Date()): string {
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return now.toLocaleString("en-CA", { timeZone: tz }).split(",")[0];
}

export function localPreviousDayISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
