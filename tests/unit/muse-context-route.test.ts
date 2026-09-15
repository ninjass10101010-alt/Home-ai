// @vitest-environment node
//
// GET /api/muse/context (Task 10 / B3). The route is bearer-gated and serves a
// live ContextPack per scope (`meal` / `task` / `schedule`) or a merge of all
// three (`all`, also the default when `?scope` is absent).
//
// Seams are the same ones the existing muse + assistant-context tests use:
// @/lib/muse/store (auth row) and the live-reads/weather registries so
// loadContextPack's REAL zone wiring is exercised without PocketBase.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  readMuseRow: vi.fn(),
  touchMuseUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/muse/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/muse/store")>();
  return {
    ...actual,
    readMuseRow: mocks.readMuseRow,
    touchMuseUsage: mocks.touchMuseUsage,
  };
});

const readers = vi.hoisted(() => ({ current: {} as Record<string, any> }));

vi.mock("@/lib/consuela/live-reads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/consuela/live-reads")>();
  const delegate = (name: string) => (...args: any[]) => readers.current[name](...args);
  return {
    ...actual,
    liveMembers: delegate("liveMembers"),
    liveEventsRange: delegate("liveEventsRange"),
    liveMealRows: delegate("liveMealRows"),
    livePantry: delegate("livePantry"),
    liveGrocery: delegate("liveGrocery"),
    livePendingTasksForPack: delegate("livePendingTasksForPack"),
    liveRewards: delegate("liveRewards"),
    liveWeekArchive: delegate("liveWeekArchive"),
    liveSchedulesAll: delegate("liveSchedulesAll"),
  };
});

vi.mock("@/lib/weather-live", () => ({
  fetchLiveWeather: (...args: any[]) => readers.current.fetchLiveWeather(...args),
}));

import { GET as contextGET } from "@/app/api/muse/context/route";
import { generateKey } from "@/lib/muse/store";
import { signMuseToken } from "@/lib/muse/token";
import { __resetMuseLimits } from "@/lib/muse/ratelimit";

const SECRET = "test-secret-0123456789";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  __resetMuseLimits();
  mocks.readMuseRow.mockReset();
  mocks.touchMuseUsage.mockReset();
  mocks.touchMuseUsage.mockResolvedValue(undefined);
  readers.current = {
    liveMembers: vi.fn(async () => [{ fullName: "Emily G", role: "child", age: 14 }]),
    liveEventsRange: vi.fn(async () => ({ days: {} })),
    liveMealRows: vi.fn(async () => []),
    livePantry: vi.fn(async () => []),
    liveGrocery: vi.fn(async () => []),
    livePendingTasksForPack: vi.fn(async () => []),
    liveRewards: vi.fn(async () => []),
    liveWeekArchive: vi.fn(async () => []),
    liveSchedulesAll: vi.fn(async () => []),
    fetchLiveWeather: vi.fn(async () => ({ ok: false })),
  };
});

afterEach(() => vi.unstubAllEnvs());

function makeRow(overrides: Record<string, unknown> = {}) {
  const g = generateKey();
  const row = {
    id: "muse1",
    keyHash: g.keyHash,
    keyPrefix: g.keyPrefix,
    version: 1,
    enabled: true,
    adminEnabled: false,
    rateLimitPerMin: 120,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as any;
  mocks.readMuseRow.mockResolvedValue(row);
  return row;
}

function req(pathname: string, token?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": "1.2.3.4" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("GET /api/muse/context", () => {
  it("401s without a bearer token", async () => {
    makeRow();
    const res = await contextGET(req("/api/muse/context"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("scope=meal returns the meal zones + a composed prompt", async () => {
    makeRow();
    (readers.current.liveMealRows as any).mockResolvedValue([
      { time: "dinner", mealType: "dinner", name: "Tacos" },
    ]);
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await contextGET(req("/api/muse/context?scope=meal", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.scope).toBe("meal");
    expect(body.pack.meals.filled.join(" ")).toContain("Tacos");
    expect(body.pack.tasks).toBeUndefined();
    expect(body.pack.routines).toBeUndefined();
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt).toContain("Meal plan");
  });

  it("400s invalid_scope for an unknown scope", async () => {
    makeRow();
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await contextGET(req("/api/muse/context?scope=bogus", token));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_scope");
  });

  it("scope=all merges all three scopes into one pack with a non-empty prompt", async () => {
    makeRow();
    (readers.current.liveMealRows as any).mockResolvedValue([
      { time: "dinner", mealType: "dinner", name: "Tacos" },
    ]);
    (readers.current.livePendingTasksForPack as any).mockResolvedValue([
      { assigned: "Emily", due: "2000-01-01" },
    ]);
    (readers.current.liveSchedulesAll as any).mockResolvedValue([
      { title: "School run", time: "8:00 AM", days: "weekdays" },
    ]);
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await contextGET(req("/api/muse/context?scope=all", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("all");
    expect(body.pack.meals).toBeDefined();
    expect(body.pack.tasks).toBeDefined();
    expect(body.pack.routines).toBeDefined();
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt.length).toBeGreaterThan(0);
    // Zones from all three scopes actually contributed to the prompt.
    expect(body.prompt).toContain("Meal plan");
    expect(body.prompt).toContain("Pending tasks");
    expect(body.prompt).toContain("Family routines");
  });

  it("defaults a missing scope to all", async () => {
    makeRow();
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await contextGET(req("/api/muse/context", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("all");
    expect(body.pack.meals).toBeDefined();
  });
});
