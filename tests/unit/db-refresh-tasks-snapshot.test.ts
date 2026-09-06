// @vitest-environment jsdom
// The 60s refresh loop must actually feed the tasks/week_data stores —
// KidHome's dataVersion listener and Home's widgets re-read loadTasks()/
// loadWeekData() on `consuela-data-refreshed`, and before Fix-B nobody ever
// updated those stores from the server snapshot.
process.env.TZ = "UTC";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/pb", () => ({
  getPB: vi.fn(() => { throw new Error("direct PB access is forbidden in client tests"); }),
  getAdminPB: vi.fn(() => { throw new Error("direct admin PB access is forbidden in client tests"); }),
}));
vi.mock("@/lib/pb-auth", () => ({
  ensureAuth: vi.fn(async () => { throw new Error("ensureAuth must not run"); }),
  withAdmin: vi.fn(async () => { throw new Error("withAdmin must not run"); }),
}));

const PB_DB_METHODS = [
  "selectMembers", "selectTodaysEvents", "selectPendingTasks", "selectTodaysSchedulesRaw",
  "selectEmergencyContacts", "selectMeals", "selectPantry", "selectGrocery",
];
vi.mock("@/db/pb-db", () => {
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of PB_DB_METHODS) db[name] = vi.fn(async () => []);
  return { db };
});

let fetchMock: ReturnType<typeof vi.fn>;
let snapshotPayload: any;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  snapshotPayload = null;
  fetchMock = vi.fn(async (url: any) => {
    if (String(url).includes("/api/tasks/sync")) {
      if (!snapshotPayload) return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: null }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: snapshotPayload }) };
    }
    if (String(url).includes("/api/members/admin")) {
      return { ok: true, status: 200, json: async () => ({ members: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadDb() {
  const mod = await import("@/db/index");
  return mod.db;
}

describe("db.refreshCaches tasks/week_data pull", () => {
  it("reads /api/tasks/sync and merges the snapshot into the localStorage stores", async () => {
    const { saveTasks, saveWeekData, emptyWeekData, todayMondayISO } = await import("@/lib/task-utils");
    saveTasks([{ id: 1, title: "Dishes", assignee: "Alex", assigneeEmoji: "🦊", due: "2026-09-04", points: 5, recurring: null, category: "kitchen", completed: false, priority: "medium" } as any]);
    saveWeekData(emptyWeekData());

    snapshotPayload = {
      tasks: [{ id: 8, title: "Feed the fish", assigned: "Rebecca" }],
      weekData: {
        weekStart: todayMondayISO(),
        points: { Rebecca: 5 },
        streak: {},
        lastActive: {},
        history: [{ id: 1, timestamp: "t", member: "Rebecca", type: "earn", amount: 5, description: "fish" }],
      },
    };

    let refreshed = 0;
    const onRefreshed = () => { refreshed++; };
    window.addEventListener("consuela-data-refreshed", onRefreshed);

    const db = await loadDb();
    await db.refreshCaches();

    window.removeEventListener("consuela-data-refreshed", onRefreshed);
    expect(refreshed).toBe(1);

    const { loadTasks, loadWeekData } = await import("@/lib/task-utils");
    expect(loadTasks().map((t) => t.title)).toContain("Feed the fish");
    expect(loadWeekData().points.Rebecca).toBe(5);
  });

  it("a blocked (401) snapshot read leaves the local stores untouched and never throws", async () => {
    const { saveTasks, saveWeekData, emptyWeekData } = await import("@/lib/task-utils");
    saveTasks([{ id: 1, title: "Dishes", assignee: "Alex", assigneeEmoji: "🦊", due: "2026-09-04", points: 5, recurring: null, category: "kitchen", completed: false, priority: "medium" } as any]);
    saveWeekData(emptyWeekData());

    fetchMock.mockImplementation(async (url: any) => {
      if (String(url).includes("/api/tasks/sync")) {
        return { ok: false, status: 401, json: async () => ({ error: "unauthorized" }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    });

    const db = await loadDb();
    await expect(db.refreshCaches()).resolves.not.toThrow();

    const { loadTasks } = await import("@/lib/task-utils");
    expect(loadTasks().map((t) => t.title)).toEqual(["Dishes"]);
  });

  it("skips the snapshot fetch entirely on the server", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("fetch", fetchMock);
    const db = await loadDb();
    await db.refreshCaches();
    expect(fetchMock.mock.calls.every(([u]: unknown[]) => !String(u).includes("/api/tasks/sync"))).toBe(true);
  });
});
