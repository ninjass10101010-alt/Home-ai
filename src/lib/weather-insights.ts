// Pure helpers that turn raw weather + family context into the sentences only
// Consuela can say. Kept dependency-free so unit tests can exercise them
// without mocks. The "one data moat" — weather fused with the family calendar.

export interface InsightEvent {
  title: string;
  member?: string | null;
  time?: string | null;
}

export interface InsightTask {
  title: string;
  assigned?: string | null;
}

export interface InsightContext {
  events?: InsightEvent[] | null;
  tasks?: InsightTask[] | null;
  isKid?: boolean;
}

// Wear thresholds in °F — tuned for the 5–14-year-old recess/pickup question.
export interface WearAdvice {
  headline: string;
  detail: string | null;
}

export function wearAdvice(feelsLikeF: number, precipProb: number, isKid: boolean): WearAdvice {
  const cold = feelsLikeF < 40;
  const chilly = feelsLikeF < 55;
  const hot = feelsLikeF >= 90;
  const wet = precipProb >= 40;

  const coat = isKid ? "Grab a coat" : "Coats this morning";
  const layers = isKid ? "Bring a jacket" : "Light jacket";
  const water = isKid ? "Bring a water bottle" : "Water-bottle weather";
  const none = isKid ? "No jacket needed" : "Sunglasses weather";
  const rain = isKid ? "Bring a raincoat" : "Raincoats ready";

  const base = cold ? coat : chilly ? layers : hot ? water : none;
  if (wet && !cold) return { headline: rain, detail: base };
  return { headline: base, detail: null };
}

export interface StormAdvice {
  headline: string;
  detail: string;
}

// Escalated, reassurance-first copy for severe codes (95/96/99). Name the
// problem, then answer the question a parent actually has: when is it over.
export function stormAdvice(endHourISO: string | null, isKid: boolean): StormAdvice {
  const now = isKid ? "Storms right now — stay inside" : "Thunderstorms — inside is best right now";
  return { headline: now, ...clearingDetail(endHourISO, isKid) };
}

// Heavy snow is the family's other school-closing event — name it and answer
// the boots question, then the same "when is it over" reassurance.
export function snowAdvice(endHourISO: string | null, isKid: boolean): StormAdvice {
  const now = isKid ? "Big snow! Boots and mittens today" : "Big snow today — boots by the door";
  return { headline: now, ...clearingDetail(endHourISO, isKid) };
}

function clearingDetail(endHourISO: string | null, isKid: boolean): { detail: string } {
  if (!endHourISO) return { detail: "Clearing time unknown — check back soon" };
  const h = new Date(endHourISO).getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const when = `${hour12} ${h >= 12 ? "PM" : "AM"}`;
  return { detail: isKid ? `Should clear up around ${when}` : `Clearing by around ${when}` };
}

export interface FusionNote {
  headline: string;
  detail: string;
}

// Event times arrive as "16:00" (24h) or "4:00 PM" (12h, the storage format).
function parseEventMinutes(time: string): number | null {
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

// The fusion headline: "Rain around Soccer Practice" — something only the
// family dashboard can say. Compares the next precipitation hit against
// today's remaining events. Pure string/date math; callers own fallback copy.
function formatHourLabel(iso: string): string {
  const h = new Date(iso).getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${h >= 12 ? "PM" : "AM"}`;
}

export function fusionOutlook(
  rainHourISO: string | null,
  rainSentence: string | null,
  events: InsightEvent[],
  nowMs: number
): FusionNote | null {
  if (!rainHourISO || !rainSentence || events.length === 0) return null;
  const rainAt = new Date(rainHourISO).getTime();
  if (!isFinite(rainAt)) return null;

  const todayPrefix = new Date(rainAt).toISOString().split("T")[0];
  const upcoming = events
    .map((e) => {
      const mins = e.time ? parseEventMinutes(e.time) : null;
      // Resolve against the rain day's local midnight so comparisons line up.
      const dayStart = new Date(`${todayPrefix}T00:00:00`).getTime();
      return { e, t: mins != null ? dayStart + mins * 60_000 : NaN };
    })
    .filter((x) => isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const upcomingAfterNow = upcoming.filter((x) => x.t > nowMs);
  if (upcomingAfterNow.length === 0) return null;

  // An event within ±75 min of the rain hit is "at" that event.
  const match = upcomingAfterNow.find((x) => Math.abs(x.t - rainAt) <= 75 * 60_000);
  if (match) {
    return {
      headline: `Rain around ${match.e.title}`,
      detail: `${formatHourLabel(rainHourISO)} — plan ${match.e.member ?? "the crew"} around it`,
    };
  }
  // Otherwise reassure: the rain passes before the next family thing.
  const next = upcomingAfterNow[0];
  if (rainAt < next.t) {
    return { headline: rainSentence, detail: `Should pass before ${next.e.title} at ${formatEventTime(next.t)}` };
  }
  return null;
}

function formatEventTime(t: number): string {
  const d = new Date(t);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
