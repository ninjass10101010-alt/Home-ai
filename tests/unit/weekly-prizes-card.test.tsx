// @vitest-environment jsdom
// Task 7 — Settings WeeklyPrizesCard (parent-only):
//  (1) a child session renders nothing;
//  (2) a parent gets the three rank rows prefilled from DEFAULT_WEEKLY_PRIZES;
//  (3) "Add prize" hides at 3 rows and returns once one is removed;
//  (4) deleting rank 2 re-packs the ranks contiguously (former #3 becomes #2);
//  (6) an explicitly-empty prize list shows the calm empty state.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | { name: string; role: string } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import {
  loadWeeklyPrizes,
  readWeeklyPrizesStamp,
  DEFAULT_WEEKLY_PRIZES,
  WEEKLY_PRIZES_KEY,
} from "@/lib/task-utils";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";

const showToast = vi.fn();
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  // The outbox also PULLS /api/tasks/sync (no body) to prove a command; that
  // read is not a config command and must not be parsed as one.
  if (!init?.body) {
    return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
  }
  const command = JSON.parse(String(init?.body));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      operationId: command.operationId,
      kind: "weekly-prizes",
      items: command.items,
      updatedAt: command.updatedAt,
      revision: { revision: "2", updatedAt: command.updatedAt },
      applied: true,
    }),
  };
});

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

async function pulse() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    await Promise.resolve();
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function configCommandBody(): any {
  const call = (fetchMock.mock.calls as any[]).find(([url, init]: any[]) =>
    String(url) === "/api/tasks/config" && init?.body);
  if (!call) throw new Error("no config command was sent");
  return JSON.parse(String(call[1].body));
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
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  mockAuth.currentUser = null;
  fetchMock.mockClear();
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
  vi.stubGlobal("fetch", fetchMock);
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

  it("Save sends one replacement command and never writes a local success first", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const save = buttonByText(el, "Save prizes");
    expect(save).toBeTruthy();
    await act(async () => { save!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    // The prize list is a durable config command: it is persisted before the
    // first request and the authoritative catalog is the acknowledgment's to
    // deliver (via the cross-device pull), never a local "saved" write.
    expect(listTaskOutbox()).toHaveLength(0);
    // The component never writes the catalog itself: the list below is the
    // ACKNOWLEDGMENT's authoritative items, adopted by the outbox.
    expect(loadWeeklyPrizes().map((p) => [p.rank, p.emoji, p.text])).toEqual(
      DEFAULT_WEEKLY_PRIZES.map((p) => [p.rank, p.emoji, p.text])
    );
    expect(readWeeklyPrizesStamp()).toBeTruthy();
    expect(configCommandBody()).toMatchObject({
      kind: "weekly-prizes",
      action: "replace",
      items: DEFAULT_WEEKLY_PRIZES,
    });
    expect(showToast).toHaveBeenCalledWith("🏆 Saving the weekly prizes…");
  });

  it("keeps the prizes queued after a network rejection instead of losing the edit", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const existing = [{ id: "p1", rank: 1 as const, emoji: "🥇", text: "Existing" }];
    seedPrizes(existing);
    const el = mount();
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    expect(loadWeeklyPrizes()).toEqual(existing);
    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/config", action: "replace" });
    expect(showToast).toHaveBeenCalledWith("🏆 Saving the weekly prizes…");
    expect(showToast).not.toHaveBeenCalledWith("🏆 Weekly prizes saved");
  });

  it("keeps the prizes queued after a 502 instead of losing the edit", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const existing = [{ id: "p1", rank: 1 as const, emoji: "🥇", text: "Existing" }];
    seedPrizes(existing);
    const el = mount();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: "config_store_unreachable" }),
    } as any);

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    expect(loadWeeklyPrizes()).toEqual(existing);
    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/config", action: "replace" });
    expect(showToast).not.toHaveBeenCalledWith("🏆 Weekly prizes saved");
  });

  it("edit round-trip: the typed text rides the command, not a local write", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const first = textInputs(el)[0];
    expect(first.value).toBe("Picks Friday's family movie");
    act(() => { typeInto(first, "Picks the weekend road trip"); });

    await act(async () => { buttonByText(el, "Save prizes")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    expect(loadWeeklyPrizes()[0]?.text).toBe("Picks the weekend road trip");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      kind: "weekly-prizes",
      action: "replace",
      items: expect.arrayContaining([
        expect.objectContaining({ rank: 1, text: "Picks the weekend road trip" }),
      ]),
    });
  });

  it("shows the calm empty state when the prizes list is empty", () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    seedPrizes([]);
    const el = mount();

    expect(el.textContent).toContain("No weekly prizes yet — add one to start the race.");
    expect(textInputs(el)).toHaveLength(0);
    expect(buttonByText(el, "Add prize")).toBeTruthy();
  });

  it("a data-refreshed pulse does NOT clobber in-progress edits (dirty guard)", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    const first = textInputs(el)[0];
    act(() => {
      typeInto(first, "Typed but unsaved");
    });

    // A peer device's save landed in the store; the 60s pulse fires.
    seedPrizes([{ id: "x", rank: 1, emoji: "🥇", text: "Pancake day" }]);
    await pulse();

    expect(textInputs(el)[0].value).toBe("Typed but unsaved");
  });

  it("still re-reads on the pulse when the card has no unsaved edits", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    const el = mount();

    seedPrizes([{ id: "x", rank: 1, emoji: "🥇", text: "Pancake day" }]);
    await pulse();

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
    await pulse();

    expect(textInputs(el).map((i) => i.value)).toEqual(["Pancake day"]);
  });
});
