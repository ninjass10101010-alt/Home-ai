// @vitest-environment jsdom
// Task 7 — Settings WeeklyPrizesCard (parent-only):
//  (1) a child session renders nothing;
//  (2) a parent gets the three rank rows prefilled from DEFAULT_WEEKLY_PRIZES;
//  (3) "Add prize" hides at 3 rows and returns once one is removed;
//  (4) deleting rank 2 re-packs the ranks contiguously (former #3 becomes #2);
//  (5) Save writes the list + LWW stamp + one rank-keyed upsert per row, then
//      toasts;
//  (6) an explicitly-empty prize list shows the calm empty state.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | { name: string; role: string } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const upsertSpy = vi.hoisted(() => vi.fn(async (_data: any) => null));
vi.mock("@/db", () => ({ db: { upsertWeeklyPrize: (data: any) => upsertSpy(data) } }));

import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import {
  loadWeeklyPrizes,
  readWeeklyPrizesStamp,
  DEFAULT_WEEKLY_PRIZES,
  WEEKLY_PRIZES_KEY,
} from "@/lib/task-utils";

const showToast = vi.fn();

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(createElement(WeeklyPrizesCard, { showToast }));
  });
  return host;
}

function textInputs(el: HTMLElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[aria-label^="Prize"][aria-label$="text"]'));
}
function emojiInputs(el: HTMLElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[aria-label^="Prize"][aria-label$="emoji"]'));
}
function button(el: HTMLElement, label: string): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}
function buttonByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}

function seedPrizes(prizes: any[]) {
  localStorage.setItem(WEEKLY_PRIZES_KEY, JSON.stringify(prizes));
}

beforeEach(() => {
  localStorage.clear();
  mockAuth.currentUser = null;
  upsertSpy.mockClear();
  showToast.mockClear();
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
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
  vi.unstubAllGlobals();
});

describe("WeeklyPrizesCard", () => {
  it("a child session renders nothing", () => {
    mockAuth.currentUser = { name: "Caspian", role: "child" };
    const el = mount();
    expect(el.innerHTML).toBe("");
  });

  it("a parent gets the three rank rows prefilled from the defaults", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const texts = textInputs(el);
    const emojis = emojiInputs(el);
    expect(texts).toHaveLength(3);
    expect(emojis).toHaveLength(3);
    expect(texts.map((i) => i.value)).toEqual(DEFAULT_WEEKLY_PRIZES.map((p) => p.text));
    expect(emojis.map((i) => i.value)).toEqual(DEFAULT_WEEKLY_PRIZES.map((p) => p.emoji));
    expect(texts[0].placeholder).toBe("What does #1 win?");
  });

  it("hides “Add prize” at 3 rows and shows it again once a row is removed", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    expect(buttonByText(el, "Add prize")).toBeUndefined();

    const remove = button(el, "Remove prize 1");
    expect(remove).toBeTruthy();
    act(() => { remove!.click(); });

    expect(textInputs(el)).toHaveLength(2);
    expect(buttonByText(el, "Add prize")).toBeTruthy();
  });

  it("deleting rank 2 keeps the ranks contiguous (former #3 shifts up to #2)", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    seedPrizes([
      { id: "a", rank: 1, emoji: "🥇", text: "Alpha" },
      { id: "b", rank: 2, emoji: "🥈", text: "Beta" },
      { id: "c", rank: 3, emoji: "🥉", text: "Gamma" },
    ]);
    const el = mount();

    act(() => { button(el, "Remove prize 2")!.click(); });

    const texts = textInputs(el);
    expect(texts.map((i) => i.value)).toEqual(["Alpha", "Gamma"]);
    expect(emojiInputs(el).map((i) => i.value)).toEqual(["🥇", "🥉"]);
    // The survivor now sits at rank 2 — placeholder + fixed medal follow the new rank.
    expect(texts[1].placeholder).toBe("What does #2 win?");
    expect(button(el, "Remove prize 3")).toBeNull();
    expect(button(el, "Remove prize 2")).toBeTruthy();
  });

  it("Save writes the list, stamps it, upserts one row per prize, and toasts", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const save = buttonByText(el, "Save prizes");
    expect(save).toBeTruthy();
    await act(async () => { save!.click(); });

    expect(loadWeeklyPrizes().map((p) => [p.rank, p.emoji, p.text])).toEqual(
      DEFAULT_WEEKLY_PRIZES.map((p) => [p.rank, p.emoji, p.text])
    );
    expect(readWeeklyPrizesStamp()).toBeTruthy();

    expect(upsertSpy).toHaveBeenCalledTimes(3);
    expect(upsertSpy).toHaveBeenNthCalledWith(1, { rank: 1, emoji: "🥇", text: "Picks Friday's family movie" });
    expect(upsertSpy).toHaveBeenNthCalledWith(2, { rank: 2, emoji: "🥈", text: "Chooses the dessert night" });
    expect(upsertSpy).toHaveBeenNthCalledWith(3, { rank: 3, emoji: "🥉", text: "+$2 allowance" });
    expect(showToast).toHaveBeenCalledWith("🏆 Weekly prizes saved");
  });

  it("shows the calm empty state when the prizes list is empty", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    seedPrizes([]);
    const el = mount();

    expect(el.textContent).toContain("No weekly prizes yet — add one to start the race.");
    expect(textInputs(el)).toHaveLength(0);
    expect(buttonByText(el, "Add prize")).toBeTruthy();
  });
});
