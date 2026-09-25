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

const LEDGER_ERROR = ["task", "ledger", "write", "requires", "command"].join("_");

let fetchMock: ReturnType<typeof vi.fn>;

async function loadDb() {
  const mod = await import("@/db/index");
  const pb = (await import("@/db/pb-db")).db;
  return { mod: mod.db, pb, ledgerError: mod.TASK_LEDGER_WRITE_ERROR };
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

  it("archiveWeek refuses the browser with the stable task-ledger error", async () => {
    const { mod, ledgerError } = await loadDb();
    expect(ledgerError).toBe(LEDGER_ERROR);
    fetchMock.mockClear();
    await expect(
      mod.archiveWeek({ weekStart: "2026-08-31", points: { A: 42 } })
    ).rejects.toThrow(LEDGER_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("every browser task/week/archive write refuses with the stable error", async () => {
    const { mod, pb, ledgerError } = await loadDb();
    expect(ledgerError).toBe(LEDGER_ERROR);
    fetchMock.mockClear();
    await expect(mod.upsertTask({ taskId: 42, title: "New" })).rejects.toThrow(LEDGER_ERROR);
    await expect(mod.insertTask({ title: "New" })).rejects.toThrow(LEDGER_ERROR);
    await expect(mod.updateTask("t1", { title: "New" })).rejects.toThrow(LEDGER_ERROR);
    await expect(mod.deleteTask("t1")).rejects.toThrow(LEDGER_ERROR);
    await expect(mod.deleteTaskByTaskId(42)).rejects.toThrow(LEDGER_ERROR);
    await expect(mod.upsertWeekData({ weekStart: "2026-08-31" })).rejects.toThrow(LEDGER_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pb.upsertTask).not.toHaveBeenCalled();
    expect(pb.insertTask).not.toHaveBeenCalled();
    expect(pb.updateTask).not.toHaveBeenCalled();
    expect(pb.deleteTask).not.toHaveBeenCalled();
    expect(pb.deleteTaskByTaskId).not.toHaveBeenCalled();
    expect(pb.upsertWeekData).not.toHaveBeenCalled();
    expect(pb.archiveWeek).not.toHaveBeenCalled();
  });

  it("the refusal carries the stable code, not a message-shaped free string", async () => {
    const { mod } = await loadDb();
    const error = await mod.upsertWeekData({ weekStart: "2026-08-31" }).catch((e: any) => e);
    expect(error.code).toBe(LEDGER_ERROR);
    expect(error.message).toBe(LEDGER_ERROR);
  });

  it("task/week/archive READS still ride the gateway", async () => {
    const { mod } = await loadDb();
    fetchMock.mockClear();
    await mod.selectAllTasks();
    await mod.getWeekData("2026-08-31");
    await mod.listArchivedWeeks();
    const urls = fetchMock.mock.calls.map(([u]: unknown[]) => String(u));
    expect(urls.some((u) => u.startsWith("/api/db/tasks"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/db/week_data"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/db/week_archive"))).toBe(true);
  });

  // MF-2 — the browser members cache must refresh via the sessioned
  // sanitized roster route; pbDb.selectMembers() 403s under locked rules.
  it("refreshes the members cache via GET /api/members/admin, not pb-db", async () => {
    fetchMock.mockImplementation(async (url: any) => {
      if (String(url).includes("/api/members/admin")) {
        return {
          ok: true,
          json: async () => ({ members: [{ id: "m9", name: "Rebecca", role: "parent", emoji: "🐱" }] }),
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });
    const { mod, pb } = await loadDb();
    await mod.refreshCaches();

    const called = fetchMock.mock.calls.some(([u]: unknown[]) => String(u).includes("/api/members/admin"));
    expect(called).toBe(true);
    expect(pb.selectMembers).not.toHaveBeenCalled();
    const names = mod.selectMembers().map((m: any) => m.name);
    expect(names).toContain("Rebecca");
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

  it("server-side task/week/archive writers still delegate to pb-db", async () => {
    vi.stubGlobal("window", undefined);
    vi.resetModules();
    const { mod, pb } = await loadDb();
    (pb.insertTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (pb.updateTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (pb.deleteTask as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (pb.upsertTask as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "s2" });
    (pb.deleteTaskByTaskId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (pb.upsertWeekData as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "w1" });
    (pb.archiveWeek as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1" });

    await mod.insertTask({ title: "Dishes" });
    await mod.upsertTask({ taskId: 42, title: "Dishes" });
    await mod.updateTask("s1", { title: "Dishes" });
    await mod.deleteTask("s1");
    await mod.deleteTaskByTaskId(42);
    await mod.upsertWeekData({ weekStart: "2026-08-31" });
    await mod.archiveWeek({ weekStart: "2026-08-31" });

    const spies = pb as unknown as Record<string, ReturnType<typeof vi.fn>>;
    for (const name of [
      "insertTask", "upsertTask", "updateTask", "deleteTask",
      "deleteTaskByTaskId", "upsertWeekData", "archiveWeek",
    ]) {
      expect({ name, called: spies[name].mock.calls.length > 0 }).toEqual({ name, called: true });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
