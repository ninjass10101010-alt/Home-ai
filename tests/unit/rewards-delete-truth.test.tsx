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
import { REWARDS_KEY, loadRewards } from "@/lib/task-utils";
import { REWARDS_STAMP_KEY } from "@/modes/kid/kid-store";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "selectMembers" || prop === "selectMembersFallback") return () => [];
        return async () => null;
      },
    }
  ),
}));

// The server snapshot is mutable test state; POSTs are recorded, not applied.
const server = vi.hoisted(() => ({
  snapshot: null as any,
  posts: [] as any[],
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
    server.snapshot = null;
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any, init?: any) => {
        if (String(input).includes("/api/tasks/sync")) {
          if (String(init?.method || "GET").toUpperCase() === "POST") {
            server.posts.push(JSON.parse(String(init.body)));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: server.snapshot }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      })
    );
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

  it("delete writes the shorter list AND bumps the LWW stamp", () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([A, B]));
    localStorage.setItem(REWARDS_STAMP_KEY, T_OLD);
    mount();

    const del = document.querySelector('button[aria-label="Delete reward"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    act(() => { del.click(); });

    expect(loadRewards<any[]>([]).map((r) => r.name)).toEqual(["Screen time"]);
    const stamp = localStorage.getItem(REWARDS_STAMP_KEY);
    expect(stamp).toBeTruthy();
    expect(stamp).not.toBe(T_OLD);
    expect(stamp! > T_OLD).toBe(true);
  });

  it("clear-all stamps too (an emptied catalog is still a claim of truth)", () => {
    mount();

    const clear = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Clear all") as HTMLButtonElement;
    expect(clear).toBeTruthy();
    act(() => { clear.click(); });

    expect(localStorage.getItem(REWARDS_STAMP_KEY)).toBeTruthy();
  });
});
