/**
 * Pure helpers for the chat page's family-context surfaces (FamilyBrief,
 * open-loop chips, message origin badges). No React, no side effects —
 * all rendering decisions are data-in, decision-out.
 */

/** Hex + alpha → `rgba()` string. Undefined-safe fallback when a token is missing. */
export function accentAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Resolve an accent color to rgba at the given alpha, with a fallback for
 * empty/var-form input (components pass already-resolved computed styles).
 */
export function accentColor(token: string | undefined, alpha: number, fallback: string): string {
  if (!token) return fallback;
  const t = token.trim();
  if (/^#([0-9a-f]{6})$/i.test(t)) return accentAlpha(t, alpha);
  return fallback;
}

/**
 * Tonight's dinner from the weekly meal plan. Matches PlanTab's day model:
 * `meal.time` holds the weekday short, `meal.weekOf` the Monday ISO.
 * Prefers an explicit dinner; falls back to the day's first meal.
 */
export function dinnerForToday(
  meals: Array<{ name: string; mealType?: string; time: string; weekOf?: string }>,
  currentWeek: string,
  weekdayShort: string
): { name: string } | null {
  const dayMeals = meals.filter((m) => m.time === weekdayShort && (m.weekOf || currentWeek) === currentWeek);
  if (dayMeals.length === 0) return null;
  const dinner = dayMeals.find((m) => m.mealType === "dinner") ?? dayMeals[0];
  return { name: dinner.name };
}

/** "4:00 PM" / "16:30" → minutes since midnight. Null when unparseable. */
export function parseMinutes(time: string): number | null {
  const ampm = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(time);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (ampm[3].toUpperCase() === "PM") h += 12;
    return h * 60 + parseInt(ampm[2], 10);
  }
  const mil = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(time);
  if (mil) return parseInt(mil[1], 10) * 60 + parseInt(mil[2], 10);
  return null;
}

/** The next event still ahead today, or null when the day is quiet. */
export function nextEventToday(
  events: Array<{ title: string; time: string }>,
  now: Date
): { title: string; time: string } | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best: { title: string; time: string; min: number } | null = null;
  for (const e of events) {
    const min = parseMinutes(e.time ?? "");
    if (min === null || min < nowMin) continue;
    if (!best || min < best.min) best = { ...e, min };
  }
  return best ? { title: best.title, time: best.time } : null;
}

/** True when the chat row came through the Telegram mirror. */
export function isTelegramMessage(msg: { source?: string }): boolean {
  return msg?.source === "telegram";
}

/** Human origin label for a chat row; null for dashboard rows. */
export function messageOrigin(msg: { source?: string; userId?: string }): string | null {
  if (!isTelegramMessage(msg)) return null;
  const who = msg.userId?.trim();
  return who ? `via Telegram · ${who}` : "via Telegram";
}

/**
 * Countdown label for a future event time ("in 45m"), or the clock time
 * when it's more than 90 minutes out ("at 8:45 PM"). Null for past or
 * unparseable times — the caller falls back to the plain time/empty copy.
 */
export function eventCountdown(time: string, now: Date): string | null {
  const min = parseMinutes(time);
  if (min === null) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const delta = min - nowMin;
  if (delta <= 0) return null;
  if (delta <= 90) {
    if (delta < 60) return `in ${delta}m`;
    const h = Math.floor(delta / 60);
    const m = delta % 60;
    return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
  }
  return `at ${time}`;
}

/** Clean assistant text for the voice: no markdown, list markers, or emoji. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "- ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/✅/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
