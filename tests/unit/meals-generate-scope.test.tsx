// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useEffect } from "react";

const h = vi.hoisted(() => ({
  meals: [] as any[],
  pantry: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    gatewayReadStatus: async (collection: string) =>
      collection === "meal_plan_entries"
        ? { items: h.meals.map((m) => ({ ...m })), blocked: false }
        : { items: [], blocked: false },
    selectMeals: async () => h.meals.map((m) => ({ ...m })),
    selectPantry: async () => h.pantry,
    insertMeal: async (meal: any) => { h.meals.push({ ...meal }); return { ...meal }; },
    deleteMeal: async (id: string) => {
      const idx = h.meals.findIndex((m) => String(m.id) === id);
      if (idx === -1) return false;
      h.meals.splice(idx, 1);
      return true;
    },
    mealsStore: h.meals,
  },
}));

import { useMeals } from "@/hooks/useMeals";

let result: any;
function Harness() {
  const m = useMeals();
  useEffect(() => { result = m; });
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

let lastBody: any = null;
function stubFetch(content: string) {
  lastBody = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: any, opts: any) => {
    lastBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content }) };
  }));
}

const entry = (day: string, mealType: string, name: string) =>
  ({ day, mealType, name, emoji: "🍳", tags: [], prepTime: "20 min" });

beforeEach(() => {
  h.meals = [];
  h.pantry = [];
  localStorage.clear();
  result = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("generateWeeklyPlan day scope", () => {
  it("day scope: prompts for the single day and inserts only that day's meals", async () => {
    await mount();
    stubFetch(JSON.stringify({
      meal_plan: [entry("Wed", "breakfast", "Oats"), entry("Thu", "dinner", "Tacos"), entry("Fri", "lunch", "Subs")],
    }));
    await act(async () => { await result.generateWeeklyPlan("2026-09-01", false, ["Wed"]); });
    expect(lastBody.message).toContain("Wednesday only");
    expect(lastBody.message).not.toContain("complete week");
    const names = h.meals.map((m) => m.name);
    expect(names).toEqual(["Oats"]);
    expect(h.meals[0].time).toBe("Wed");
    expect(h.meals[0].weekOf).toBe("2026-09-01");
  });

  it("week mode unchanged: prompts for the full week and inserts every returned day", async () => {
    await mount();
    stubFetch(JSON.stringify({
      meal_plan: [entry("Wed", "dinner", "Tacos"), entry("Thu", "dinner", "Curry")],
    }));
    await act(async () => { await result.generateWeeklyPlan("2026-09-01", false); });
    expect(lastBody.message).toContain("complete week");
    expect(h.meals.map((m) => m.name).sort()).toEqual(["Curry", "Tacos"]);
  });

  it("day scope still skips slots already planned that day", async () => {
    h.meals.push({ id: 99, name: "Planned Dinner", time: "Wed", mealType: "dinner", weekOf: "2026-09-01" });
    await mount();
    stubFetch(JSON.stringify({
      meal_plan: [entry("Wed", "dinner", "AI Dinner"), entry("Wed", "breakfast", "Pancakes")],
    }));
    await act(async () => { await result.generateWeeklyPlan("2026-09-01", false, ["Wed"]); });
    const names = h.meals.map((m) => m.name);
    expect(names).toContain("Planned Dinner");
    expect(names).not.toContain("AI Dinner");
    expect(names).toContain("Pancakes");
  });
});
