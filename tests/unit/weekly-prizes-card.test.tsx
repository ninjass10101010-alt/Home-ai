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

const upsertSpy = vi.hoisted(() => vi.fn(async (_data: { rank: number }): Promise<unknown> => null));
vi.mock("@/db", () => ({ db: { upsertWeeklyPrize: (data: any) => upsertSpy(data) } }));

import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import {
  loadWeeklyPrizes,
  readWeeklyPrizesStamp,
  DEFAULT_WEEKLY_PRIZES,
  WEEKLY_PRIZES_KEY,
} from "@/lib/task-utils";

const showToast = vi.fn();
const WEEKLY_PRIZES_STAMP_KEY = "consuela-weekly-prizes-stamp";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

// Controlled React inputs ignore plain .value assignment — go through the
// native setter + a bubbling "input" event so onChange fires.
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  mockAuth.currentUser = null;
  upsertSpy.mockReset();
  upsertSpy.mockImplementation(async (data: { rank: number }) => ({ id: `rank-${data.rank}` }));
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
  vi.restoreAllMocks();
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
    expect(showToast).toHaveBeenCalledWith("🏆 Weekly prizes saved", "success");
  });

  it("locks every mutation while a deferred server sync is pending", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const request = deferred<unknown>();
    upsertSpy.mockReturnValue(request.promise);
    const el = mount();
    act(() => { button(el, "Remove prize 3")!.click(); });
    act(() => { typeInto(textInputs(el)[0], "Locked save"); });

    const save = buttonByText(el, "Save prizes")!;
    await act(async () => { save.click(); });

    expect(textInputs(el).every((input) => input.disabled)).toBe(true);
    expect(emojiInputs(el).every((input) => input.disabled)).toBe(true);
    expect(button(el, "Remove prize 1")!.disabled).toBe(true);
    expect(buttonByText(el, "Add prize")!.disabled).toBe(true);

    act(() => {
      typeInto(textInputs(el)[0], "Late mutation");
      button(el, "Remove prize 1")!.click();
      buttonByText(el, "Add prize")!.click();
    });
    expect(textInputs(el).map((input) => input.value)).toEqual(["Locked save", DEFAULT_WEEKLY_PRIZES[1].text]);

    await act(async () => {
      request.resolve({ id: "synced" });
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledWith("🏆 Weekly prizes saved", "success");
    expect(textInputs(el).every((input) => input.disabled)).toBe(false);
  });

  it("keeps the list dirty and skips server sync when local list persistence fails", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const originalSetItem = Storage.prototype.setItem;
    let failList = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (failList && key === WEEKLY_PRIZES_KEY) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });
    const el = mount();
    act(() => { typeInto(textInputs(el)[0], "Unsaved local edit"); });

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "Couldn't save the weekly prize catalog on this device. Try again.",
      "error",
    );
    expect(buttonByText(el, "Save prizes")).toBeTruthy();

    failList = false;
    seedPrizes([{ id: "peer", rank: 1, emoji: "🥇", text: "Peer catalog" }]);
    act(() => { window.dispatchEvent(new CustomEvent("consuela-data-refreshed")); });
    expect(textInputs(el)[0].value).toBe("Unsaved local edit");
  });

  it("keeps the list dirty and skips server sync when stamp persistence fails", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const originalSetItem = Storage.prototype.setItem;
    let failStamp = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (failStamp && key === WEEKLY_PRIZES_STAMP_KEY) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });
    const el = mount();
    act(() => { typeInto(textInputs(el)[0], "Locally saved edit"); });

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });

    expect(loadWeeklyPrizes()[0].text).toBe("Locally saved edit");
    expect(readWeeklyPrizesStamp()).toBe("");
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "Weekly prize catalog is saved on this device, but its sync marker could not be saved. Try again.",
      "error",
    );

    failStamp = false;
    seedPrizes([{ id: "peer", rank: 1, emoji: "🥇", text: "Peer catalog" }]);
    act(() => { window.dispatchEvent(new CustomEvent("consuela-data-refreshed")); });
    expect(textInputs(el)[0].value).toBe("Locally saved edit");
  });

  it("keeps a partial local save and reports the exact number of rows that did not sync", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    upsertSpy.mockImplementation(async (data: { rank: number }) => {
      if (data.rank === 2) return null;
      return { id: `rank-${data.rank}` };
    });
    const el = mount();

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });

    expect(loadWeeklyPrizes().map((prize) => prize.text)).toEqual(DEFAULT_WEEKLY_PRIZES.map((prize) => prize.text));
    expect(upsertSpy).toHaveBeenCalledTimes(3);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      "Weekly prize catalog is saved on this device and 1 row did not sync.",
      "error",
    );
  });

  it("keeps a fully local save and reports every row when all server upserts fail", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    upsertSpy.mockRejectedValue(new Error("offline"));
    const el = mount();

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });

    expect(loadWeeklyPrizes().map((prize) => prize.text)).toEqual(DEFAULT_WEEKLY_PRIZES.map((prize) => prize.text));
    expect(upsertSpy).toHaveBeenCalledTimes(3);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      "Weekly prize catalog is saved on this device and 3 rows did not sync.",
      "error",
    );
  });

  it("edit round-trip: typing into a text field and saving persists the new text", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const first = textInputs(el)[0];
    expect(first.value).toBe("Picks Friday's family movie");
    act(() => { typeInto(first, "Picks the weekend road trip"); });

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });

    expect(loadWeeklyPrizes()[0].text).toBe("Picks the weekend road trip");
    expect(loadWeeklyPrizes()[1].text).toBe("Chooses the dessert night");
    // The server push carried the edited text too (rank-keyed upsert per row).
    expect(upsertSpy).toHaveBeenNthCalledWith(1, { rank: 1, emoji: "🥇", text: "Picks the weekend road trip" });
  });

  it("shows the calm empty state when the prizes list is empty", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    seedPrizes([]);
    const el = mount();

    expect(el.textContent).toContain("No weekly prizes yet — add one to start the race.");
    expect(textInputs(el)).toHaveLength(0);
    expect(buttonByText(el, "Add prize")).toBeTruthy();
  });

  it("a data-refreshed pulse does NOT clobber in-progress edits (dirty guard)", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const first = textInputs(el)[0];
    act(() => {
      typeInto(first, "Typed but unsaved");
    });

    // A peer device's save landed in the store; the 60s pulse fires.
    seedPrizes([{ id: "x", rank: 1, emoji: "🥇", text: "Pancake day" }]);
    act(() => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });

    expect(textInputs(el)[0].value).toBe("Typed but unsaved");
  });

  it("still re-reads on the pulse when the card has no unsaved edits", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    seedPrizes([{ id: "x", rank: 1, emoji: "🥇", text: "Pancake day" }]);
    act(() => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });

    expect(textInputs(el).map((i) => i.value)).toEqual(["Pancake day"]);
  });

  it("a pulse applies again after a save clears the dirty flag", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    act(() => {
      typeInto(textInputs(el)[0], "Typed but unsaved");
    });
    await act(async () => {
      buttonByText(el, "Save prizes")!.click();
    });

    seedPrizes([{ id: "x", rank: 1, emoji: "🥇", text: "Pancake day" }]);
    act(() => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });

    expect(textInputs(el).map((i) => i.value)).toEqual(["Pancake day"]);
  });
});
