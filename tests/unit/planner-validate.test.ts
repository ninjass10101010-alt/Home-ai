import { describe, it, expect } from "vitest";
import {
  validatePlannerOutput,
  isPlannerIntent,
  plannerMaxTokens,
  plannerSystemPrompt,
} from "@/lib/consuela/planner";
import type { ContextPack } from "@/lib/consuela/assistant-context";

const MINIMAL_PACK = {
  roster: [{ name: "Test Family", role: "parent" }],
  today: { iso: "2026-09-14", weekday: "Mon", yesterdayIso: "2026-09-13", weekStartISO: "2026-09-14", tz: "America/Detroit" },
  unavailable: [],
} as unknown as ContextPack;

describe("validatePlannerOutput", () => {
  it("accepts a clean meal_week plan", () => {
    const r = validatePlannerOutput("meal_week", JSON.stringify({ meal_plan: [{ day: "Mon", mealType: "dinner", name: "Tacos", emoji: "🌮", tags: ["Kid-friendly"], prepTime: "20 min" }] }));
    expect(r.ok).toBe(true);
  });
  it("drops invalid day/mealType entries, fails when nothing remains", () => {
    const r = validatePlannerOutput("meal_week", JSON.stringify({ meal_plan: [{ day: "Funday", mealType: "brunch", name: "X" }] }));
    expect(r.ok).toBe(false);
  });
  it("wraps fenced markdown JSON", () => {
    const r = validatePlannerOutput("task_ideas", '```json\n{"actions":[{"type":"task","title":"Fold laundry","assignee":"Emily","points":8}]}\n```');
    expect(r.ok && r.result.actions[0].title).toBe("Fold laundry");
  });
  it("rejects prose with no JSON", () => {
    expect(validatePlannerOutput("task_ideas", "Sure! I suggest chores:").ok).toBe(false);
  });
  it("schedule_week validates buffers", () => {
    const r = validatePlannerOutput("schedule_week", JSON.stringify({ conflicts: [], buffers: [{ title: "Drive to soccer", start: "2026-09-11T14:30", end: "2026-09-11T15:00" }], suggestions: ["Quiet Fri eve"] }));
    expect(r.ok && r.result.buffers.length).toBe(1);
  });

  it("meal_week keeps the valid subset when survivors stay ≥30%", () => {
    const entries = [
      { day: "Mon", mealType: "dinner", name: "Tacos" },
      { day: "Funday", mealType: "dinner", name: "Bogus" },
      { day: "Wed", mealType: "brunch", name: "Bogus" },
      { day: "Fri", mealType: "lunch", name: "Soup" },
    ];
    const r = validatePlannerOutput("meal_week", JSON.stringify({ meal_plan: entries }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.meal_plan.map((m: any) => m.name)).toEqual(["Tacos", "Soup"]);
  });
  it("meal_week fails when under 30% of entries survive", () => {
    const entries = [
      { day: "Mon", mealType: "dinner", name: "Keep" },
      ...Array.from({ length: 6 }, (_, i) => ({ day: `Nope${i}`, mealType: "brunch", name: `Drop${i}` })),
    ];
    expect(validatePlannerOutput("meal_week", JSON.stringify({ meal_plan: entries })).ok).toBe(false);
  });
  it("meal_week fails on an empty or missing meal_plan", () => {
    expect(validatePlannerOutput("meal_week", '{"meal_plan":[]}').ok).toBe(false);
    expect(validatePlannerOutput("meal_week", '{"actions":[]}').ok).toBe(false);
  });
  it("meal_week normalizes day/mealType casing", () => {
    const r = validatePlannerOutput("meal_week", JSON.stringify({ meal_plan: [{ day: "mon", mealType: "Dinner", name: "Pasta" }] }));
    expect(r.ok && r.result.meal_plan[0]).toMatchObject({ day: "Mon", mealType: "dinner" });
  });
  it("ideas intents require a title and drop out-of-range points", () => {
    const r = validatePlannerOutput("task_ideas", JSON.stringify({
      actions: [
        { type: "task", title: "Vacuum", points: 500 },
        { type: "task", title: "Dishes", points: 5 },
        { type: "task", title: "   " },
        { type: "chore", title: "Wrong type" },
      ],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.actions.map((a: any) => a.title)).toEqual(["Dishes"]);
  });
  it("ideas fail when nothing valid remains and shape is wrong", () => {
    expect(validatePlannerOutput("meal_ideas", '{"meal_plan":[{"day":"Mon"}]}').ok).toBe(false);
    expect(validatePlannerOutput("reward_ideas", '{"actions":[{"type":"reward"}]}').ok).toBe(false);
  });
  it("task_ideas passes open/crew modes through with clamped numbers", () => {
    const r = validatePlannerOutput("task_ideas", JSON.stringify({
      actions: [
        { type: "task", title: "Wash the car", mode: "open", speedBonus: 9, points: 10 },
        { type: "task", title: "Big cleanup", mode: "crew", crewSize: 9, points: 15 },
        { type: "task", title: "Bogus mode", mode: "whatever", points: 5 },
      ],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.actions[0]).toMatchObject({ mode: "open", speedBonus: 5 });
      expect(r.result.actions[1]).toMatchObject({ mode: "crew", crewSize: 5 });
      expect(r.result.actions[2].mode).toBeUndefined();
    }
  });
  it("meal_ideas accepts meal-typed actions with detail", () => {
    const r = validatePlannerOutput("meal_ideas", JSON.stringify({ actions: [{ type: "meal", title: "Sheet-pan gnocchi", detail: "One pan, 25 min", emoji: "🍝" }] }));
    expect(r.ok && r.result.actions[0].type).toBe("meal");
  });
  it("schedule_week fails when none of the expected arrays is present", () => {
    expect(validatePlannerOutput("schedule_week", '{"foo":[1,2]}').ok).toBe(false);
  });
  it("schedule_week defaults missing arrays and filters junk", () => {
    const r = validatePlannerOutput("schedule_week", JSON.stringify({
      suggestions: ["Move soccer to 5 PM", 42, ""],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.suggestions).toEqual(["Move soccer to 5 PM"]);
      expect(r.result.buffers).toEqual([]);
      expect(r.result.conflicts).toEqual([]);
    }
  });
  it("schedule_week drops buffers without parseable ISO times", () => {
    const r = validatePlannerOutput("schedule_week", JSON.stringify({
      buffers: [
        { title: "Good", start: "2026-09-11T14:30", end: "2026-09-11T15:00" },
        { title: "Bad start", start: "someday", end: "2026-09-11T15:00" },
        { title: "No end", start: "2026-09-11T14:30" },
      ],
    }));
    expect(r.ok && r.result.buffers.map((b: any) => b.title)).toEqual(["Good"]);
  });

  // --- Task 10 fold-ins (planner review fixes) -----------------------------

  it("meal_week dedupes repeated (day,mealType) slots FIRST-WINS", () => {
    const r = validatePlannerOutput("meal_week", JSON.stringify({
      meal_plan: [
        { day: "Mon", mealType: "dinner", name: "Winner" },
        { day: "Mon", mealType: "dinner", name: "Loser duplicate" },
        { day: "mon", mealType: "Dinner", name: "Loser case-variant duplicate" },
        { day: "Tue", mealType: "dinner", name: "Other" },
      ],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.meal_plan.map((m: any) => m.name)).toEqual(["Winner", "Other"]);
    }
  });

  it("isoParseable is a real ISO shape check, not new Date leniency", () => {
    const r = validatePlannerOutput("schedule_week", JSON.stringify({
      buffers: [
        { title: "Real ISO", start: "2026-09-11T14:30", end: "2026-09-11T15:00" },
        { title: "Space ISO", start: "2026-09-11 14:30", end: "2026-09-11 15:00" },
        // new Date("14:30") / new Date("2026-09-11") parse fine — the model
        // must still give a real local ISO TIME for the buffer to land.
        { title: "Clock only", start: "14:30", end: "15:00" },
        { title: "Date only", start: "2026-09-11", end: "2026-09-11" },
      ],
    }));
    expect(r.ok && r.result.buffers.map((b: any) => b.title)).toEqual(["Real ISO", "Space ISO"]);
  });

  it("schedule_week keeps conflicts only as {title,message} objects, cleaned", () => {
    const r = validatePlannerOutput("schedule_week", JSON.stringify({
      conflicts: [
        { title: "Soccer vs. dinner", message: "Overlap 6:00–6:30 PM" },
        { title: "Missing message" },
        { title: "  ", message: "Blank title is junk" },
        "just a string",
        42,
      ],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.conflicts).toEqual([{ title: "Soccer vs. dinner", message: "Overlap 6:00–6:30 PM" }]);
    }
  });

  it("schedule_week fails only when the whole payload is junk (empty conflicts stay ok)", () => {
    const r = validatePlannerOutput("schedule_week", '{"conflicts":[]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.conflicts).toEqual([]);
  });

  it("system prompts carry generic placeholders — no real family names, no concrete dates", () => {
    const task = plannerSystemPrompt("task_ideas", MINIMAL_PACK);
    const reward = plannerSystemPrompt("reward_ideas", MINIMAL_PACK);
    const schedule = plannerSystemPrompt("schedule_week", MINIMAL_PACK);
    expect(task).not.toMatch(/"assignee":"Emily"/);
    expect(task).toMatch(/"assignee":"<roster member>"/);
    expect(reward).not.toMatch(/"assignee":"Caspian"/);
    expect(reward).toMatch(/"assignee":"<roster member>"/);
    expect(schedule).not.toMatch(/2026-09-11/);
  });
});

describe("planner registry", () => {
  it("recognizes the five intents only", () => {
    for (const i of ["meal_week", "meal_ideas", "task_ideas", "reward_ideas", "schedule_week"]) {
      expect(isPlannerIntent(i)).toBe(true);
    }
    expect(isPlannerIntent("grocery_week")).toBe(false);
    expect(isPlannerIntent("")).toBe(false);
  });
  it("budgets meal_week above the others", () => {
    expect(plannerMaxTokens("meal_week")).toBe(4096);
    expect(plannerMaxTokens("task_ideas")).toBe(1536);
    expect(plannerMaxTokens("schedule_week")).toBe(1536);
  });
});
