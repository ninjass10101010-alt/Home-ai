// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mealsRead: vi.fn(),
  schedulesRead: vi.fn(),
  insertedMeals: [] as any[],
  insertedSchedules: [] as any[],
  insertedEvents: [] as any[],
  grocery: 0,
  recipes: 0,
}));

vi.mock("@/db", () => ({
  db: {
    selectMealsAuthoritative: h.mealsRead,
    selectSchedulesAuthoritative: h.schedulesRead,
    insertMeal: async (meal: any) => {
      h.insertedMeals.push(meal);
      return { ...meal, id: "meal-new" };
    },
    insertSchedule: async (schedule: any) => {
      h.insertedSchedules.push(schedule);
      return { ...schedule, id: "schedule-new" };
    },
    upsertGroceryItem: async () => {
      h.grocery += 1;
      return { id: "grocery-new" };
    },
    upsertPantryItem: async () => ({ id: "pantry-new" }),
    upsertRecipe: async () => {
      h.recipes += 1;
      return { id: "recipe-new" };
    },
    insertEvent: async (event: any) => {
      h.insertedEvents.push(event);
      return { ...event, id: "event-new" };
    },
  },
}));

vi.mock("@/lib/task-utils", () => ({
  syncAllTasksToPB: async () => ({ pushed: 0, errors: 0 }),
  syncFamilyGoalToPB: async () => ({ pushed: 0, errors: 0 }),
}));

import { pushLocalToPB } from "@/lib/push-local-to-pb";

beforeEach(() => {
  localStorage.clear();
  h.mealsRead.mockReset().mockResolvedValue([]);
  h.schedulesRead.mockReset().mockResolvedValue([]);
  h.insertedMeals.length = 0;
  h.insertedSchedules.length = 0;
  h.insertedEvents.length = 0;
  h.grocery = 0;
  h.recipes = 0;
});

describe("pushLocalToPB authoritative reads", () => {
  it("records a meal read failure and performs no meal inserts without losing later outcomes", async () => {
    localStorage.setItem("consuela-grocery", JSON.stringify([{ name: "Milk" }]));
    localStorage.setItem("consuela-meals", JSON.stringify([{ name: "Soup", weekOf: "2026-09-21" }]));
    localStorage.setItem("consuela-recipes", JSON.stringify([{ name: "Bread" }]));
    h.mealsRead.mockRejectedValueOnce(new Error("meal read unavailable"));

    const results = await pushLocalToPB();

    expect(results.find((result) => result.collection === "grocery_list_items")).toMatchObject({ pushed: 1, errors: 0 });
    expect(results.find((result) => result.collection === "meal_plan_entries")).toMatchObject({ pushed: 0, errors: 1 });
    expect(results.find((result) => result.collection === "recipes")).toMatchObject({ pushed: 1, errors: 0 });
    expect(h.insertedMeals).toHaveLength(0);
    expect(h.grocery).toBe(1);
    expect(h.recipes).toBe(1);
  });

  it("records a schedule read failure and performs no schedule inserts", async () => {
    localStorage.setItem("consuela-schedules", JSON.stringify([{ title: "Dinner", time: "18:00", days: "daily" }]));
    h.schedulesRead.mockRejectedValueOnce(new Error("schedule read unavailable"));

    const results = await pushLocalToPB();

    expect(results.find((result) => result.collection === "schedules")).toMatchObject({ pushed: 0, errors: 1 });
    expect(h.insertedSchedules).toHaveLength(0);
  });

  it("excludes server-owned task, week, and goal state while pushing safe household data", async () => {
    localStorage.setItem("consuela-grocery", JSON.stringify([{ name: "Milk" }]));
    localStorage.setItem("consuela-tasks", JSON.stringify([{ id: 1, title: "Stale task" }]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: "2026-09-21", points: { Ghost: 999 } }));
    localStorage.setItem("consuela-family-goal", JSON.stringify({ title: "Stale goal" }));

    const results = await pushLocalToPB();

    expect(results.find((result) => result.collection === "grocery_list_items")).toMatchObject({ pushed: 1, errors: 0 });
    expect(results.some((result) => result.collection === "family data")).toBe(false);
    expect(results.some((result) => result.collection === "family_goals")).toBe(false);
  });

  it("excludes cached Google events while retaining family events", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: "g1", title: "Google event", member: "Google" },
      { id: "f1", title: "Family event", member: "Rebecca" },
    ]));

    const results = await pushLocalToPB();

    expect(results.find((result) => result.collection === "events")).toMatchObject({ pushed: 1, errors: 0 });
    expect(h.insertedEvents.map((event) => event.title)).toEqual(["Family event"]);
  });

  it("does not include legacy emergency contacts in the bulk push result", async () => {
    localStorage.setItem("consuela-emergency-contacts", JSON.stringify([{ name: "Deleted contact", isPrimary: true }]));

    const results = await pushLocalToPB();

    expect(results.some((result) => result.collection === "emergency_contacts")).toBe(false);
  });
});
