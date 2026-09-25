// @vitest-environment jsdom
// Task 10 — the config callers (RewardSection, WeeklyPrizesCard,
// action-runner) and the post-login outbox flush are durable commands, not
// local-first writes with a best-effort POST behind them.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { listTaskOutbox, __resetTaskOutboxForTests } from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import { REWARDS_KEY, loadRewards } from "@/lib/task-utils";
import { CacheRefresher } from "@/components/ui/CacheRefresher";
import RewardSection from "@/components/settings/RewardSection";
import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import { runAction } from "@/lib/action-runner";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Rebecca", role: "parent" } as any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));

vi.mock("@/db", () => ({
  db: {
    upsertGroceryItem: vi.fn(async () => null),
    selectMeals: vi.fn(async () => []),
    refreshCaches: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/pending-writes", () => ({ flushPendingWrites: vi.fn(async () => {}) }));

const server = vi.hoisted(() => ({ configStatus: 200, configRequests: [] as any[] }));

let root: Root | null = null;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url === "/api/tasks/config") {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        server.configRequests.push(body);
        if (server.configStatus === 409) {
          // The real route's stale answer: a stable 409 carrying the
          // authoritative catalog, never a false 200.
          return {
            ok: false,
            status: 409,
            json: async () => ({
              success: false,
              error: "stale_config",
              operationId: body?.operationId,
              kind: body?.kind,
              items: [],
              updatedAt: "2026-09-24T10:00:00.000Z",
              applied: false,
              stale: true,
            }),
          };
        }
        if (server.configStatus >= 400) {
          return { ok: false, status: server.configStatus, json: async () => ({ error: "config_store_unreachable" }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            operationId: body?.operationId,
            kind: body?.kind,
            items: body?.items ?? (body?.item ? [body.item] : []),
            updatedAt: body?.updatedAt,
          }),
        };
      }
      if (url === "/api/tasks/sync") {
        return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

async function mount(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(<CacheRefresher>{ui}</CacheRefresher>);
  });
  return el;
}

async function settle(ms = 80) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  server.configStatus = 200;
  server.configRequests = [];
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

describe("RewardSection writes a durable config command", () => {
  it("queues an upsert and never writes the catalog as a local success", async () => {
    server.configStatus = 503;
    localStorage.setItem(REWARDS_KEY, JSON.stringify([]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add reward") as HTMLButtonElement).click();
    await settle();
    const input = document.querySelector('input[placeholder="e.g., 30 min screen time"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Movie night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement).click();
    });
    await settle();

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/config", action: "upsert" });
    expect((entry.payload.item as any).name).toBe("Movie night");
    expect(loadRewards<any[]>([])).toEqual([]);
  });

  it("queues a delete without a local-first removal", async () => {
    server.configStatus = 503;
    localStorage.setItem(REWARDS_KEY, JSON.stringify([{ id: 1, name: "Ice cream", emoji: "🍦", cost: 15, category: "fun" }]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    await act(async () => {
      (document.querySelector('button[aria-label="Delete reward"]') as HTMLButtonElement).click();
    });
    await settle();

    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/config", action: "delete", payload: { itemId: 1 } });
    expect(loadRewards<any[]>([])).toHaveLength(1);
  });

  it("queues a clear-all replacement", async () => {
    server.configStatus = 503;
    localStorage.setItem(REWARDS_KEY, JSON.stringify([{ id: 1, name: "Ice cream", emoji: "🍦", cost: 15, category: "fun" }]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Clear all") as HTMLButtonElement).click();
    });
    await settle();

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/config", action: "replace", payload: { items: [] } });
    expect(loadRewards<any[]>([])).toHaveLength(1);
  });

  it("sends exactly one config request and clears the outbox on acknowledgment", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add reward") as HTMLButtonElement).click();
    await settle();
    const input = document.querySelector('input[placeholder="e.g., 30 min screen time"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Movie night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement).click();
    });
    await settle(150);

    expect(server.configRequests).toHaveLength(1);
    expect(server.configRequests[0]).toMatchObject({ kind: "rewards", action: "upsert" });
  });
});

describe("WeeklyPrizesCard writes a durable config command", () => {
  it("queues the weekly-prizes replacement with no local success write", async () => {
    server.configStatus = 503;
    await mount(<WeeklyPrizesCard showToast={() => {}} />);
    await settle();

    const text = document.querySelector('input[aria-label="Prize 1 text"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(text, "Picks the movie");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Save prizes")) as HTMLButtonElement).click();
    });
    await settle();

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/config", action: "replace", payload: { kind: "weekly-prizes" } });
    expect((entry.payload.items as any[])[0]).toMatchObject({ text: "Picks the movie" });
  });
});

describe("Settings surfaces report the queue honestly", () => {
  it("RewardSection shows the queued count and no success toast before acknowledgment", async () => {
    server.configStatus = 503;
    localStorage.setItem("consuela-rewards", JSON.stringify([]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add reward") as HTMLButtonElement).click();
    await settle();
    const input = document.querySelector('input[placeholder="e.g., 30 min screen time"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Movie night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement).click();
    });
    await settle(150);

    // The parent can SEE that the change is still in flight.
    expect(document.querySelector('[data-testid="rewards-command-queue"]')?.textContent).toMatch(/Sending 1 change/);
    expect(loadRewards<any[]>([])).toEqual([]);
  });

  it("RewardSection surfaces a refusal with a discard action", async () => {
    server.configStatus = 409;
    localStorage.setItem("consuela-rewards", JSON.stringify([]));
    await mount(<RewardSection showToast={() => {}} />);
    await settle();

    (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add reward") as HTMLButtonElement).click();
    await settle();
    const input = document.querySelector('input[placeholder="e.g., 30 min screen time"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Movie night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement).click();
    });
    await settle(250);

    const failures = document.querySelector('[data-testid="rewards-command-failures"]');
    expect(failures).not.toBeNull();
    const discard = failures!.querySelector('[aria-label^="Discard unsaved"]') as HTMLButtonElement;
    expect(discard).toBeTruthy();
    await act(async () => { discard.click(); });
    await settle(150);
    expect(document.querySelector('[data-testid="rewards-command-failures"]')).toBeNull();
  });

  it("WeeklyPrizesCard shows the same honest queue surface", async () => {
    server.configStatus = 503;
    await mount(<WeeklyPrizesCard showToast={() => {}} />);
    await settle();

    const text = document.querySelector('input[aria-label="Prize 1 text"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(text, "Picks the movie");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Save prizes")) as HTMLButtonElement).click();
    });
    await settle(150);

    expect(document.querySelector('[data-testid="prizes-command-queue"]')?.textContent).toMatch(/Sending 1 change/);
  });
});

describe("action-runner reward action is a durable config command", () => {
  it("queues the reward upsert instead of writing the catalog first", async () => {
    server.configStatus = 503;
    const result = await act(async () =>
      runAction({ type: "reward", title: "Ice cream trip", detail: "50 pts", emoji: "🍦" }) as Promise<any>,
    );

    expect(result).toMatchObject({ success: true });
    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/config", action: "upsert", payload: { kind: "rewards" } });
    expect(loadRewards<any[]>([])).toEqual([]);
  });
});
