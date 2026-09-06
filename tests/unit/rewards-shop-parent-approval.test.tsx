// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/rewards",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Caspian", role: "child" } as any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

// Parents exist in the roster — the >100pt gate verifies the typed PIN
// against them (same verifyPinRemote loop the Tasks page runs).
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { name: "Jeffery", fullName: "Jeffery", role: "parent", color: "blue", emoji: "👨" },
      { name: "Caspian", fullName: "Caspian", role: "child", color: "green", emoji: "🧒" },
    ],
  },
}));

const store = vi.hoisted(() => ({
  week: { weekStart: "2026-09-01", points: { Caspian: 200 } as Record<string, number>, streak: {}, lastActive: {}, history: [] as any[] },
  saveWeekData: vi.fn(async (_week: any) => {}),
  syncWeekDataToPB: vi.fn(async (_week: any) => {}),
}));

vi.mock("@/lib/task-utils", () => ({
  loadWeekData: () => ({ ...store.week, points: { ...store.week.points }, history: [...store.week.history] }),
  loadRewards: () => [
    { id: 1, name: "Movie night", emoji: "🎬", cost: 150 },
    { id: 2, name: "Ice cream trip", emoji: "🍦", cost: 40 },
  ],
  saveWeekData: store.saveWeekData,
  addTransaction: (week: any, type: string, amount: number, description: string, member: string) => ({
    ...week,
    history: [...week.history, { id: 1, timestamp: "2026-09-04T12:00:00.000Z", type, amount, description, member }],
  }),
  syncWeekDataToPB: store.syncWeekDataToPB,
}));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

import RewardsShop from "@/modes/kid/RewardsShop";

// Parent PIN "0000" verifies for parents only; kid PIN "1234" for Caspian.
function fetchHandler() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      const body = JSON.parse(String(init?.body || "{}"));
      const member = db_member(body.memberName);
      const ok =
        (member?.role === "parent" && body.pin === "0000") ||
        (body.memberName === "Caspian" && body.pin === "1234");
      return ok
        ? { ok: true, json: async () => ({ member: { name: body.memberName } }) }
        : { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function db_member(name: string) {
  if (name === "Jeffery") return { role: "parent" };
  if (name === "Caspian") return { role: "child" };
  return null;
}

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

async function settle(ms = 60) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

describe("RewardsShop parent approval gate (>100pt rewards)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    store.week = { weekStart: "2026-09-01", points: { Caspian: 200 }, streak: {}, lastActive: {}, history: [] };
    store.saveWeekData.mockReset();
    store.syncWeekDataToPB.mockClear();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("tapping a >100pt reward opens the parent-approval modal and writes nothing", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();

    const card = el.querySelector('[aria-label^="Movie night — 150 points"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    // The established Tasks-page gate: parent approval BEFORE any redemption.
    expect(document.body.textContent || "").toContain("Parent Approval Required");
    expect(document.body.textContent || "").not.toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
  });

  it("a WRONG parent PIN never unlocks the redemption or writes points", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Movie night — 150 points"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const parentInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    expect(parentInput).not.toBeNull();
    await act(async () => { setInputValue(parentInput, "9999"); });
    await act(async () => { buttonByText("Approve")!.click(); });
    await settle();

    expect(document.body.textContent || "").toContain("Parent PIN required to approve large rewards.");
    expect(document.body.textContent || "").not.toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
  });

  it("a correct parent PIN unlocks the kid-PIN step, and the write lands only after it", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Movie night — 150 points"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const parentInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(parentInput, "0000"); });
    await act(async () => { buttonByText("Approve")!.click(); });
    await settle();

    // Approved → the normal kid redemption PIN step opens; still no write.
    expect(document.body.textContent || "").toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();

    const kidInput = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    expect(kidInput).not.toBeNull();
    await act(async () => { setInputValue(kidInput, "1234"); });
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();

    expect(store.saveWeekData).toHaveBeenCalled();
    const week = store.saveWeekData.mock.calls.at(-1)![0];
    expect(week.points.Caspian).toBe(50);
    expect(week.history.some((tx: any) => tx.type === "redeem" && tx.amount === -150)).toBe(true);
    expect(store.syncWeekDataToPB).toHaveBeenCalled();
  });

  it("a ≤100pt reward skips parent approval (kid PIN only, as before)", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Ice cream trip — 40 points"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    expect(document.body.textContent || "").not.toContain("Parent Approval Required");
    expect(document.body.textContent || "").toContain("Redeem with your PIN");
  });
});
