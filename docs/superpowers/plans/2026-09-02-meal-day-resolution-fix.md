# Meal Day-Resolution Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meals logged via Consuela land on the family's actual days (America/Detroit), the two misplaced rows are corrected, and meal logging goes through a controlled `add_meal` tool.

**Architecture:** Add timezone-aware date helpers, inject an explicit "Today is…" context block into the Hermes system prompts (the model currently has zero date grounding), fix the UTC clocks inside the chat tools, add a real `add_meal` tool (upsert by day+mealType+week), set `TZ` in the container, and patch the two confirmed bad rows in PocketBase.

**Tech Stack:** Next.js 16 app router, vitest, PocketBase admin API.

**Work tree:** `Home-ai/` (all paths below relative to it).

## Global Constraints

- Family timezone: `America/Detroit` (used in docker-compose `TZ` and as the default `process.env.TZ`/`Intl` in `src/lib/local-date.ts`).
- Week starts Monday; weekday strings are short form `Mon|Tue|Wed|Thu|Fri|Sat|Sun` (matching `src/data/meals.ts weekDays` and `weekDayMap` in `meals-week-utils.ts`).
- Chat thread ids stay **UTC** (`new Date().toISOString().split("T")[0]`) per AGENTS.md §3.5 — do NOT change `todayISO()` in `src/app/api/hermes/chat/route.ts`.
- Meal record uses the `Meal` type in `src/types/meals.ts`: `time` (weekday short), `mealType`, `weekOf` (Monday ISO), `date` (ISO). Arrays (`ingredients`, `tags`) are JSON-stringified on the PB write path (mirror `pb-db.ts insertMeal`).
- The `action-runner.ts` dead path (zero callers) is left alone — not part of this fix.
- Every task ends with an independently testable deliverable; TDD where the plan says "Write the failing test" first.

---

### Task 1: Timezone-aware date helpers

**Files:**
- Create: `tests/unit/local-date-context.test.ts`
- Modify: `src/lib/local-date.ts`

**Interfaces:**
- Produces: `familyTimeZone()`, `localWeekdayShort(now?)`, `weekdayOfISO(iso)`, `localWeekStartISO(now?)`, `localDateContext(now?)` → `{ todayISO, todayWeekday, yesterdayISO, yesterdayWeekday, weekStartISO, tz }`

- [ ] **Step 1: Write the failing test** (`tests/unit/local-date-context.test.ts`)

```ts
import { describe, it, expect, afterEach } from "vitest";
import {
  familyTimeZone,
  localWeekdayShort,
  localDateContext,
} from "@/lib/local-date";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("localDateContext (family tz = America/Detroit)", () => {
  it("resolves Tuesday-evening-ET conversation to the family's Monday", () => {
    process.env.TZ = "America/Detroit";
    // 2026-09-02 00:36 UTC = Tue 2026-09-01 20:36 ET — the exact bug window
    const now = new Date("2026-09-02T00:36:00Z");
    expect(familyTimeZone()).toBe("America/Detroit");
    expect(localWeekdayShort(now)).toBe("Tue");
    expect(localDateContext(now)).toEqual({
      todayISO: "2026-09-01",
      todayWeekday: "Tue",
      yesterdayISO: "2026-08-31",
      yesterdayWeekday: "Mon",
      weekStartISO: "2026-08-31",
      tz: "America/Detroit",
    });
  });

  it("handles Monday morning ET (UTC same day) without shifting", () => {
    process.env.TZ = "America/Detroit";
    // 2026-09-01 14:00 UTC = Tue 2026-09-01 10:00 ET
    const now = new Date("2026-09-01T14:00:00Z");
    const ctx = localDateContext(now);
    expect(ctx.todayISO).toBe("2026-09-01");
    expect(ctx.todayWeekday).toBe("Tue");
    expect(ctx.yesterdayISO).toBe("2026-08-31");
    expect(ctx.weekStartISO).toBe("2026-08-31");
  });

  it("handles Sunday (yesterday = Saturday, weekStart = the prior Monday)", () => {
    process.env.TZ = "America/Detroit";
    // 2026-09-06 23:30 UTC = Sat 2026-09-05 19:30 ET
    const now = new Date("2026-09-06T23:30:00Z");
    const ctx = localDateContext(now);
    expect(ctx.todayISO).toBe("2026-09-05");
    expect(ctx.yesterdayISO).toBe("2026-09-04");
    expect(ctx.weekStartISO).toBe("2026-08-31");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/local-date-context.test.ts`
Expected: FAIL — exports `familyTimeZone`, `localWeekdayShort`, `localDateContext` don't exist.

- [ ] **Step 3: Write minimal implementation** — append to `src/lib/local-date.ts`:

```ts
export function familyTimeZone(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function localWeekdayShort(now: Date = new Date()): string {
  return now.toLocaleString("en-US", { timeZone: familyTimeZone(), weekday: "short" });
}

export function weekdayOfISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleString("en-US", { timeZone: familyTimeZone(), weekday: "short" });
}

export function localWeekStartISO(now: Date = new Date()): string {
  const today = localTodayISO(now);
  const d = new Date(`${today}T12:00:00`); // noon: immune to DST/UTC-date shifts
  const diff = d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(12, 0, 0, 0);
  return mon.toLocaleString("en-CA", { timeZone: familyTimeZone() }).split(",")[0];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/local-date-context.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-date.ts tests/unit/local-date-context.test.ts
git commit -m "feat(dates): tz-aware family date context helpers"
```

---

### Task 2: Date context in the system prompts

**Files:**
- Create: `src/lib/consuela-prompts.ts`
- Modify: `src/app/api/hermes/chat/route.ts`
- Create: `tests/unit/consuela-prompts.test.ts`

**Interfaces:**
- Consumes: `localDateContext(now?)` from Task 1.
- Produces: `buildConsuelaSystemPrompt(now?)`, `buildClemSystemPrompt(now?)`, and re-exports `SYSTEM_PROMPT`, `CLEM_SYSTEM_PROMPT`, `HOUSE_CONTROL_PROMPT_ADDENDUM`.

- [ ] **Step 1: Write the failing test** (`tests/unit/consuela-prompts.test.ts`)

```ts
import { describe, it, expect, afterEach } from "vitest";
import { buildConsuelaSystemPrompt, buildClemSystemPrompt } from "@/lib/consuela-prompts";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("system prompt date context", () => {
  it("tells Consuela today's family date (no UTC guess)", () => {
    process.env.TZ = "America/Detroit";
    const prompt = buildConsuelaSystemPrompt(new Date("2026-09-02T00:36:00Z"));
    expect(prompt).toContain("Today is Tue, 2026-09-01 (America/Detroit)");
    expect(prompt).toContain("Yesterday was Mon, 2026-08-31");
    expect(prompt).toContain("this week's Monday is 2026-08-31");
    expect(prompt).toContain("add_meal tool");
  });

  it("adds the same context block to Clem's prompt", () => {
    process.env.TZ = "America/Detroit";
    const prompt = buildClemSystemPrompt(new Date("2026-09-02T00:36:00Z"));
    expect(prompt).toContain("Today is Tue, 2026-09-01 (America/Detroit)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/consuela-prompts.test.ts` (expected: module not found / exports missing).
- [ ] **Step 3: Write the implementation**

`src/lib/consuela-prompts.ts` — move `SYSTEM_PROMPT` (route.ts:66-82), `CLEM_SYSTEM_PROMPT` (route.ts:40-41), `HOUSE_CONTROL_PROMPT_ADDENDUM` (route.ts:84-89) verbatim into this file, then add:

```ts
import { localDateContext } from "@/lib/local-date";

export function buildDateContextBlock(now: Date = new Date()): string {
  const ctx = localDateContext(now);
  return `

Current date — use this for "today", "yesterday", "tomorrow" (do NOT guess from server time):
Today is ${ctx.todayWeekday}, ${ctx.todayISO} (${ctx.tz}).
Yesterday was ${ctx.yesterdayWeekday}, ${ctx.yesterdayISO}.
The week runs Monday–Sunday; this week's Monday is ${ctx.weekStartISO}.
When the user says what they ate or wants planned, use the add_meal tool with the correct day.`;
}

export function buildConsuelaSystemPrompt(now?: Date): string {
  return SYSTEM_PROMPT + buildDateContextBlock(now);
}

export function buildClemSystemPrompt(now?: Date): string {
  return CLEM_SYSTEM_PROMPT + buildDateContextBlock(now);
}

export { SYSTEM_PROMPT, CLEM_SYSTEM_PROMPT, HOUSE_CONTROL_PROMPT_ADDENDUM };
```

`src/app/api/hermes/chat/route.ts` — delete the three prompt consts (lines 40-89), import the builders, and change line 196:

```ts
const baseSystem = isClem
  ? buildClemSystemPrompt()
  : buildConsuelaSystemPrompt() + (houseControl ? HOUSE_CONTROL_PROMPT_ADDENDUM : "");
```

Do NOT change `todayISO()` at route.ts:9 — thread ids stay UTC.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/unit/consuela-prompts.test.ts` (2/2). Also run the existing hermes-chat tests to confirm no regression.
- [ ] **Step 5: Commit**

```bash
git add src/lib/consuela-prompts.ts src/app/api/hermes/chat/route.ts tests/unit/consuela-prompts.test.ts
git commit -m "feat(consuela): give the agent the family's real date in the system prompt"
```

---

### Task 3: Fix the tools' clocks

**Files:**
- Modify: `src/lib/hermes-tools.ts` (lines 30-32 `todayISO`, 495-517 `get_weekly_meals`, 703-733 `get_dashboard_summary`)
- Create: `tests/unit/hermes-tools-dates.test.ts` (mock `@/db`, `@/lib/pb-auth`, `@/lib/ha/websocket-client`)

**Interfaces:**
- Consumes: `localTodayISO`, `localWeekdayShort`, `familyTimeZone` from `@/lib/local-date`; `weekStartForDate` from `@/lib/meals-week-utils`.
- Produces: corrected `get_dashboard_summary` output (`date` = local today, adds `today_weekday`, `family_timezone`), corrected `get_weekly_meals` output (`today`, `current_week_monday`, each meal carries `weekOf` + `date`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/hermes-tools-dates.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: vi.fn(() => []),
    selectPendingTasks: vi.fn(() => []),
    selectMeals: vi.fn(async () => [
      { name: "Pizza", time: "Wed", mealType: "dinner", weekOf: "2026-08-31", date: "2026-09-02" },
      { name: "Leftovers", time: "Tue", mealType: "lunch", weekOf: "2026-08-31", date: "2026-09-01" },
    ]),
  },
}));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn() }));

import { getTool } from "@/lib/hermes-tools";
import { localTodayISO, localWeekdayShort } from "@/lib/local-date";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
  vi.resetAllMocks();
});

describe("hermes-tools local day resolution", () => {
  it("get_dashboard_summary matches meals by LOCAL weekday, not UTC", async () => {
    process.env.TZ = "America/Detroit";
    const hand = getTool("get_dashboard_summary").handler;
    const raw = await hand({});
    const data = JSON.parse(raw);
    expect(data.date).toBe(localTodayISO()); // "2026-09-01"
    expect(data.today_weekday).toBe(localWeekdayShort()); // "Tue"
    expect(data.family_timezone).toBe("America/Detroit");
    // Pizza (Wed) must NOT appear on Tue; Leftovers (Tue) must appear
    expect(data.meals_today.map((m: any) => m.name)).toContain("Leftovers");
    expect(data.meals_today.map((m: any) => m.name)).not.toContain("Pizza");
  });

  it("get_weekly_meals reports today + current week monday", async () => {
    process.env.TZ = "America/Detroit";
    const hand = getTool("get_weekly_meals").handler;
    const raw = await hand({});
    const data = JSON.parse(raw);
    expect(data.today).toContain("Tue");
    expect(data.today).toContain("2026-09-01");
    expect(data.current_week_monday).toBe("2026-08-31");
    expect(data.days["Wed"][0].date).toBe("2026-09-02");
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/unit/hermes-tools-dates.test.ts` (expected: field mismatches).
- [ ] **Step 3: Implement** in `src/lib/hermes-tools.ts`:
  - Change `todayISO()` body to `return localTodayISO();` (add imports: `localTodayISO, localWeekdayShort, familyTimeZone` from `@/lib/local-date`; `weekStartForDate` from `@/lib/meals-week-utils`).
  - `get_dashboard_summary`: `const today = localTodayISO(); const todayWeekday = localWeekdayShort();`; filter meals `day.toLowerCase() === todayWeekday.toLowerCase()`; add `today_weekday: todayWeekday, family_timezone: familyTimeZone()` to the summary object.
  - `get_weekly_meals`: return `{ today: "${localWeekdayShort()} (${localTodayISO()})", current_week_monday: weekStartForDate(localTodayISO()), days: byDay }`; push `weekOf: m.weekOf, date: m.date` into each day entry.
- [ ] **Step 4: Run to pass** — `npx vitest run tests/unit/hermes-tools-dates.test.ts`.
- [ ] **Step 5: Commit** `fix(hermes-tools): report the family's local day, not the UTC server clock`

---

### Task 4: The `add_meal` tool

**Files:**
- Modify: `src/lib/hermes-tools.ts` (add `adminUpsertMeal` near `adminUpsertTask` at line 60; add tool def near `get_weekly_meals` ~line 518)
- Modify tests: `tests/unit/hermes-tools-dates.test.ts` (extend)

**Interfaces:**
- Consumes: `weekdayOfISO`, `familyTimeZone` from `@/lib/local-date`; `weekStartForDate`, `isoDateForWeekday` from `@/lib/meals-week-utils`; `withAdmin` from `@/lib/pb-auth`.
- Produces: `adminUpsertMeal(meal)` → `{ row: any | null; replaced: boolean }`; `add_meal` tool.

- [ ] **Step 1: Write the failing test** (extend `tests/unit/hermes-tools-dates.test.ts`)

```ts
// NOTE: day resolution must be date-independent (the test must pass on any run date,
// just like the get_dashboard_summary/get_weekly_meals tests). "Monday of the current
// week" and "Sunday of the current week" are derived from weekStartForDate(localTodayISO()),
// never hardcoded. 2026-09-01 is a TUESDAY — do not use it as a "Monday" fixture.
import { weekStartForDate, isoDateForWeekday } from "@/lib/meals-week-utils";
import { localTodayISO } from "@/lib/local-date";

const pbMock = {
  collection: vi.fn((name: string) => {
    if (name !== "meal_plan_entries") throw new Error("unexpected collection");
    return {
      getFullList: vi.fn(async () => []),
      create: vi.fn(async (r: any) => ({ id: "new123", ...r })),
      update: vi.fn(async (id: string, r: any) => ({ id, ...r })),
    };
  }),
};

describe("add_meal tool", () => {
  // Re-establish each test: the sibling "hermes-tools local day resolution"
  // describe's afterEach calls vi.resetAllMocks(), which wipes withAdmin's impl.
  beforeEach(() => {
    vi.mocked(withAdmin).mockImplementation(async (fn: any) => fn(pbMock));
  });

  it("resolves an ISO date (this week's Monday) to weekday + weekOf + date", async () => {
    process.env.TZ = "America/Detroit";
    const mon = weekStartForDate(localTodayISO()); // e.g. "2026-08-31"
    const hand = getTool("add_meal")!.handler;
    const raw = await hand({ name: "Little Caesars Pizza", day: mon, mealType: "dinner" });
    const data = JSON.parse(raw);
    expect(data.ok).toBe(true);
    expect(data.meal.time).toBe("Mon");
    expect(data.meal.weekOf).toBe(mon);
    expect(data.meal.date).toBe(mon);
    expect(data.meal.mealType).toBe("dinner");
  });

  it("treats a Sunday weekday as part of the current week", async () => {
    process.env.TZ = "America/Detroit";
    const expectedSun = isoDateForWeekday(weekStartForDate(localTodayISO()), "Sun"); // this week's Sunday
    const hand = getTool("add_meal")!.handler;
    const raw = await hand({ name: "BBQ", day: "Sun" });
    const data = JSON.parse(raw);
    expect(data.meal.time).toBe("Sun");
    expect(data.meal.weekOf).toBe(weekStartForDate(expectedSun));
    expect(data.meal.date).toBe(expectedSun);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/unit/hermes-tools-dates.test.ts` (expected: `add_meal` not found).
- [ ] **Step 3: Implement**

`adminUpsertMeal` (near line 60):

```ts
async function adminUpsertMeal(meal: Record<string, unknown>): Promise<{ row: any | null; replaced: boolean }> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("meal_plan_entries").getFullList({ requestKey: null });
      const existing = records.find(
        (r: any) =>
          r.time === meal.time &&
          (r.mealType || "dinner") === (meal.mealType || "dinner") &&
          (r.weekOf || "") === (meal.weekOf || "")
      );
      if (existing) {
        const row = await pb.collection("meal_plan_entries").update(existing.id, meal);
        return { row, replaced: true };
      }
      const row = await pb.collection("meal_plan_entries").create(meal);
      return { row, replaced: false };
    });
  } catch (e: any) {
    console.error("[hermes-tools] upsertMeal failed:", e?.message);
    return { row: null, replaced: false };
  }
}
```

Tool definition (near line 518):

```ts
{
  definition: {
    name: "add_meal",
    description:
      "Add or replace a meal on the family meal planner for a specific day. Use when the user says what they ate or wants planned (e.g. 'yesterday was pizza dinner', 'put leftovers on Tuesday lunch'). Day must be a weekday short (Mon..Sun) or a YYYY-MM-DD date — resolve 'today'/'yesterday' using the Current date block in your system prompt.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Meal name (e.g. 'Little Caesars Pizza')" },
        day: { type: "string", description: "Weekday short (Mon/Tue/Wed/Thu/Fri/Sat/Sun) or YYYY-MM-DD" },
        mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "Which meal (default dinner)" },
        emoji: { type: "string", description: "Emoji for the meal (default 🍽️)" },
      },
      required: ["name", "day"],
    },
  },
  handler: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return summarize({ ok: false, error: "Meal name is required" });
    const dayRaw = String(args.day ?? "").trim();
    const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const todayISO = localTodayISO();
    let mealDate: string;
    let weekdayShort: string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) {
      mealDate = dayRaw;
      weekdayShort = weekdayOfISO(dayRaw);
    } else {
      const idx = WEEKDAYS.findIndex((d) => d.toLowerCase() === dayRaw.toLowerCase());
      if (idx === -1) {
        return summarize({ ok: false, error: `day must be Mon..Sun or YYYY-MM-DD, got "${dayRaw}"` });
      }
      weekdayShort = WEEKDAYS[idx];
      mealDate = isoDateForWeekday(weekStartForDate(todayISO), weekdayShort);
    }
    const weekOf = weekStartForDate(mealDate);
    const mealType = (typeof args.mealType === "string" ? args.mealType : "dinner").toLowerCase();
    const meal: Record<string, unknown> = {
      name,
      emoji: typeof args.emoji === "string" && args.emoji ? args.emoji : "🍽️",
      time: weekdayShort,
      mealType,
      weekOf,
      date: mealDate,
      prepTime: "30 min",
      tags: JSON.stringify([]),
      ingredients: JSON.stringify([]),
      servings: 7,
      calories: 0,
    };
    const { row, replaced } = await adminUpsertMeal(meal);
    if (!row) return summarize({ ok: false, error: "Could not save the meal" });
    return summarize({
      ok: true,
      replaced,
      meal: { id: row.id, name: row.name, day: row.time, mealType: row.mealType, date: row.date, weekOf: row.weekOf },
    });
  },
},
```

Note: `localTodayISO`, `localWeekdayShort`, `familyTimeZone`, `weekdayOfISO` imported from `@/lib/local-date`; `weekStartForDate`, `isoDateForWeekday` from `@/lib/meals-week-utils`. `summarize` already exists. Do NOT add to `CLEM_TOOLS`.

- [ ] **Step 4: Run to pass** — `npx vitest run tests/unit/hermes-tools-dates.test.ts`.
- [ ] **Step 5: Commit** `feat(hermes-tools): add_meal tool — family-day meal logging with week stamping`

---

### Task 5: Container timezone

**Files:**
- Modify: `docker-compose.yml` (home-dashboard environment block)
- Modify: `DEPLOY_NAS_LOCAL.md` (gitignored ops runbook — append gotcha)

- [ ] **Step 1: Edit** `docker-compose.yml`, add after line 45 (`SESSION_COOKIE_SECURE`):

```yaml
      # Family timezone — the dashboard's "today" must match Michigan. UTC rolls
      # to the next day at 7-8 PM Eastern, which mis-dated AI-logged meals.
      - TZ=America/Detroit
```

- [ ] **Step 2: Append gotcha** to `DEPLOY_NAS_LOCAL.md`: hermes-agent-2 container also runs UTC — recreate with `-e TZ=America/Detroit` on the NAS (dashboard-side fixes cover the model even without it; this makes the agent's own clock agree too).
- [ ] **Step 3: Verify YAML parses** — `node -e "const fs=require('fs');const yaml=require('js-yaml');yaml.load(fs.readFileSync('docker-compose.yml','utf8'));console.log('yaml ok')"` (or `docker compose config` if available).
- [ ] **Step 4: Commit** `fix(ops): run the dashboard in the family timezone`

---

### Task 6: Repair the misplaced rows (data mutation — re-confirm at run time)

**Files:**
- Create: `scripts/consuela/fix-meal-days-2026-09-02.mjs` (pattern: `scripts/pb-seed.mjs` env loading + PB superuser auth)

- [ ] **Step 1: Write the script** — patches exactly two confirmed rows via PB `PATCH`:
  - `26kj9go5ugymmgh` "Little Caesars Pizza" → `{ time: "Mon", date: "2026-09-01" }` (dinner unchanged)
  - `xkzt18bv5flu07n` "Pizza Leftovers" → `{ time: "Tue", date: "2026-09-02" }` (lunch unchanged)
  Log before/after name/time/weekOf/date for each.
- [ ] **Step 2: Before running, ASK the user** about the three other rows from the same conversation — `73gwp8stwiaf71x` Chicken Nuggets (Wed dinner), `uyjk3iq1w483gsy` Eggs Ham & Potatoes (Tue dinner), `6s087a84mjzqx3b` Leftovers (Eggs & Ham) (Wed lunch) — patch/delete only on their answer.
- [ ] **Step 3: Run the script** and confirm the two rows updated.
- [ ] **Step 4: Commit** `fix(data): correct meal rows mis-dated by the UTC day-resolution bug`

---

### Task 7: Verification + docs (mandatory per AGENTS.md)

**Files:**
- Modify: `AGENTS.md` (Current Dashboard Snapshot, UI Change Record, Change Log, §5.3)

- [ ] **Step 1: Run gates** — `npm run typecheck` → clean (only pre-existing errors may remain, none in touched files); `npx eslint` on touched files → clean; `npx vitest run` → all pass (baseline 741/742, 1 pre-existing hermes-port failure may remain).
- [ ] **Step 2: Live probe** — start dev server, POST `/api/hermes/chat` with a message; confirm no 500 and date context present — or assert via the unit tests plus a `curl` of the guest-exempt route.
- [ ] **Step 3: Update `AGENTS.md`** — new "Last Updated: 2026-09-02" snapshot entry describing the bug + fixes; Change Log entry; §5.3 gains "add meals via the add_meal tool".
- [ ] **Step 4: Commit** `docs: AGENTS.md — meal day-resolution fix`
