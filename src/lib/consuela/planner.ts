// Consuela planner (Task 9, 2026-09-14) — the zero-tools generation mode behind
// the dashboard's "✨ Generate" buttons. A model with no tools armed cannot
// write while it suggests: this module owns the intent registry, the grounded
// prompt builders (system instruction + live context pack), and the per-intent
// JSON output validator. Everything here is pure — the route (agent:"planner")
// is the only impure caller, and it never persists planner replies to the
// family thread.

import { composeContextPrompt, type ContextPack } from "./assistant-context";

export type PlannerIntent =
  | "meal_week"
  | "meal_ideas"
  | "task_ideas"
  | "reward_ideas"
  | "schedule_week";

const PLANNER_INTENTS: readonly string[] = [
  "meal_week",
  "meal_ideas",
  "task_ideas",
  "reward_ideas",
  "schedule_week",
];

export function isPlannerIntent(value: string): value is PlannerIntent {
  return PLANNER_INTENTS.includes(value);
}

/** The 28-slot week grid needs more room than a list of ideas or buffers. */
export function plannerMaxTokens(intent: PlannerIntent): number {
  return intent === "meal_week" ? 4096 : 1536;
}

/**
 * Per-intent system instruction — terse, the OUTPUT shape stated ONCE here
 * (the repair turn only demands "JSON only"). Grounding arrives via the
 * context pack appended below; the model is never asked to guess dates,
 * rosters or pantry state.
 */
const PLANNER_SYSTEM: Record<PlannerIntent, string> = {
  meal_week:
    "You are Consuela, the family dashboard's meal planner. Plan quick, family-friendly meals that fit the calendar, pantry and roster in the context below — never invent family facts. " +
    'Respond with ONLY a JSON object: {"meal_plan":[{"day":"Mon","mealType":"dinner","name":"Sheet-pan tacos","emoji":"🌮","tags":["Kid-friendly"],"prepTime":"20 min"}]} — ' +
    "day ∈ Mon|Tue|Wed|Thu|Fri|Sat|Sun; mealType ∈ breakfast|lunch|dinner|snack; name required.",
  meal_ideas:
    "You are Consuela, the family dashboard's meal planner. Suggest meals that fit what this family actually has and likes, per the context below. " +
    'Respond with ONLY a JSON object: {"actions":[{"type":"meal","title":"Sheet-pan gnocchi","detail":"One pan, ready in 25 min","emoji":"🍝"}]}.',
  task_ideas:
    "You are Consuela, the family dashboard's task coach. Suggest age-appropriate chores for the REAL kids in the roster below with fair point values — assignees must be roster members. " +
    'Respond with ONLY a JSON object: {"actions":[{"type":"task","title":"Fold laundry","detail":"After the wash is dry","assignee":"Emily","points":8,"emoji":"🧺"}]} — points are 1..100.',
  reward_ideas:
    "You are Consuela, the family dashboard's reward coach. Suggest rewards the kids on the roster are actually saving toward, priced against the shop catalog below. " +
    'Respond with ONLY a JSON object: {"actions":[{"type":"reward","title":"Extra screen time","detail":"30 minutes on a weekend day","assignee":"Caspian","points":60,"emoji":"📱"}]} — points are 1..100.',
  schedule_week:
    "You are Consuela, the family dashboard's scheduling agent. Read the calendar digest below: flag real overlaps, propose buffers worth protecting, then 2–3 plain-language planning lines. " +
    'Respond with ONLY a JSON object: {"conflicts":[{"title":"Soccer vs. dinner","detail":"…"}],"buffers":[{"title":"Drive to soccer","start":"2026-09-11T14:30","end":"2026-09-11T15:00"}],"suggestions":["Quiet Fri eve"]} — buffer start/end are local ISO times.',
};

export function plannerSystemPrompt(intent: PlannerIntent, pack: ContextPack): string {
  return `${PLANNER_SYSTEM[intent]}\n\n${composeContextPrompt(pack)}`;
}

export interface PlannerOptions {
  weekOf?: string;
  days?: string[];
  date?: string;
}

export function plannerUserPrompt(intent: PlannerIntent, options: PlannerOptions = {}): string {
  switch (intent) {
    case "meal_week": {
      const weekOf = typeof options.weekOf === "string" && options.weekOf.trim()
        ? options.weekOf.trim()
        : "the current week (see the context pack)";
      const days = Array.isArray(options.days)
        ? options.days.map((d) => String(d).trim()).filter(Boolean).slice(0, 7)
        : [];
      const scope = days.length
        ? `Fill ONLY these days: ${days.join(", ")}.`
        : "Cover every day Mon–Sun across breakfast, lunch, dinner and snack.";
      return `Plan the family's meals for the week of ${weekOf}. ${scope} Skip slots the plan already fills.`;
    }
    case "meal_ideas":
      return "Give me 4–6 meal ideas for this week — quick, family-friendly, and using what's in the pantry.";
    case "task_ideas":
      return "Suggest 4–6 chores worth adding this week for the kids on the roster, with real assignees and fair points.";
    case "reward_ideas":
      return "Suggest 3–5 rewards for the shop that match what the kids are saving toward, with fair point costs.";
    case "schedule_week": {
      const horizon = typeof options.date === "string" && options.date.trim()
        ? options.date.trim()
        : "the coming week (see the context pack)";
      return `Review the schedule from ${horizon}: conflicts first, then buffers, then plain-language planning lines.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

export type PlannerValidation =
  | { ok: true; result: Record<string, any> }
  | { ok: false };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const ACTION_TYPES = ["meal", "task", "reward"];
const MIN_MEAL_WEEK_KEEP_RATIO = 0.3;

function fail(): PlannerValidation {
  return { ok: false };
}

/**
 * Tolerant JSON extraction (the ai-response.ts idea, local to the planner):
 * direct parse first, then the first balanced `{...}` substring — which
 * silently swallows ```json fences and surrounding prose. A model that wrote
 * no object at all yields null → honest failure downstream.
 */
function parseJsonObject(content: string): Record<string, any> | null {
  const text = String(content ?? "").trim();
  if (!text) return null;
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch {
    // fall through to the balanced scan
  }
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
        } catch {
          // not parseable
        }
        return null;
      }
    }
  }
  return null;
}

function trimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function matchEnum(v: unknown, values: readonly string[]): string | undefined {
  const s = trimmedString(v).toLowerCase();
  return values.find((x) => x.toLowerCase() === s);
}

function cleanStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(trimmedString).filter(Boolean) : [];
}

function isoParseable(v: unknown): v is string {
  const s = trimmedString(v);
  return !!s && !Number.isNaN(new Date(s).getTime());
}

function validateMealWeek(obj: Record<string, any>): PlannerValidation {
  const entries = obj.meal_plan;
  if (!Array.isArray(entries)) return fail();
  const kept: Record<string, any>[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const day = matchEnum(raw.day, WEEKDAYS);
    const mealType = matchEnum(raw.mealType, MEAL_TYPES);
    const name = trimmedString(raw.name);
    if (!day || !mealType || !name) continue;
    const entry: Record<string, any> = { day, mealType, name };
    const emoji = trimmedString(raw.emoji);
    if (emoji) entry.emoji = emoji;
    const tags = cleanStringArray(raw.tags);
    if (tags.length) entry.tags = tags;
    const prepTime = trimmedString(raw.prepTime);
    if (prepTime) entry.prepTime = prepTime;
    kept.push(entry);
  }
  // An all-junk week (0 kept) or a mostly-junk week (<30% kept) is a model
  // failure, not a short plan — the repair retry / honest {ok:false} is next.
  if (kept.length === 0) return fail();
  if (kept.length / entries.length < MIN_MEAL_WEEK_KEEP_RATIO) return fail();
  return { ok: true, result: { meal_plan: kept } };
}

function validateActions(obj: Record<string, any>): PlannerValidation {
  const entries = obj.actions;
  if (!Array.isArray(entries)) return fail();
  const kept: Record<string, any>[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const type = matchEnum(raw.type, ACTION_TYPES);
    const title = trimmedString(raw.title);
    if (!type || !title) continue;
    let points: number | undefined;
    if (raw.points !== undefined && raw.points !== null) {
      const n = Number(raw.points);
      if (!Number.isFinite(n) || n < 1 || n > 100) continue;
      points = Math.round(n);
    }
    const entry: Record<string, any> = { type, title };
    const detail = trimmedString(raw.detail);
    if (detail) entry.detail = detail;
    const emoji = trimmedString(raw.emoji);
    if (emoji) entry.emoji = emoji;
    const assignee = trimmedString(raw.assignee);
    if (assignee) entry.assignee = assignee;
    if (points !== undefined) entry.points = points;
    kept.push(entry);
  }
  if (kept.length === 0) return fail();
  return { ok: true, result: { actions: kept } };
}

function validateSchedule(obj: Record<string, any>): PlannerValidation {
  const keys = ["conflicts", "buffers", "suggestions"] as const;
  // At least one expected array must be present — an unrelated object is the
  // wrong shape (e.g. the model answering a schedule_week with meal_plan).
  if (!keys.some((k) => Array.isArray(obj[k]))) return fail();
  const conflicts = Array.isArray(obj.conflicts) ? obj.conflicts : [];
  const suggestions = cleanStringArray(obj.suggestions);
  const buffers: Record<string, any>[] = [];
  if (Array.isArray(obj.buffers)) {
    for (const raw of obj.buffers) {
      if (!raw || typeof raw !== "object") continue;
      const title = trimmedString(raw.title);
      if (!title || !isoParseable(raw.start) || !isoParseable(raw.end)) continue;
      buffers.push({ title, start: trimmedString(raw.start), end: trimmedString(raw.end) });
    }
  }
  return { ok: true, result: { conflicts, buffers, suggestions } };
}

/**
 * Structural validation of one model reply for an intent. Returns the cleaned
 * result on success; on any shape/parse failure the route decides between the
 * single repair retry and the honest {ok:false, reason:"invalid_model_output"}.
 */
export function validatePlannerOutput(intent: PlannerIntent, content: string): PlannerValidation {
  const obj = parseJsonObject(content);
  if (!obj) return fail();
  switch (intent) {
    case "meal_week":
      return validateMealWeek(obj);
    case "meal_ideas":
    case "task_ideas":
    case "reward_ideas":
      return validateActions(obj);
    case "schedule_week":
      return validateSchedule(obj);
  }
}
