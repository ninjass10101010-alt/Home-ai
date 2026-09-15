// @vitest-environment jsdom
// Task 6 — Weekly Prize Race DB passthrough (weekly_prizes collection +
// hall_of_fame celebrated flag):
//  (a) server mode delegates straight to pb-db;
//  (b) browser mode rides the sessioned gateway with a rank-keyed upsert;
//  (c) the tasks-page snapshot restore adopts weekly prizes ONLY with a
//      strictly-NEWER stamp (same last-write-wins contract as the rewards
//      catalog) and carries the snapshot's stamp through VERBATIM (never
//      re-stamped "now");
//  (d) the snapshot POST body carries weeklyPrizes + weeklyPrizesStamp next to
//      the rewards legs;
//  (e) syncAllTasksToPB tolerates the legacy 6-arg call and pushes prizes when
//      the optional 7th arg is given.
//
// The gateway is observed at its transport seam (global fetch stub) — the
// db-client-mode pattern — which stays stable across vi.resetModules()
// re-imports (module-level mocks re-resolve behind the facade after a reset,
// stranding the assertion handles).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---- Hard isolation: no direct PocketBase access from the tested layer ----
vi.mock("@/lib/pb", () => ({
  getPB: vi.fn(() => {
    throw new Error("direct PB access is forbidden in db-weekly-prizes tests");
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

// ---- pb-db mocked as a Proxy over stable, shared per-method spies ----------
const pbSpy = vi.hoisted(() => {
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  return {
    of(name: string) {
      let fn = fns.get(name);
      if (!fn) {
        fn = vi.fn(async () => null);
        fns.set(name, fn);
      }
      return fn!;
    },
    clear() {
      for (const fn of fns.values()) fn.mockClear();
    },
  };
});
vi.mock("@/db/pb-db", () => ({
  db: new Proxy(
    {},
    {
      get: (_t, prop) => (typeof prop === "string" ? pbSpy.of(prop) : undefined),
    }
  ),
}));

// ---- tasks/page harness (mirrors rewards-delete-truth) ----------------------
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

import TasksPage from "@/app/tasks/page";
import * as taskUtils from "@/lib/task-utils";
import {
  WEEKLY_PRIZES_KEY,
  loadWeeklyPrizes,
  readWeeklyPrizesStamp,
  emptyWeekData,
  syncAllTasksToPB,
} from "@/lib/task-utils";
// New Task-6 exports may be absent pre-implementation; access via the module
// namespace so RED failures land as per-test Errors, not an import-time crash.
const syncWeeklyPrizesToPB = (taskUtils as any).syncWeeklyPrizesToPB as
  | ((prizes: any[]) => Promise<void>)
  | undefined;

// ---- Global fetch stub: /api/tasks/sync + the gateway-client transport -----
const server = vi.hoisted(() => ({ snapshot: null as any, posts: [] as any[] }));

// Per-test overridable gateway data/failure knobs (fields read at call time).
const routeData = {
  lists: {} as Record<string, any[]>,
  failCreate: null as null | ((collection: string, body: any) => boolean),
};

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(payload: any) {
  return { ok: true, status: 200, json: async () => payload };
}

// Assertion helpers over fetchMock.
const callsTo = (url: string, method = "GET") =>
  fetchMock.mock.calls.filter(
    ([u, i]: any[]) => String(u) === url && String(i?.method || "GET") === method
  );
const callsMatching = (urlPart: string) =>
  fetchMock.mock.calls.filter(([u]: any[]) => String(u).includes(urlPart));
const callBody = (call: any[]) => JSON.parse(String(call[1]?.body));

let activeRoot: Root | null = null;

async function renderTasksPage(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(TasksPage));
  });
  return el;
}

async function settle(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// The module-level hydrate IIFE in db/index fires gateway/pb calls at import
// time; loadFacade waits for it to drain, then scrubs recorded calls so each
// test asserts only on its own call.
async function loadFacade() {
  const facade = await import("@/db/index");
  await new Promise((r) => setTimeout(r, 0));
  pbSpy.clear();
  fetchMock.mockClear();
  return facade.db;
}

const PRIZES_LOCAL = [
  { id: "prize-1", rank: 1 as const, emoji: "🥇", text: "Old movie pick" },
];
const PRIZES_SNAP = [
  { id: "prize-1", rank: 1 as const, emoji: "🥇", text: "Pancakes for dinner" },
  { id: "prize-2", rank: 2 as const, emoji: "🥈", text: "Chooses dessert night" },
];
const T_OLD = "2026-08-31T00:00:00.000Z";
const T_NEW = "2026-09-07T00:00:00.000Z";
const T_NEWEST = "2026-09-14T00:00:00.000Z";

// task-utils stores stamps via saveJSON (JSON-encoded) under its private key.
const PRIZE_STAMP_KEY = "consuela-weekly-prizes-stamp";
function seedLocalPrizes(prizes: any[], stamp?: string) {
  localStorage.setItem(WEEKLY_PRIZES_KEY, JSON.stringify(prizes));
  if (stamp !== undefined) localStorage.setItem(PRIZE_STAMP_KEY, JSON.stringify(stamp));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = "";
  server.snapshot = null;
  server.posts = [];
  routeData.lists = {};
  routeData.failCreate = null;
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  fetchMock = vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    if (url.includes("/api/tasks/sync")) {
      if (method === "POST") {
        server.posts.push(JSON.parse(String(init.body)));
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: true, snapshot: server.snapshot });
    }
    // The sessioned gateway (/api/db/*) transport: list reads return
    // { items }, writes echo the raw row (gateway-client's shapes).
    if (url.startsWith("/api/db/")) {
      const [pathPart] = url.slice("/api/db/".length).split("?");
      const segments = pathPart.split("/").filter(Boolean);
      if (method === "GET" && segments.length === 1) {
        return jsonResponse({ items: routeData.lists[segments[0]] ?? [] });
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "POST" && segments.length === 1 && routeData.failCreate?.(segments[0], body)) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return jsonResponse({ id: segments[1] ?? "g-new", ...body });
    }
    return jsonResponse({ ok: true, items: [], members: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (activeRoot) {
    await act(async () => {
      activeRoot!.unmount();
    });
    activeRoot = null;
  }
});

describe("weekly prizes — db facade, server mode", () => {
  it("selectWeeklyPrizes delegates to pb-db (no gateway traffic)", async () => {
    vi.stubGlobal("window", undefined);
    const db = await loadFacade();
    pbSpy.of("selectWeeklyPrizes").mockResolvedValueOnce([{ id: "p1", rank: 1 }]);
    const rows = await db.selectWeeklyPrizes();
    expect(rows).toEqual([{ id: "p1", rank: 1 }]);
    expect(pbSpy.of("selectWeeklyPrizes")).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upsertWeeklyPrize delegates the rank-keyed payload to pb-db", async () => {
    vi.stubGlobal("window", undefined);
    const db = await loadFacade();
    const data = { rank: 2, emoji: "🥈", text: "Chooses dessert night" };
    await db.upsertWeeklyPrize(data);
    expect(pbSpy.of("upsertWeeklyPrize")).toHaveBeenCalledWith(data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updateHallOfFameEntry delegates (id, {celebrated}) to pb-db", async () => {
    vi.stubGlobal("window", undefined);
    const db = await loadFacade();
    await db.updateHallOfFameEntry("hof-1", { celebrated: true });
    expect(pbSpy.of("updateHallOfFameEntry")).toHaveBeenCalledWith("hof-1", { celebrated: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("weekly prizes — db facade, browser mode (sessioned gateway)", () => {
  it("selectWeeklyPrizes lists the weekly_prizes collection via the gateway", async () => {
    const db = await loadFacade();
    routeData.lists["weekly_prizes"] = [{ id: "p1", rank: 1, emoji: "🥇", text: "Movie" }];
    const rows = await db.selectWeeklyPrizes();
    expect(callsTo("/api/db/weekly_prizes", "GET")).toHaveLength(1);
    expect(rows).toEqual([{ id: "p1", rank: 1, emoji: "🥇", text: "Movie" }]);
    expect(pbSpy.of("selectWeeklyPrizes")).not.toHaveBeenCalled();
  });

  it("upsertWeeklyPrize updates the existing rank row instead of duplicating (rank = natural key)", async () => {
    const db = await loadFacade();
    routeData.lists["weekly_prizes"] = [{ id: "p2", rank: 2, emoji: "🥈", text: "Old dessert" }];
    const res = await db.upsertWeeklyPrize({ rank: 2, emoji: "🥈", text: "Dessert night" });
    const patches = callsTo("/api/db/weekly_prizes/p2", "PATCH");
    expect(patches).toHaveLength(1);
    expect(callBody(patches[0])).toEqual({ rank: 2, emoji: "🥈", text: "Dessert night" });
    expect(callsTo("/api/db/weekly_prizes", "POST")).toHaveLength(0);
    expect(res).toMatchObject({ id: "p2", text: "Dessert night" });
    expect(pbSpy.of("upsertWeeklyPrize")).not.toHaveBeenCalled();
  });

  it("upsertWeeklyPrize creates when no row exists for the rank", async () => {
    const db = await loadFacade();
    const res = await db.upsertWeeklyPrize({ rank: 1, emoji: "🥇", text: "Movie" });
    expect(callsTo("/api/db/weekly_prizes", "GET")).toHaveLength(1);
    const creates = callsTo("/api/db/weekly_prizes", "POST");
    expect(creates).toHaveLength(1);
    expect(callBody(creates[0])).toEqual({ rank: 1, emoji: "🥇", text: "Movie" });
    expect(callsMatching("/api/db/weekly_prizes/")).toHaveLength(0);
    expect(res).toMatchObject({ id: "g-new", rank: 1 });
  });

  it("updateHallOfFameEntry PATCHes the hall_of_fame row via the gateway", async () => {
    const db = await loadFacade();
    const res = await db.updateHallOfFameEntry("hof-9", { celebrated: true });
    const patches = callsTo("/api/db/hall_of_fame/hof-9", "PATCH");
    expect(patches).toHaveLength(1);
    expect(callBody(patches[0])).toEqual({ celebrated: true });
    expect(res).toMatchObject({ id: "hof-9", celebrated: true });
    expect(pbSpy.of("updateHallOfFameEntry")).not.toHaveBeenCalled();
  });
});

describe("tasks page — weekly prizes snapshot adopt (last-write-wins stamp)", () => {
  it("adopts a strictly-NEWER snapshot and writes the stamp through verbatim", async () => {
    seedLocalPrizes(PRIZES_LOCAL, T_OLD);
    server.snapshot = { tasks: [], weekData: null, weeklyPrizes: PRIZES_SNAP, weeklyPrizesStamp: T_NEW };

    await renderTasksPage();
    await settle();

    expect(loadWeeklyPrizes()).toEqual(PRIZES_SNAP);
    // The adopted stamp IS the snapshot's stamp — never a fresh "now" (a
    // re-stamped no-op would block the next real server edit).
    expect(readWeeklyPrizesStamp()).toBe(T_NEW);
  });

  it("rejects a snapshot with the SAME stamp", async () => {
    seedLocalPrizes(PRIZES_LOCAL, T_NEW);
    server.snapshot = { tasks: [], weekData: null, weeklyPrizes: PRIZES_SNAP, weeklyPrizesStamp: T_NEW };

    await renderTasksPage();
    await settle();

    expect(loadWeeklyPrizes()).toEqual(PRIZES_LOCAL);
    expect(readWeeklyPrizesStamp()).toBe(T_NEW);
  });

  it("rejects a snapshot with an OLDER stamp", async () => {
    seedLocalPrizes(PRIZES_LOCAL, T_NEWEST);
    server.snapshot = { tasks: [], weekData: null, weeklyPrizes: PRIZES_SNAP, weeklyPrizesStamp: T_NEW };

    await renderTasksPage();
    await settle();

    expect(loadWeeklyPrizes()).toEqual(PRIZES_LOCAL);
    expect(readWeeklyPrizesStamp()).toBe(T_NEWEST);
  });

  it("ignores a snapshot whose stamp is MISSING (legacy rows can't win)", async () => {
    seedLocalPrizes(PRIZES_LOCAL, T_OLD);
    server.snapshot = { tasks: [], weekData: null, weeklyPrizes: PRIZES_SNAP };

    await renderTasksPage();
    await settle();

    expect(loadWeeklyPrizes()).toEqual(PRIZES_LOCAL);
    expect(readWeeklyPrizesStamp()).toBe(T_OLD);
  });

  it("ignores a snapshot whose stamp is newer but weeklyPrizes is not an array", async () => {
    seedLocalPrizes(PRIZES_LOCAL, T_OLD);
    server.snapshot = { tasks: [], weekData: null, weeklyPrizes: null, weeklyPrizesStamp: T_NEW };

    await renderTasksPage();
    await settle();

    expect(loadWeeklyPrizes()).toEqual(PRIZES_LOCAL);
    expect(readWeeklyPrizesStamp()).toBe(T_OLD);
  });
});

describe("tasks page — snapshot POST body", () => {
  it("carries weeklyPrizes + weeklyPrizesStamp next to the rewards legs", async () => {
    seedLocalPrizes(PRIZES_SNAP, T_NEW);
    server.snapshot = { tasks: [], weekData: null };

    await renderTasksPage();
    // Past the 2s snapshot debounce.
    await settle(2300);

    const push = server.posts.find((p) => Array.isArray(p.tasks));
    expect(push).toBeTruthy();
    expect(push.weeklyPrizes).toEqual(PRIZES_SNAP);
    expect(push.weeklyPrizesStamp).toBe(T_NEW);
    // Legacy legs untouched by the new fields.
    expect(Array.isArray(push.rewards)).toBe(true);
    expect("rewardsUpdatedAt" in push).toBe(true);
  });
});

describe("syncAllTasksToPB — weekly prizes leg", () => {
  it("tolerates the legacy 6-arg call (weeklyPrizes defaults to empty — zero gateway traffic)", async () => {
    await expect(
      syncAllTasksToPB([], emptyWeekData(), {}, [], [], [])
    ).resolves.toBeUndefined();
    expect(callsMatching("weekly_prizes")).toHaveLength(0);
  });

  it("pushes every prize rank-keyed when the 7th arg is given", async () => {
    expect(syncWeeklyPrizesToPB).toBeDefined();
    await expect(
      syncAllTasksToPB([], emptyWeekData(), {}, [], [], [], PRIZES_SNAP)
    ).resolves.toBeUndefined();
    const creates = callsTo("/api/db/weekly_prizes", "POST");
    expect(creates).toHaveLength(PRIZES_SNAP.length);
    for (const prize of PRIZES_SNAP) {
      const create = creates.find((c) => callBody(c).rank === prize.rank);
      expect(create).toBeTruthy();
      expect(callBody(create!)).toEqual({ rank: prize.rank, emoji: prize.emoji, text: prize.text });
    }
  });

  it("a failing prize write is swallowed and does not block the rest", async () => {
    expect(syncWeeklyPrizesToPB).toBeDefined();
    routeData.failCreate = (_collection, body) => body.rank === 2;
    const three = [
      ...PRIZES_SNAP,
      { id: "prize-3", rank: 3 as const, emoji: "🥉", text: "+$2 allowance" },
    ];
    await expect(syncWeeklyPrizesToPB!(three as any)).resolves.toBeUndefined();
    expect(callsTo("/api/db/weekly_prizes", "POST")).toHaveLength(3);
  });
});
