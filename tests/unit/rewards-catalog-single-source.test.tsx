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
function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<RewardSection showToast={vi.fn()} />); });
  return container;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
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

  it("round-trip: a Settings save lands where the shop reads (loadRewards sees it)", () => {
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
    act(() => { saveBtn.click(); });

    const stored = loadRewards<any[]>([]);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("30 min screen time");
    expect(stored[0].cost).toBe(25);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("delete writes through the shared key too", () => {
    localStorage.setItem(REWARDS_KEY, JSON.stringify([{ id: 1, name: "Ice cream", emoji: "🍦", cost: 15 }]));
    mount();

    const del = document.querySelector('button[aria-label="Delete reward"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    act(() => { del.click(); });

    expect(loadRewards<any[]>([])).toEqual([]);
  });
});
