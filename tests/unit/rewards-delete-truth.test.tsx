// @vitest-environment jsdom
// Fix-A finding 3 — Settings reward deletes must be TRUE.
// The Tasks page's snapshot restore used a "longer list wins" heuristic,
// which is delete-blind: a parent's delete is a SHORTER, NEWER list, so a
// stale snapshot (or another device's re-push) resurrected the reward on the
// next Tasks mount / 60s tick. The leg now merges by last-write-wins on the
// kid-store rewards stamp, and the snapshot push carries rewards + stamp.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import TasksPage from "@/app/tasks/page";
import RewardSection from "@/components/settings/RewardSection";
import { PENALTIES_KEY, REWARDS_KEY, loadPenalties, loadRewards } from "@/lib/task-utils";
import { REWARDS_STAMP_KEY } from "@/modes/kid/kid-store";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
const mockMembers = vi.hoisted(() => ({ current: [] as any[] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "selectMembers" || prop === "selectMembersFallback") return () => mockMembers.current;
        if (prop === "listArchivedWeeks") return async () => [];
        if (prop === "upsertTask" || prop === "upsertWeekData" || prop === "archiveWeek") {
          return async (data: any) => {
            server.dbWrites.push({ method: String(prop), data });
            return data;
          };
        }
        return async () => null;
      },
    }
  ),
}));

// The server snapshot is mutable test state; POSTs are recorded, not applied.
const server = vi.hoisted(() => ({
  snapshot: null as any,
  posts: [] as any[],
  dbWrites: [] as Array<{ method: string; data: any }>,
  fetchMock: null as ReturnType<typeof vi.fn> | null,
  configFailure: null as null | "network" | "502",
}));

let activeRoot: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

async function settle(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const A = { id: 1, name: "Ice cream", emoji: "🍦", cost: 15 };
const B = { id: 2, name: "Screen time", emoji: "📱", cost: 25 };
const C = { id: 3, name: "Movie night", emoji: "🎬", cost: 50 };

const T_OLD = "2026-08-31T00:00:00.000Z";
const T_NEW = "2026-09-02T00:00:00.000Z";
const T_NEWER = "2026-09-03T00:00:00.000Z";

describe("Rewards delete truth — snapshot restore must not resurrect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    server.posts = [];
    server.dbWrites = [];
    server.fetchMock = null;
    server.configFailure = null;
    server.snapshot = null;
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
    mockMembers.current = [];
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    server.fetchMock = vi.fn(async (input: any, init?: any) => {
        if (String(input) === "/api/tasks/config") {
          if (server.configFailure === "network") throw new TypeError("network unavailable");
          if (server.configFailure === "502") {
            return {
              ok: false,
              status: 502,
              json: async () => ({ error: "config_store_unreachable" }),
            };
          }
          const command = JSON.parse(String(init?.body));
          let items = command.kind === "penalties"
            ? loadPenalties<any[]>([])
            : loadRewards<any[]>([]);
          if (command.action === "replace") items = command.items;
          if (command.action === "upsert") {
            items = items.some((item) => String(item.id) === String(command.item.id))
              ? items.map((item) => String(item.id) === String(command.item.id) ? command.item : item)
              : [...items, command.item];
          }
          if (command.action === "delete") {
            items = items.filter((item) => String(item.id) !== String(command.itemId));
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              operationId: command.operationId,
              kind: command.kind,
              items,
              updatedAt: command.updatedAt,
              revision: { revision: "2", updatedAt: command.updatedAt },
              applied: true,
            }),
          };
        }
        if (String(input).includes("/api/tasks/sync")) {
          if (String(init?.method || "GET").toUpperCase() === "POST") {
            server.posts.push(JSON.parse(String(init.body)));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: server.snapshot }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", server.fetchMock);
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

  it("a Settings delete (shorter, NEWER list) survives a stale longer snapshot", async () => {
    // Parent deleted C in Settings: local [A,B] stamped T_NEW.
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A, B]));
    localStorage.setItem(REWARDS_STAMP_KEY, T_NEW);
    // The server snapshot still holds the pre-delete [A,B,C] with an OLDER stamp.
    server.snapshot = { tasks: [], weekData: null, rewards: [A, B, C], rewardsUpdatedAt: T_OLD };

    await renderAsync(<TasksPage />);
    await settle();

    // RED on the old "longer wins" leg (3 > 2 → C resurrected → written back).
    expect(loadRewards<any[]>([]).map((r) => r.name)).toEqual(["Ice cream", "Screen time"]);
    expect(localStorage.getItem(REWARDS_STAMP_KEY)).toBe(T_NEW);
  });

  it("a NEWER server snapshot still propagates (cross-device adds work)", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A]));
    localStorage.setItem(REWARDS_STAMP_KEY, T_OLD);
    server.snapshot = { tasks: [], weekData: null, rewards: [A, B, C], rewardsUpdatedAt: T_NEW };

    await renderAsync(<TasksPage />);
    await settle();

    expect(loadRewards<any[]>([]).map((r) => r.name)).toEqual(["Ice cream", "Screen time", "Movie night"]);
    // The adopted stamp carries through (not "now") — the list is this
    // device's truth AS OF the server stamp.
    expect(localStorage.getItem(REWARDS_STAMP_KEY)).toBe(T_NEW);
  });

  it("a legacy snapshot with rewards but NO stamp never wins (delete-safe)", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A, B]));
    localStorage.setItem(REWARDS_STAMP_KEY, T_NEW);
    server.snapshot = { tasks: [], weekData: null, rewards: [A, B, C] };

    await renderAsync(<TasksPage />);
    await settle();

    expect(loadRewards<any[]>([]).map((r) => r.name)).toEqual(["Ice cream", "Screen time"]);
  });

  it("the snapshot push carries the rewards list WITH its stamp", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A, B]));
    localStorage.setItem(REWARDS_STAMP_KEY, T_NEW);
    server.snapshot = { tasks: [], weekData: null, rewards: [], rewardsUpdatedAt: T_NEW };

    await renderAsync(<TasksPage />);
    // Past the 2s snapshot debounce.
    await settle(2300);

    const push = server.posts.find((p) => Array.isArray(p.rewards));
    expect(push).toBeTruthy();
    expect(push.rewards.map((r: any) => r.name)).toEqual(["Ice cream", "Screen time"]);
    expect(push.rewardsUpdatedAt).toBe(T_NEW);
  });

  it("saves a Tasks-page reward through the config route", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    mockAuth.isLoggedIn = true;
    mockMembers.current = [{ id: "parent-1", name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "#22c55e" }];
    server.snapshot = { tasks: [], weekData: null };

    await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Leaderboard")) as HTMLButtonElement;
    expect(leaderboard).toBeTruthy();
    act(() => { leaderboard.click(); });
    await settle();

    const heading = Array.from(document.querySelectorAll("h2, h3"))
      .find((element) => element.textContent === "Rewards")!;
    const card = heading.closest(".widget-card") as HTMLElement;
    const add = Array.from(card.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Add") as HTMLButtonElement;
    act(() => { add.click(); });
    const input = document.querySelector('input[placeholder="Extra screen time"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Movie night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement;
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    const configCall = (globalThis.fetch as any).mock.calls.find(([url]: any[]) => url === "/api/tasks/config");
    expect(configCall).toBeTruthy();
    expect(JSON.parse(String(configCall[1].body))).toMatchObject({
      kind: "rewards",
      action: "upsert",
      item: { name: "Movie night", cost: 50 },
    });
  });

  it("rolls back a Tasks-page reward edit after a network rejection", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A]));
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    mockAuth.isLoggedIn = true;
    mockMembers.current = [{ id: "parent-1", name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "#22c55e" }];
    server.snapshot = { tasks: [], weekData: null };
    await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Leaderboard")) as HTMLButtonElement;
    act(() => { leaderboard.click(); });
    await settle();
    const card = Array.from(document.querySelectorAll("h2, h3"))
      .find((element) => element.textContent === "Rewards")!.closest(".widget-card") as HTMLElement;
    act(() => {
      (Array.from(card.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Add") as HTMLButtonElement).click();
    });
    const input = document.querySelector('input[placeholder="Extra screen time"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Network reward");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    server.configFailure = "network";
    await act(async () => {
      (Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(loadRewards<any[]>([])).toEqual([A]);
    expect(document.body.textContent).toContain("Couldn't save the reward");
    expect(document.body.textContent).toContain("Add Reward");
  });

  it("rolls back a Tasks-page penalty edit after a 502", async () => {
    const existing = [{ id: 1, name: "Mess", emoji: "⚠️", points: 5 }];
    localStorage.setItem(PENALTIES_KEY, JSON.stringify(existing));
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    mockAuth.isLoggedIn = true;
    mockMembers.current = [{ id: "parent-1", name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "#22c55e" }];
    server.snapshot = { tasks: [], weekData: null };
    await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Leaderboard")) as HTMLButtonElement;
    act(() => { leaderboard.click(); });
    await settle();
    const card = Array.from(document.querySelectorAll("h2, h3"))
      .find((element) => element.textContent === "Penalties")!.closest(".widget-card") as HTMLElement;
    act(() => {
      (Array.from(card.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Add") as HTMLButtonElement).click();
    });
    const input = document.querySelector('input[placeholder="Forgot homework"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Failed penalty");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    server.configFailure = "502";
    await act(async () => {
      (Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(loadPenalties<any[]>([])).toEqual(existing);
    expect(document.body.textContent).toContain("Couldn't save the penalty");
    expect(document.body.textContent).toContain("Add Penalty");
  });

  it("config-only reward and penalty edits schedule no task/week sync while a task edit still syncs", { timeout: 45000 }, async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    mockAuth.isLoggedIn = true;
    mockMembers.current = [{ id: "parent-1", name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "#22c55e" }];
    server.snapshot = { tasks: [], weekData: null };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const setInput = (input: HTMLInputElement, value: string) => {
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await renderAsync(<TasksPage />);
    await settle(5700);
    expect(server.posts.length).toBeGreaterThan(0);
    expect(server.dbWrites.length).toBeGreaterThan(0);
    server.posts = [];
    server.dbWrites = [];

    const leaderboard = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Leaderboard")) as HTMLButtonElement;
    act(() => { leaderboard.click(); });
    await settle();
    const rewardsCard = Array.from(document.querySelectorAll("h2, h3"))
      .find((element) => element.textContent === "Rewards")!.closest(".widget-card") as HTMLElement;
    act(() => {
      (Array.from(rewardsCard.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Add") as HTMLButtonElement).click();
    });
    setInput(document.querySelector('input[placeholder="Extra screen time"]') as HTMLInputElement, "Reward only");
    await act(async () => {
      (Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await settle(5700);
    expect(server.posts).toHaveLength(0);
    expect(server.dbWrites).toHaveLength(0);

    const penaltiesCard = Array.from(document.querySelectorAll("h2, h3"))
      .find((element) => element.textContent === "Penalties")!.closest(".widget-card") as HTMLElement;
    act(() => {
      (Array.from(penaltiesCard.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Add") as HTMLButtonElement).click();
    });
    setInput(document.querySelector('input[placeholder="Forgot homework"]') as HTMLInputElement, "Penalty only");
    await act(async () => {
      (Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await settle(5700);
    expect(server.posts).toHaveLength(0);
    expect(server.dbWrites).toHaveLength(0);

    const tasksTab = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Tasks") as HTMLButtonElement;
    act(() => { tasksTab.click(); });
    await settle();
    act(() => {
      (document.querySelector('button[aria-label="Add task"]') as HTMLButtonElement).click();
    });
    setInput(document.querySelector('input[placeholder="Task title"]') as HTMLInputElement, "Real task change");
    await act(async () => {
      (Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await settle(5700);
    expect(server.posts).toHaveLength(1);
    expect(server.dbWrites.length).toBeGreaterThan(0);
  });
});

describe("RewardSection — every catalog write stamps the list", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("fetch", vi.fn(async (_input: any, init?: any) => {
      const command = JSON.parse(String(init?.body));
      let items = loadRewards<any[]>([]);
      if (command.action === "replace") items = command.items;
      if (command.action === "upsert") {
        items = items.some((reward) => String(reward.id) === String(command.item.id))
          ? items.map((reward) => String(reward.id) === String(command.item.id) ? command.item : reward)
          : [...items, command.item];
      }
      if (command.action === "delete") {
        items = items.filter((reward) => String(reward.id) !== String(command.itemId));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          operationId: command.operationId,
          kind: "rewards",
          items,
          updatedAt: command.updatedAt,
          revision: { revision: "2", updatedAt: command.updatedAt },
          applied: true,
        }),
      };
    }));
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => { activeRoot!.unmount(); });
      activeRoot = null;
    }
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function mount() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeRoot = createRoot(container);
    act(() => { activeRoot!.render(<RewardSection showToast={vi.fn()} />); });
    return container;
  }

  it("delete writes the shorter list through the config route and adopts its stamp", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A, B]));
    localStorage.setItem(REWARDS_STAMP_KEY, T_OLD);
    mount();

    const del = document.querySelector('button[aria-label="Delete reward"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    await act(async () => {
      del.click();
      await Promise.resolve();
    });

    expect(loadRewards<any[]>([]).map((r) => r.name)).toEqual(["Screen time"]);
    expect(localStorage.getItem(REWARDS_STAMP_KEY)).toBeTruthy();
    expect(JSON.parse(String((globalThis.fetch as any).mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      kind: "rewards",
      action: "delete",
      itemId: 1,
    });
  });

  it("clear-all posts a replacement and adopts the authoritative empty catalog", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A]));
    mount();

    const clear = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Clear all") as HTMLButtonElement;
    expect(clear).toBeTruthy();
    await act(async () => {
      clear.click();
      await Promise.resolve();
    });

    expect(loadRewards<any[]>([])).toEqual([]);
    expect(JSON.parse(String((globalThis.fetch as any).mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      kind: "rewards",
      action: "replace",
      items: [],
    });
    expect(localStorage.getItem(REWARDS_STAMP_KEY)).toBeTruthy();
  });
});
