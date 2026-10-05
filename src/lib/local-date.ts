// Local-date helper for suggestion/briefing scope dates.
//
// I7 — the dashboard runs on a host whose local day may differ from UTC
// (e.g. Pacific time: 23:00 PT is 06:00 UTC tomorrow). Suggestions and the
// morning briefing are "what's relevant TODAY" in the family's local timezone,
// so they must be anchored to the local calendar date, not the UTC date.
//
// `toLocaleString("en-CA", ...)` formats as YYYY-MM-DD, so splitting on "," is
// deterministic across Node and browsers.
//
// The zone itself is a DEPLOYMENT input (`TZ` in the compose file `deploy.sh`
// runs), not something to guess at runtime — see `familyTimeZone()` below for why
// a wrong value is now a named error instead of a four-hour-early week.
import { weekStartForDate } from "@/lib/meals-week-utils";

/**
 * `TZ` is a DEPLOYMENT input, so a typo in it is an operator error that must be
 * reported as one. Before this module validated, `TZ=America/Detriot` (one
 * missing `r`) sailed straight through: `familyTimeZone()` returned the bad
 * string, `Intl.DateTimeFormat().resolvedOptions().timeZone` quietly answered
 * `undefined`, and every time-dependent route then died on a bare
 * `RangeError: Invalid time zone specified: America/Detriot` — a 500/503 with
 * nothing naming the key that was wrong. `Intl` is the oracle: it accepts every
 * real IANA zone and throws for everything else, so it is asked once per distinct
 * value and the answer is reused.
 */
export class InvalidFamilyTimeZoneError extends Error {
  readonly configured: string;

  constructor(configured: string) {
    super(
      `invalid_family_timezone: set TZ to an IANA zone name like America/Detroit ` +
        `(got ${JSON.stringify(configured)})`,
    );
    this.name = "InvalidFamilyTimeZoneError";
    this.configured = configured;
  }
}

/**
 * Resolved zones, keyed by the raw `process.env.TZ` they came from. Keying by the
 * raw value rather than freezing one module-scope constant is deliberate: Node
 * re-reads `process.env.TZ` when it is assigned, and `rewards-redeem-route.test.ts`
 * re-pins it to Asia/Tokyo at runtime to prove the ledger writes the LOCAL Monday
 * east of UTC. A frozen constant would strand that assertion on the zone the
 * module happened to load under. Validation still happens exactly once per
 * distinct value — the map is keyed by config, not by call.
 */
const RESOLVED_ZONE = new Map<string | symbol, string>();

// Symbols, not strings: a real zone name is a non-empty string, so these
// can never collide with a `TZ` value whatever the operator types.
const UNSET_KEY = Symbol("tz-unset");
const AMBIENT_KEY = Symbol("tz-ambient");

/**
 * Does `Intl` accept this zone name? That is the only correctness signal
 * available for free, and it is exact: `Intl` accepts every real IANA zone and
 * throws a `RangeError` for everything else.
 */
function isUsableZone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function computeFamilyTimeZone(raw: string | undefined): string {
  const configured = (raw ?? "").trim();
  if (configured) {
    // An explicit `TZ` is a claim about the family's calendar. If it is not a
    // real IANA zone, every date in the app is wrong AND Intl would throw an
    // anonymous RangeError on every call — so refuse the configuration first.
    if (!isUsableZone(configured)) throw new InvalidFamilyTimeZoneError(configured);
    return configured;
  }

  // Unset or empty: nothing to validate, so this is the runtime's own zone and
  // it must never become a boot failure. ICU answers the sentinel
  // `Etc/Unknown` when it cannot name one (which is what `TZ=""` produces), and
  // Intl rejects that sentinel — but in exactly that state Node's local calendar
  // IS UTC, so UTC is the honest value of "whatever zone this process resolved
  // to", and it is the only one `Intl` will format with.
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof resolved === "string" && resolved !== "" && isUsableZone(resolved)) {
    return resolved;
  }
  return "UTC";
}

export function familyTimeZone(): string {
  const raw = process.env.TZ;
  const key = raw === undefined ? UNSET_KEY : raw.trim() === "" ? AMBIENT_KEY : raw;
  const cached = RESOLVED_ZONE.get(key);
  if (cached !== undefined) return cached;
  const zone = computeFamilyTimeZone(raw);
  RESOLVED_ZONE.set(key, zone);
  return zone;
}

export function localTodayISO(now: Date = new Date()): string {
  return now.toLocaleString("en-CA", { timeZone: familyTimeZone() }).split(",")[0];
}

/**
 * The LOCAL calendar date of a full ISO **instant** — e.g. a task's
 * `completedAt`, which every writer produces with `toISOString()`.
 *
 * Slicing that string (`d.slice(0, 10)`) yields the UTC date, and comparing it
 * against a local key like `today` or a week start mixes two axes. They disagree
 * for four hours on either side of UTC midnight: in America/Detroit a chore
 * finished at 20:30 reads as tomorrow, so it falls outside `day <= today` and
 * vanishes from the week. Convert the instant to the family timezone first.
 */
export function localDateOf(instantIso: string): string {
  return localTodayISO(new Date(instantIso));
}

/**
 * The LOCAL calendar day of a STORED date-ish value, or `null` when it is not
 * one.
 *
 * Two shapes reach the app: a bare local date (`"2026-09-28"` — what
 * `localTodayISO()` and the `getISO.*` due presets write, stored in PocketBase
 * `text` fields), and a full ISO instant (Google sync, older rows). A bare date
 * must **not** go through `new Date()`: it parses as UTC midnight, which behind
 * UTC is the *previous* local day. It is read as local noon instead.
 *
 * `null` for the legacy labels `"Today"` / `"Tomorrow"` / `"Later"` (still
 * written by `pb-db.ts` and `db/index.ts`) and for empty strings. Those are not
 * dates, and `new Date("Today")` is an Invalid Date whose `NaN < x` comparison
 * is false — so they were never treated as overdue, and that is preserved on
 * purpose: silently promoting unparseable labels to "overdue" would inflate
 * every count the moment this is adopted.
 */
export function localDateOfStoredDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T12:00:00`); // local noon — see the note above
    return isNaN(d.getTime()) ? null : localTodayISO(d);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(v)) {
    const d = new Date(v.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : localTodayISO(d);
  }
  return null;
}

export function localPreviousDayISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  // Serialize in the family timezone (not UTC) so this is correct in any zone.
  return d.toLocaleString("en-CA", { timeZone: familyTimeZone() }).split(",")[0];
}

export function localWeekdayShort(now: Date = new Date()): string {
  return now.toLocaleString("en-US", { timeZone: familyTimeZone(), weekday: "short" });
}

export function weekdayOfISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleString("en-US", { timeZone: familyTimeZone(), weekday: "short" });
}

export function localWeekStartISO(now: Date = new Date()): string {
  // Single source of truth for week-start math (see meals-week-utils.ts).
  // weekStartForDate serializes from LOCAL date parts, so it is correct in any timezone.
  return weekStartForDate(localTodayISO(now));
}

export interface LocalDateContext {
  todayISO: string;
  todayWeekday: string;
  yesterdayISO: string;
  yesterdayWeekday: string;
  weekStartISO: string;
  tz: string;
}

export function localDateContext(now: Date = new Date()): LocalDateContext {
  const todayISO = localTodayISO(now);
  const yesterdayISO = localPreviousDayISO(todayISO);
  const tz = familyTimeZone();
  return {
    todayISO,
    todayWeekday: localWeekdayShort(now),
    yesterdayISO,
    yesterdayWeekday: weekdayOfISO(yesterdayISO),
    weekStartISO: localWeekStartISO(now),
    tz,
  };
}
