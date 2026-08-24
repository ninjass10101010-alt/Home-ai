// @vitest-environment jsdom
// Task 7 — db/index.ts dual-mode: every export that reaches pb-db must go
// through the sessioned gateway (/api/db/*) when running in the browser, and
// must keep calling pb-db unchanged on the server.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hard isolation: any accidental direct PocketBase access explodes loudly.
vi.mock("@/lib/pb", () => ({
  getPB: vi.fn(() => {
    throw new Error("direct PB access is forbidden in db-client-mode tests");
  }),
  getAdminPB: vi.fn(() => {
    throw new Error("direct admin PB access is forbidden in db-client-mode tests");
  }),
}));
vi.mock("@/lib/pb-auth", () => ({
  ensureAuth: vi.fn(async () => {
    throw new Error("ensureAuth must not run");
  }),
  withAdmin: vi.fn(async () => {
    throw new Error("withAdmin must not run");
  }),
}));

const PB_DB_METHODS = [
  "selectMembers", "selectMembersDetailed", "selectMembersForCalendar",
  "insertMember", "updateMember", "verifyMemberPin", "deleteMember",
  "selectTodaysEvents", "insertEvent", "updateEvent", "deleteEvent",
  "insertSchedule", "updateSchedule", "deleteSchedule",
  "insertTask", "updateTask", "deleteTask", "selectPendingTasks",
  "selectTodaysSchedulesRaw", "selectTodaysSchedules",
  "selectEmergencyContacts", "insertEmergencyContact", "updateEmergencyContact", "deleteEmergencyContact",
  "selectMeals", "insertMeal", "updateMeal", "deleteMeal",
  "selectPantry", "upsertPantryItem", "deletePantryItem",
  "selectGrocery", "upsertGroceryItem", "toggleGroceryOverride", "deleteGroceryItem",
  "selectSchedules", "selectAllTasks", "upsertTask", "deleteTaskByTaskId",
  "getWeekData", "upsertWeekData", "archiveWeek", "listArchivedWeeks",
  "selectRewards", "upsertReward", "deleteReward",
  "selectPenalties", "upsertPenalty", "deletePenalty",
  "getActiveFamilyGoal", "upsertFamilyGoal",
  "insertHallOfFameEntry", "selectHallOfFame",
  "selectRecipes", "upsertRecipe", "deleteRecipe",
  "selectMealWeekArchives", "upsertMealWeekArchive", "deleteMealWeekArchive",
  "insertProactiveSuggestions", "selectPendingSuggestions", "updateSuggestion", "deleteStaleSuggestions",
  "upsertMorningBriefing", "selectMorningBriefing", "ackMorningBriefing",
  "insertChatMessage", "selectChatMessages",
  "getState", "setState",
];

vi.mock("@/db/pb-db", () => {
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of PB_DB_METHODS) db[name] = vi.fn(async () => null);
  return { db };
});

let fetchMock: ReturnType<typeof vi.fn>;

async function loadDb() {
  const mod = await import("@/db/index");
  const pb = (await import("@/db/pb-db")).db;
  return { mod: mod.db, pb };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ items: [], id: "g1" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("db/index client mode (browser)", () => {
  it("routes grocery writes through the gateway fetch path, not pb-db", async () => {
    const { mod, pb } = await loadDb();
    await mod.upsertGroceryItem({ name: "Eggs", category: "dairy" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/db/grocery_list_items",
      expect.objectContaining({ method: "POST" })
    );
    expect(pb.upsertGroceryItem).not.toHaveBeenCalled();
  });

  it("routes reads through gatewayList", async () => {
    const { mod, pb } = await loadDb();
    await mod.selectGrocery();
    expect(fetchMock).toHaveBeenCalledWith("/api/db/grocery_list_items");
    expect(pb.selectGrocery).not.toHaveBeenCalled();
  });

  it("maps meal rows through the same ingredients/tags parsing as pb-db", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { id: "m1", name: "Pasta", ingredients: '[{"name":"noodles"}]', tags: '["dinner"]' },
        ],
      }),
    }));
    const { mod } = await loadDb();
    const meals = await mod.selectMeals();
    expect(meals[0].ingredients).toEqual([{ name: "noodles" }]);
    expect(meals[0].tags).toEqual(["dinner"]);
  });

  it("upsertTask updates an existing row by taskId instead of duplicating", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (!init) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: "t1", taskId: 42, title: "Old" }] }),
        };
      }
      return { ok: true, json: async () => ({ id: "t1", taskId: 42, title: "New" }) };
    });
    const { mod, pb } = await loadDb();
    await mod.upsertTask({ taskId: 42, title: "New" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/db/tasks/t1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(pb.upsertTask).not.toHaveBeenCalled();
  });
});

describe("db/index server mode", () => {
  it("still calls pb-db unchanged when window is undefined", async () => {
    vi.stubGlobal("window", undefined);
    vi.resetModules();
    const { mod, pb } = await loadDb();
    (pb.selectGrocery as ReturnType<typeof vi.fn>).mockClear(); // drop the import-time hydrate call
    (pb.selectGrocery as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: "g9" }]);
    const rows = await mod.selectGrocery();
    expect(pb.selectGrocery).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ id: "g9" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
