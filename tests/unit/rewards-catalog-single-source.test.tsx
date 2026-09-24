// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The shared Modal's exit phase reads matchMedia (reduced-motion check) —
// jsdom has none. matches:true takes the instant-close path.
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

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => null),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

import RewardSection from "@/components/settings/RewardSection";
import { REWARDS_KEY, loadRewards } from "@/lib/task-utils";

const LEGACY_KEY = "consuela-rewards-catalog";

let root: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(showToast = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<RewardSection showToast={showToast} />); });
  return container;
}

beforeEach(() => {
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
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
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
        kind: command.kind,
        items,
        updatedAt: command.updatedAt,
        revision: { revision: "2", updatedAt: command.updatedAt },
        applied: true,
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("RewardSection — one rewards catalog (task-utils REWARDS_KEY)", () => {
  it("heals a legacy-only Settings catalog into the live shop key and retires the old key", () => {
    const legacy = [{ id: "reward-1", name: "Movie night", emoji: "🎬", cost: 40, category: "fun" }];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    mount();

    expect(loadRewards<any[]>([])).toEqual(legacy);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("never lets the legacy key clobber the live catalog when both exist", () => {
    const live = [{ id: 7, name: "Live reward", emoji: "🎁", cost: 10 }];
    const staleJson = JSON.stringify([{ id: "x", name: "Stale", emoji: "🗑️", cost: 1 }]);
    localStorage.setItem(REWARDS_KEY, JSON.stringify(live));
    localStorage.setItem(LEGACY_KEY, staleJson);

    mount();

    expect(loadRewards<any[]>([])).toEqual(live);
    // Conflict path: the live key wins for reads and the legacy copy is
    // left in place — the heal must never destroy data unmerged.
    expect(localStorage.getItem(LEGACY_KEY)).toBe(staleJson);
  });

  it("round-trip: a Settings save posts to the config route and adopts the response", async () => {
    mount();

    const addBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add reward")!;
    act(() => { addBtn.click(); });
    const nameInput = Array.from(document.querySelectorAll("label"))
      .find((l) => l.textContent?.includes("Reward name"))!
      .querySelector("input") as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(nameInput, "30 min screen time");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
    await act(async () => {
      saveBtn.click();
      await Promise.resolve();
    });

    const stored = loadRewards<any[]>([]);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("30 min screen time");
    expect(stored[0].cost).toBe(25);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/config",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      kind: "rewards",
      action: "upsert",
      item: { name: "30 min screen time", emoji: "🎁", cost: 25 },
    });
  });

  it("delete writes the authoritative response through the config route", async () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([{ id: 1, name: "Ice cream", emoji: "🍦", cost: 15 }]));
    mount();

    const del = document.querySelector('button[aria-label="Delete reward"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    await act(async () => {
      del.click();
      await Promise.resolve();
    });

    expect(loadRewards<any[]>([])).toEqual([]);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      kind: "rewards",
      action: "delete",
      itemId: 1,
    });
  });

  it("keeps the local catalog and shows no success after a 502", async () => {
    const existing = [{ id: 1, name: "Ice cream", emoji: "🍦", cost: 15 }];
    localStorage.setItem(REWARDS_KEY, JSON.stringify(existing));
    const showToast = vi.fn();
    mount(showToast);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: "config_store_unreachable" }),
    } as any);

    const del = document.querySelector('button[aria-label="Delete reward"]') as HTMLButtonElement;
    await act(async () => {
      del.click();
      await Promise.resolve();
    });

    expect(loadRewards<any[]>([])).toEqual(existing);
    expect(showToast).toHaveBeenCalledWith("Couldn't remove the reward. Check the connection and try again.");
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("keeps an add form open with no local success after a network rejection", async () => {
    const showToast = vi.fn();
    mount(showToast);
    const add = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Add reward")!;
    act(() => { add.click(); });
    const input = document.querySelector('input[placeholder="e.g., 30 min screen time"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Movie");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));

    const save = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Save")!;
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(loadRewards<any[]>([])).toEqual([]);
    expect(document.body.textContent).toContain("Add reward");
    expect(showToast).toHaveBeenCalledWith("Couldn't save the reward. Check the connection and try again.");
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("Added"));
  });
});
