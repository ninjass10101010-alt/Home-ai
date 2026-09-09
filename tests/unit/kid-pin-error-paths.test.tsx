// @vitest-environment jsdom
// Fix-A findings 1 & 2 — kid-flow error paths:
//  - submitQuestPin had no catch: a network rejection escaped the onClick,
//    the spinner stopped, and the kid got NO feedback with the PIN in state.
//  - verifyPinRemote collapsed 401/5xx/network into null, so an offline kid
//    was told "Wrong PIN. Try again." Both must now surface honest copy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Caspian", role: "child", age: 5 } as any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const modeMock = vi.hoisted(() => ({ isBedtime: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: modeMock.isBedtime, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [{ name: "Caspian", color: "green", emoji: "🧒" }],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
    selectMembers: () => [
      { name: "Jeffery", fullName: "Jeffery", role: "parent", color: "blue", emoji: "👨" },
      { name: "Caspian", fullName: "Caspian", role: "child", color: "green", emoji: "🧒" },
    ],
  },
}));

const store = vi.hoisted(() => ({
  tasks: [] as any[],
  week: { weekStart: "2026-09-01", points: {} as Record<string, number>, streak: {}, lastActive: {}, history: [] as any[] },
  saveTasks: vi.fn(async (_tasks: any[]) => {}),
  saveWeekData: vi.fn(async (_week: any) => {}),
  syncTasksToPB: vi.fn(async (_tasks: any[]) => {}),
  syncWeekDataToPB: vi.fn(async (_week: any) => {}),
}));

vi.mock("@/lib/task-utils", () => ({
  loadTasks: () => store.tasks.map((t) => ({ ...t })),
  saveTasks: store.saveTasks,
  loadWeekData: () => ({ ...store.week, points: { ...store.week.points }, history: [...store.week.history] }),
  saveWeekData: store.saveWeekData,
  loadRewards: () => [
    { id: 1, name: "Movie night", emoji: "🎬", cost: 150 },
    { id: 2, name: "Ice cream trip", emoji: "🍦", cost: 40 },
  ],
  addTransaction: (week: any, type: string, amount: number, description: string, member: string, taskId?: number) => ({
    ...week,
    history: [...week.history, { id: 1, timestamp: "2026-09-04T12:00:00.000Z", type, amount, description, member, taskId }],
  }),
  weekKey: () => store.week.weekStart,
  getThisWeeksCompletedTasks: (tasks: any[]) => tasks.filter((t: any) => t.completed),
  getThisWeeksCompletedDates: () => [],
  calculateRealStreak: () => 0,
  syncTasksToPB: store.syncTasksToPB,
  syncWeekDataToPB: store.syncWeekDataToPB,
  // The REAL age predicates (mirrored): under-10 + child + open + assigned +
  // never snatchable completes PIN-free; every child completion lands
  // pending after the gate. The deprecated pre-age seam is gone from KidHome —
  // the mock no longer carries it.
  completesWithoutPin: (role: string | undefined, age: number | undefined, task: any) =>
    role === "child" &&
    typeof age === "number" &&
    Number.isFinite(age) &&
    age > 0 &&
    age < 10 &&
    !task.completed &&
    !task.universal &&
    !(task.stealable && !!task.due && task.due < "2026-09-04"),
  completesWithPendingApproval: (role: string | undefined, task: any) =>
    role === "child" && !task.completed,
  isSnatchable: (task: any, today: string = "2026-09-04") =>
    !!task.stealable && !task.completed && !!task.due && task.due < today,
  resolveMemberName: (members: any[], rawName?: string | null) => {
    const raw = (rawName || "").trim();
    if (!raw) return rawName || "";
    const pool = (members || []).filter((m) => m.role !== "pet");
    const first = (v?: string) => (v || "").trim().split(" ")[0].toLowerCase();
    const exact = pool.find((m) => m.fullName === raw || m.name === raw);
    if (exact) return exact.fullName || exact.name || raw;
    const target = first(raw);
    const mine = pool.find((m) => first(m.fullName) === target || first(m.name) === target);
    return mine ? (mine.fullName || mine.name || raw) : raw;
  },
  tapCompletePending: (task: any, byName: string, nowISO: string, week: string) => ({
    ...task,
    completed: true,
    completedBy: byName,
    completedAt: nowISO,
    completedInWeek: week,
    pendingApproval: { byName, at: nowISO, points: task.points },
  }),
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => <div data-testid="emergency-button" /> }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: {}, filterId: "atmos", accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

import KidHome from "@/modes/kid/KidHome";
import RewardsShop from "@/modes/kid/RewardsShop";

const QUEST = { id: 7, title: "Feed the dog", points: 10, assignee: "Caspian", completed: false };
const UNIVERSAL = { id: 9, title: "Grab the mail", points: 12, assignee: "All", universal: true, completed: false };

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

async function completeQuestWithPin(el: HTMLElement, questTitle: string, pin: string) {
  const card = el.querySelector(`[aria-label^="Complete quest: ${questTitle}"]`) as HTMLElement;
  expect(card).not.toBeNull();
  await act(async () => { card.click(); });
  await settle();
  const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText("Complete")!.click(); });
  await settle();
}

// Under-10 assigned quests: the tap IS the whole gate — no modal, no PIN.
async function tapQuest(el: HTMLElement, questTitle: string) {
  const card = el.querySelector(`[aria-label^="Complete quest: ${questTitle}"]`) as HTMLElement;
  expect(card).not.toBeNull();
  await act(async () => { card.click(); });
  await settle();
}

describe("KidHome — honest error paths on the quest PIN gate", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    modeMock.isBedtime = false;
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    store.tasks = [{ ...QUEST }];
    store.week = { weekStart: "2026-09-01", points: { Caspian: 20 }, streak: {}, lastActive: {}, history: [] };
    store.saveTasks.mockReset();
    store.saveWeekData.mockReset();
    store.syncTasksToPB.mockClear();
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
    // The offline test redefines onLine — restore it so it can't leak.
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    vi.unstubAllGlobals();
  });

  it("a SERVER ERROR (500) no longer blocks an under-10 kid quest — the tap lands pending with zero verify traffic", async () => {
    const spyFetch = vi.fn(async (..._args: any[]) => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");

    // Pending contract: done-but-unpaid even when the server errors — the
    // under-10 path performs no network round trip at all (syncTasksToPB is
    // the mocked store seam), so the 500 is never even observed.
    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls[0][0];
    expect(saved.find((t: any) => t.id === 7)?.pendingApproval).toMatchObject({ byName: "Caspian", points: 10 });
    expect(spyFetch.mock.calls.filter((call) => String(call[0]).includes("/api/members/verify"))).toHaveLength(0);
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.week.history).toHaveLength(0);
    expect(document.querySelector('[aria-label^="Congratulations"]')).not.toBeNull();
  });

  it("a NETWORK REJECTION no longer blocks an under-10 kid quest — it lands pending, not unreachable", async () => {
    const spyFetch = vi.fn(async (..._args: any[]) => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");

    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls[0][0];
    expect(saved.find((t: any) => t.id === 7)?.pendingApproval).toMatchObject({ byName: "Caspian", points: 10 });
    expect(spyFetch.mock.calls.filter((call) => String(call[0]).includes("/api/members/verify"))).toHaveLength(0);
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.week.history).toHaveLength(0);
    expect(document.querySelector('[aria-label^="Congratulations"]')).not.toBeNull();
  });

  it("a 10-year-old's WRONG PIN is honestly refused — no pending row, no celebration", async () => {
    // The gate verifies now: the old "any PIN lands pending" seam was the
    // no-verify bridge for all ages — under-10 kids skip the PIN entirely,
    // 10+ kids must verify before the pending row lands.
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 10 };
    const spyFetch = vi.fn(async (..._args: any[]) => ({ ok: false, status: 401, json: async () => ({}) }));
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();
    await completeQuestWithPin(el, "Feed the dog", "9999");

    expect(spyFetch.mock.calls.some((call) => String(call[0]).includes("/api/members/verify"))).toBe(true);
    expect(document.body.textContent || "").toContain("Wrong PIN");
    expect(store.saveTasks).not.toHaveBeenCalled();
    expect(store.syncTasksToPB).not.toHaveBeenCalled();
    expect(store.week.history).toHaveLength(0);
    expect(document.querySelector('[aria-label^="Congratulations"]')).toBeNull();
  });

  it("an OFFLINE kid quest still lands pending locally (syncs when the connection returns)", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    const spyFetch = vi.fn(async (..._args: any[]) => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");

    // Local-first pending write: no network needed, no verify, no earn.
    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls[0][0];
    expect(saved.find((t: any) => t.id === 7)?.pendingApproval).toMatchObject({ byName: "Caspian", points: 10 });
    expect(spyFetch.mock.calls.filter((call) => String(call[0]).includes("/api/members/verify"))).toHaveLength(0);
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.week.history).toHaveLength(0);
    expect(store.syncTasksToPB).toHaveBeenCalled();
    expect(document.querySelector('[aria-label^="Congratulations"]')).not.toBeNull();
  });

  it("a NETWORK REJECTION on the claim POST is caught (was: escaped the onClick, silent)", async () => {
    store.tasks = [{ ...UNIVERSAL }];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/tasks/claim")) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const el = await renderAsync(<KidHome />);
    await settle();
    await completeQuestWithPin(el, "Grab the mail", "1234");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    // No silent success: nothing persisted, no celebration, spinner released.
    expect(store.saveTasks).not.toHaveBeenCalled();
    expect(store.syncTasksToPB).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label^="Congratulations"]')).toBeNull();
    const completeBtn = buttonByText("Complete")!;
    expect(completeBtn.querySelector('[class*="animate-spin"]')).toBeNull();
    // PIN cleared from state.
    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

describe("RewardsShop — honest error paths on the redemption PIN gate", () => {
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
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    vi.unstubAllGlobals();
  });

  async function openRedeem(el: HTMLElement, label: string) {
    const card = el.querySelector(`[aria-label^="${label}"]`) as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();
  }

  it("a SERVER ERROR (500) on the redeem PIN says 'Couldn't reach', never 'Wrong PIN'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const el = await renderAsync(<RewardsShop />);
    await settle();
    await openRedeem(el, "Ice cream trip — 40 points");

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect((document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement).value).toBe("");
  });

  it("a NETWORK REJECTION on the redeem PIN is unreachable, not a wrong PIN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const el = await renderAsync(<RewardsShop />);
    await settle();
    await openRedeem(el, "Ice cream trip — 40 points");

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
  });

  it("a server error during PARENT APPROVAL says 'Couldn't reach', not 'Parent PIN required'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    const el = await renderAsync(<RewardsShop />);
    await settle();
    await openRedeem(el, "Movie night — 150 points");
    expect(document.body.textContent || "").toContain("Parent Approval Required");

    const parentInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(parentInput, "0000"); });
    await act(async () => { buttonByText("Approve")!.click(); });
    await settle();

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Parent PIN required");
    expect(document.body.textContent || "").not.toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
  });

  it("a wrong parent PIN (401 for every parent) still reads 'Parent PIN required'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const el = await renderAsync(<RewardsShop />);
    await settle();
    await openRedeem(el, "Movie night — 150 points");

    const parentInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(parentInput, "9999"); });
    await act(async () => { buttonByText("Approve")!.click(); });
    await settle();

    expect(document.body.textContent || "").toContain("Parent PIN required to approve large rewards.");
    expect(store.saveWeekData).not.toHaveBeenCalled();
  });
});
