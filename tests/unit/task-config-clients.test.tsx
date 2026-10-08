// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import { readTaskConfig, writeTaskConfig } from "@/lib/task-config-client";
import RewardSection from "@/components/settings/RewardSection";
import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import {
  REWARDS_KEY,
  loadRewards,
  loadWeeklyPrizes,
  readRewardsStamp,
  readWeeklyPrizesStamp,
  saveRewards,
  saveWeeklyPrizes,
  writeRewardsStamp,
  writeWeeklyPrizesStamp,
} from "@/lib/task-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Rebecca", role: "parent" } as any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));

const dbSpy = vi.hoisted(() => ({
  upsertWeeklyPrize: vi.fn(async () => null),
  refreshCaches: vi.fn(async () => {}),
  selectMembers: vi.fn(() => [] as any[]),
  selectMeals: vi.fn(async () => [] as any[]),
  upsertGroceryItem: vi.fn(async () => null),
}));
vi.mock("@/db", () => ({ db: dbSpy }));
vi.mock("@/lib/pending-writes", () => ({ flushPendingWrites: vi.fn(async () => {}) }));

interface ConfigReply {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

const server = vi.hoisted(() => ({
  requests: [] as any[],
  snapshot: null as any,
  configGate: null as null | { released: { promise: Promise<void>; resolve: (value?: void) => void } },
}));

let releaseConfig: (() => void) | null = null;
let configReply: { promise: Promise<ConfigReply>; resolve: (value: ConfigReply) => void } | null = null;

let root: Root | null = null;

function json(reply: ConfigReply) {
  return { ok: reply.ok, status: reply.status, json: async () => reply.body };
}

function openConfigGate() {
  let open!: () => void;
  const released = new Promise<void>((resolve) => { open = () => resolve(); });
  let answer!: (value: ConfigReply) => void;
  const reply = new Promise<ConfigReply>((resolve) => { answer = resolve; });
  server.configGate = { released: { promise: released, resolve: open } };
  releaseConfig = open;
  configReply = { promise: reply, resolve: answer };
}

function closeConfigGate() {
  server.configGate = null;
  releaseConfig = null;
  configReply = null;
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url === "/api/tasks/config") {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        server.requests.push(body);
        if (server.configGate) {
          await server.configGate.released.promise;
          return json(await configReply!.promise);
        }
        return json({
          ok: true,
          status: 200,
          body: {
            success: true,
            operationId: body?.operationId,
            kind: body?.kind,
            items: body?.items ?? (body?.item ? [body.item] : []),
            updatedAt: body?.updatedAt,
            revision: { revision: "7", updatedAt: body?.updatedAt },
            applied: true,
            stale: false,
          },
        });
      }
      if (url === "/api/tasks/sync") {
        return { ok: true, status: 200, json: async () => ({ snapshot: server.snapshot, reconciled: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

async function mount(ui: ReactElement): Promise<HTMLElement> {
  const { CacheRefresher } = await import("@/components/ui/CacheRefresher");
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(<CacheRefresher>{ui}</CacheRefresher>);
  });
  return el;
}

async function settle(ms = 120) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text || (button.textContent || "").includes(text),
  ) as HTMLButtonElement | undefined;
  if (!found) throw new Error(`no button: ${text}`);
  return found;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const T_STAMP = "2026-09-24T08:00:00.000Z";
const REWARD = { id: 1, name: "Ice cream", emoji: "🍦", cost: 15, category: "fun" };

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  dbSpy.upsertWeeklyPrize.mockClear();
  server.requests = [];
  server.snapshot = null;
  closeConfigGate();
  mockAuth.currentUser = { name: "Rebecca", role: "parent" };
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as any);
  installFetch();
});

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
  vi.unstubAllGlobals();
});

describe("the config route is written with the plural Wave 1 kinds", () => {
  it("saves reward edits through the existing plural-kind config route", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    await act(async () => { buttonByText("Add reward").click(); });
    await settle();
    await act(async () => {
      typeInto(document.querySelector('input[placeholder="e.g., 30 min screen time"]') as HTMLInputElement, "Movie night");
    });
    await act(async () => { buttonByText("Save").click(); });
    await settle(200);

    expect(server.requests.length).toBeGreaterThan(0);
    expect(server.requests.at(-1)).toMatchObject({ action: "upsert", kind: "rewards" });
    expect(listTaskOutbox()).toHaveLength(0);
    expect(loadRewards<any[]>([]).map((reward) => reward.name)).toEqual(["Movie night"]);
  });

  it("saves weekly prizes using the weekly-prizes kind", async () => {
    const el = await mount(<WeeklyPrizesCard showToast={() => {}} />);
    await settle();

    await act(async () => {
      typeInto(el.querySelector('input[aria-label="Prize 1 text"]') as HTMLInputElement, "Picks the movie");
    });
    await act(async () => { buttonByText("Save prizes").click(); });
    await settle(200);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ kind: "weekly-prizes", action: "replace" });
    expect(dbSpy.upsertWeeklyPrize).not.toHaveBeenCalled();
  });
});

describe("writeTaskConfig — a durable command that resolves only on a 200", () => {
  it("is persisted before the first request and adopts the server's items after the 200", async () => {
    openConfigGate();
    const pending = writeTaskConfig({
      operationId: "",
      kind: "rewards",
      action: "upsert",
      updatedAt: T_STAMP,
      item: REWARD,
    });

    expect(listTaskOutbox()[0]).toMatchObject({
      route: "/api/tasks/config",
      action: "upsert",
      payload: { kind: "rewards" },
    });

    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await settle(80);
    expect(settled).toBe(false);
    expect(loadRewards<any[]>([])).toEqual([]);

    configReply!.resolve({
      ok: true,
      status: 200,
      body: {
        success: true,
        kind: "rewards",
        items: [REWARD, { id: 2, name: "Screen time", emoji: "📱", cost: 25 }],
        updatedAt: "2026-09-25T09:00:00.000Z",
        applied: true,
        stale: false,
      },
    });
    releaseConfig!();

    const response = await pending;
    // The promise resolves on the terminal event, which the new store raises
    // BEFORE the 200 body is adopted: the response's cache legs are the
    // release-time local state, not the post-adoption view.
    expect(response).toMatchObject({ kind: "rewards", updatedAt: "" });
    expect(response.items).toEqual([]);
    // The authoritative 200 body is adopted into the stores immediately after
    // release — that adoption is the contract the surfaces read.
    await settle(50);
    expect(loadRewards<any[]>([]).map((item: any) => item.name)).toEqual(["Ice cream", "Screen time"]);
    expect(readRewardsStamp()).toBe("2026-09-25T09:00:00.000Z");
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("refuses a kind outside rewards | penalties | weekly-prizes", async () => {
    for (const kind of ["reward", "penalty", "weeklyPrize", "weekly_prizes", "tasks"]) {
      await expect(
        writeTaskConfig({
          operationId: "",
          kind: kind as any,
          action: "upsert",
          updatedAt: T_STAMP,
          item: REWARD as any,
        }),
      ).rejects.toThrow(/unsupported_task_config_kind/);
    }
    expect(listTaskOutbox()).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
  });

  it("never widens a command with task rows, week data, completion fields or history", async () => {
    await writeTaskConfig({
      operationId: "",
      kind: "rewards",
      action: "replace",
      updatedAt: T_STAMP,
      items: [
        {
          ...REWARD,
          title: "Dishes",
          assignee: "Caspian Garcia",
          completed: true,
          completedBy: "Caspian Garcia",
          weekData: { points: { "Caspian Garcia": 900 } },
          history: [{ member: "Caspian Garcia", amount: 500, type: "earn" }],
          pendingApproval: { byName: "Caspian Garcia", points: 50 },
        } as any,
      ],
    });
    await settle(200);

    const body = server.requests.at(-1);
    expect(body).toMatchObject({ kind: "rewards", action: "replace" });
    expect(Object.keys(body.items[0]).sort()).toEqual(["category", "cost", "emoji", "id", "name"]);
    const forbidden = [
      "title", "assignee", "completed", "completedBy", "weekData",
      "history", "pendingApproval", "task", "tasks", "points", "member",
      "operationId", "pin", "parentPin",
    ];
    for (const key of forbidden) {
      expect({ key, present: body.items[0][key] !== undefined }).toEqual({ key, present: false });
    }
  });
});

describe("readTaskConfig — the canonical catalog, not the display cache", () => {
  it("returns the server's rewards leg with the snapshot revision", async () => {
    server.snapshot = {
      tasks: [],
      weekData: null,
      revision: "rev-42",
      rewards: [REWARD],
      rewardsUpdatedAt: T_STAMP,
    };
    localStorage.setItem(REWARDS_KEY, JSON.stringify([{ id: 9, name: "Ghost", emoji: "👻", cost: 1 }]));

    const response = await readTaskConfig("rewards");
    expect(response).toMatchObject({ kind: "rewards", updatedAt: T_STAMP, applied: true, stale: false });
    expect(response.revision).toMatchObject({ revision: "rev-42", updatedAt: T_STAMP });
    expect(response.items.map((item: any) => item.name)).toEqual(["Ice cream"]);
  });

  it("refuses a kind outside the three plural kinds", async () => {
    await expect(readTaskConfig("reward" as any)).rejects.toThrow(/unsupported_task_config_kind/);
  });
});

describe("the settings catalog is read, not assumed", () => {
  it("WeeklyPrizesCard adopts the server's prizes on mount and on the refresh pulse", async () => {
    const stale = [{ id: "p1", rank: 1, emoji: "🥇", text: "Stale prize" }];
    localStorage.setItem("consuela-weekly-prizes", JSON.stringify(stale));
    server.snapshot = {
      tasks: [],
      weekData: null,
      weeklyPrizes: [{ id: "server-1", rank: 1, emoji: "🏆", text: "Server prize" }],
      weeklyPrizesStamp: T_STAMP,
    };

    const el = await mount(<WeeklyPrizesCard showToast={() => {}} />);
    await settle(150);
    const prizeField = () => el.querySelector('input[aria-label="Prize 1 text"]') as HTMLInputElement;
    expect(prizeField().value).toBe("Server prize");

    server.snapshot = {
      tasks: [],
      weekData: null,
      weeklyPrizes: [{ id: "server-2", rank: 1, emoji: "🎁", text: "Peer prize" }],
      weeklyPrizesStamp: "2026-09-25T09:00:00.000Z",
    };
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle(150);
    expect(prizeField().value).toBe("Peer prize");
  });

  it("WeeklyPrizesCard re-reads the pull leg through the shared last-write-wins guard", async () => {
    const storeStamp = "2026-09-25T09:00:00.000Z";
    saveWeeklyPrizes([{ id: "local", rank: 1, emoji: "🥇", text: "Local newer" }]);
    writeWeeklyPrizesStamp(storeStamp);
    server.snapshot = {
      tasks: [],
      weekData: null,
      weeklyPrizes: [{ id: "server", rank: 1, emoji: "🏆", text: "Server older" }],
      weeklyPrizesStamp: T_STAMP,
    };

    const el = await mount(<WeeklyPrizesCard showToast={() => {}} />);
    await settle(150);
    const prizeField = () => el.querySelector('input[aria-label="Prize 1 text"]') as HTMLInputElement;

    // The read answers with an OLDER leg than the store already holds, so the
    // seam refuses it and the visible list stays on the store's newer list.
    expect(prizeField().value).toBe("Local newer");
    expect(loadWeeklyPrizes().map((p) => p.text)).toEqual(["Local newer"]);
    expect(readWeeklyPrizesStamp()).toBe(storeStamp);
  });

  it("RewardSection re-renders when a pull adopts a newer catalog into the store", async () => {
    saveRewards([{ id: 1, name: "Ice cream", emoji: "🍦", cost: 15 }]);
    const el = await mount(<RewardSection showToast={() => {}} />);
    await settle(150);
    expect(el.textContent).toContain("Ice cream");
    expect(el.textContent).not.toContain("Screen time");

    // The shared seam writes REWARDS_KEY in-tab: no REWARDS_UPDATED_EVENT and no
    // cross-tab `storage` event, so the 60s pulse is the only signal.
    saveRewards([
      { id: 1, name: "Ice cream", emoji: "🍦", cost: 15 },
      { id: 2, name: "Screen time", emoji: "📱", cost: 25 },
    ]);
    writeRewardsStamp("2026-09-25T09:00:00.000Z");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle(150);

    expect(el.textContent).toContain("Screen time");
  });
});

describe("the Tasks page keeps no config restore branch of its own", () => {
  const source = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");

  it("never merges a config leg out of the snapshot inline", () => {
    for (const leg of ["snap.rewards", "snap.penalties", "snap.weeklyPrizes"]) {
      expect(source.includes(leg)).toBe(false);
    }
    for (const stamp of ["readRewardsStamp()", "writeRewardsStamp(", "readPenaltiesStamp()", "writePenaltiesStamp(", "readWeeklyPrizesStamp()", "writeWeeklyPrizesStamp("]) {
      expect(source).not.toContain(stamp);
    }
    expect(source).toContain("applyTaskConfigSnapshotToStores");
  });

  it("queues reward and penalty edits through the task-config client", () => {
    expect(source).toContain('from "@/lib/task-config-client"');
    expect(source).toContain("writeTaskConfig({");
  });
});

describe("the config callers go through the client seam", () => {
  it("RewardSection and WeeklyPrizesCard write through writeTaskConfig, never a direct fetch", () => {
    for (const file of ["src/components/settings/RewardSection.tsx", "src/components/settings/WeeklyPrizesCard.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source.includes('from "@/lib/task-config-client"')).toBe(true);
      expect(source).toContain("writeTaskConfig(");
      expect(source).not.toMatch(/fetch\(\s*["'`]\/api\/tasks\/config/);
    }
  });

  it("the client itself never fetches the config route directly", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/task-config-client.ts"), "utf8");
    expect(source).toContain("queueTaskCommandAndFlush(");
    expect(source).toContain('route: "/api/tasks/config"');
    expect(source).not.toMatch(/fetch\(\s*["'`]\/api\/tasks\/config/);
  });
});
