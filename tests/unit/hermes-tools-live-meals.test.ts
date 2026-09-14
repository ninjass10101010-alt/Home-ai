// Live meal/recipe/member reads (2026-09-10): get_weekly_meals / get_recipes /
// get_dashboard_summary read PROCESS-START caches (db.selectMeals) and
// get_recipes never touched the real `recipes` collection. get_pantry
// fabricated 9 fake items on an empty pantry. These must read PB live and
// answer honestly. Red-proofs: db.selectMeals throws, fake pantry gone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rows: Record<string, any[]> = {};
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => rows[name] ?? [],
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (_id: string, d: any) => ({ id: _id, ...d }),
      create: async (d: any) => ({ id: "n1", ...d }),
      delete: async () => true,
    }),
  })),
}));
vi.mock("@/db", () => ({
  db: {
    selectMeals: () => { throw new Error("STALE CACHE READ — must use live reads"); },
    selectRecipes: () => { throw new Error("STALE CACHE READ — must use live reads"); },
    selectMembers: () => { throw new Error("STALE CACHE READ — must use live reads"); },
    selectPantry: async () => [],
    selectGrocery: async () => [],
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedulesRaw: () => [],
    selectPendingSuggestions: async () => [],
    updateSuggestion: async () => true,
    insertChatMessage: async () => true,
  },
}));
import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  vi.useFakeTimers({ now: new Date("2026-09-10T12:00:00") }); // Thu, week of 2026-09-07
});
afterEach(() => vi.useRealTimers());

describe("get_weekly_meals — live read", () => {
  it("returns this week's meals from PB, respecting the legacy weekless convention", async () => {
    rows.meal_plan_entries = [
      { name: "Tacos", time: "Thu", mealType: "dinner", weekOf: "2026-09-07", emoji: "🌮", tags: JSON.stringify([]) },
      { name: "Legacy Row", time: "Fri", mealType: "dinner", emoji: "🍕", tags: "[]" }, // weekless = current week
      { name: "Old Week", time: "Mon", mealType: "dinner", weekOf: "2026-08-31", tags: "[]" },
    ];
    const out = JSON.parse(await getTool("get_weekly_meals")!.handler({}));
    const days = out.days as Record<string, any[]>;
    expect(days.Thu[0].name).toBe("Tacos");
    expect(days.Fri[0].name).toBe("Legacy Row");
    expect(days.Mon).toBeUndefined();
    expect(out.today).toContain("2026-09-10");
    expect(out.current_week_monday).toBe("2026-09-07");
  });
  it("PB failure degrades to empty days + unavailable signal, never stale cache", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked((await import("@/lib/pb-auth")).withAdmin).mockRejectedValueOnce(new Error("PB down"));
    const out = JSON.parse(await getTool("get_weekly_meals")!.handler({}));
    expect(out.days).toEqual({});
    expect(String(out.error || "")).toContain("unavailable");
    spy.mockRestore();
  });
});

describe("get_recipes — real recipes collection", () => {
  it("answers from the PB recipes catalog", async () => {
    rows.recipes = [{ name: "Chicken Curry", tags: JSON.stringify(["Healthy"]), ingredients: JSON.stringify(["chicken"]), prepTime: "40 min", servings: 6, calories: 500 }];
    rows.meal_plan_entries = [];
    const out = JSON.parse(await getTool("get_recipes")!.handler({}));
    const names = out.map ? out.map((r: any) => r.name) : out.recipes?.map((r: any) => r.name);
    expect(JSON.stringify(out)).toContain("Chicken Curry");
    void names;
  });
});

describe("get_pantry — no fabricated inventory", () => {
  it("empty pantry returns zero items, not the fake 9-item fallback", async () => {
    rows.pantry_items = [];
    (await import("@/db")).db.selectPantry = async () => [];
    const out = JSON.parse(await getTool("get_pantry")!.handler({}));
    expect(out.total).toBe(0);
    expect(JSON.stringify(out)).not.toContain("Olive oil");
    expect(JSON.stringify(out)).not.toContain("Black pepper");
  });
  it("reads live PB rows", async () => {
    rows.pantry_items = [{ name: "Soy sauce", status: "out" }];
    const out = JSON.parse(await getTool("get_pantry")!.handler({}));
    expect(JSON.stringify(out)).toContain("Soy sauce");
    expect(out.total).toBe(1);
  });
});

describe("get_dashboard_summary — live meals", () => {
  it("includes today's meals from the live read", async () => {
    rows.meal_plan_entries = [{ name: "Soup", time: "Thu", mealType: "dinner", weekOf: "2026-09-07", tags: "[]" }];
    rows.events = []; rows.consuela_google_calendar_events = []; rows.tasks = []; rows.members = [];
    const out = JSON.parse(await getTool("get_dashboard_summary")!.handler({}));
    expect(out.meals_today[0].name).toBe("Soup");
  });
});

describe("get_family_members — live roster", () => {
  it("reflects live PB members with text-safe emojis", async () => {
    rows.members = [{ name: "New Kid", fullName: "New Kid", role: "child", emoji: "data:image/webp;base64,AAAA" }];
    const out = JSON.parse(await getTool("get_family_members")!.handler({}));
    expect(JSON.stringify(out)).toContain("New Kid");
    expect(JSON.stringify(out)).not.toContain("base64");
  });
});
