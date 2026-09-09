// @vitest-environment jsdom
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

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Caspian", role: "child" } as any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const modeMock = vi.hoisted(() => ({ isBedtime: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: modeMock.isBedtime, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [{ id: 1, name: "Caspian", fullName: "Caspian Garcia", color: "green", emoji: "🧒", role: "child" }],
    selectMembersDetailed: () => [{ name: "Caspian", color: "green", emoji: "🧒" }],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
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
  addTransaction: (week: any, type: string, amount: number, description: string, member: string, taskId?: number) => ({
    ...week,
    history: [...week.history, { id: 1, timestamp: "2026-09-04T12:00:00.000Z", type, amount, description, member, taskId }],
  }),
  weekKey: () => store.week.weekStart,
  getThisWeeksCompletedTasks: (tasks: any[]) => tasks.filter((t) => t.completed),
  getThisWeeksCompletedDates: () => [],
  calculateRealStreak: () => 0,
  syncTasksToPB: store.syncTasksToPB,
  syncWeekDataToPB: store.syncWeekDataToPB,
  // Trust-but-verify: the REAL single decision seam (child + open + assigned
  // + never snatchable). The old test mirror dropped the snatchable leg —
  // the real helper routes late stealable quests to the claim branch.
  shouldUsePendingTap: (role: string | undefined, task: any) =>
    role === "child" && !task.completed && !task.universal && !(task.stealable && !!task.due && task.due < "2026-09-04"),
  isSnatchable: (task: any, today: string = "2026-09-04") =>
    !!task.stealable && !task.completed && !!task.due && task.due < today,
  // Ledger-key mirror: roster-resolved FULL name (Jasmine-style splits).
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

const QUEST = { id: 7, title: "Feed the dog", points: 10, assignee: "Caspian", completed: false };

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

function fetchHandler(verifyOk: boolean) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      return verifyOk
        ? { ok: true, json: async () => ({ member: { name: "Caspian" } }) }
        : { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("KidHome quest completion (pending approval, PIN-free for kid quests)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    modeMock.isBedtime = false;
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
    vi.unstubAllGlobals();
  });

  it("tapping a quest opens the confirm sheet; confirming writes pendingApproval with zero earn tx and zero verify traffic", async () => {
    const spyFetch = vi.fn(async (..._args: any[]) => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();

    const card = el.querySelector('[aria-label^="Complete quest: Feed the dog"]') as HTMLElement;
    expect(card).not.toBeNull();

    await act(async () => { card.click(); });
    await settle();

    // Confirm sheet (portaled to body) is up; nothing persisted yet.
    const modalText = document.body.textContent || "";
    expect(modalText).toContain("Confirm it's you");
    expect(store.saveTasks).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label^="Congratulations"]')).toBeNull();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    const completeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Complete")) as HTMLButtonElement;
    await act(async () => { completeBtn.click(); });
    await settle();

    // Pending contract: done-but-unpaid, no earn, no verify round trip.
    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls[0][0];
    const row = saved.find((t: any) => t.id === 7);
    expect(row.completed).toBe(true);
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 10 });
    expect(typeof row.pendingApproval.at).toBe("string");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
    expect(store.week.history).toHaveLength(0);
    expect(spyFetch.mock.calls.filter((call) => String(call[0]).includes("/api/members/verify"))).toHaveLength(0);
    expect(store.syncTasksToPB).toHaveBeenCalled();

    // Celebration fires on the pending completion.
    expect(document.querySelector('[aria-label^="Congratulations"]')).not.toBeNull();
    // PIN never persisted anywhere.
    expect(localStorage.getItem("consuela-points-Caspian")).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain("1234");
  });

  it("ANY pin completes a kid quest as pending — no verify traffic, no earn, points unchanged", async () => {
    const spyFetch = vi.fn(async (..._args: any[]) => ({ ok: false, status: 401, json: async () => ({}) }));
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();
    const card = el.querySelector('[aria-label^="Complete quest: Feed the dog"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => { setInputValue(input, "9999"); });
    const completeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Complete")) as HTMLButtonElement;
    await act(async () => { completeBtn.click(); });
    await settle();

    // Even a "wrong" PIN lands pending: the kid gate no longer verifies.
    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls[0][0];
    expect(saved.find((t: any) => t.id === 7)?.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 10 });
    expect(spyFetch.mock.calls.filter((call) => String(call[0]).includes("/api/members/verify"))).toHaveLength(0);
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.week.history).toHaveLength(0);
    expect(document.querySelector('[aria-label^="Congratulations"]')).not.toBeNull();
    // PIN never persisted anywhere.
    expect(localStorage.getItem("consuela-points-Caspian")).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain("9999");
  });

  it("a confirmed quest is done-but-unpaid: pendingApproval present, points unchanged, history empty, tasks synced", async () => {
    const spyFetch = vi.fn(async (..._args: any[]) => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", spyFetch);
    const el = await renderAsync(<KidHome />);
    await settle();
    const card = el.querySelector('[aria-label^="Complete quest: Feed the dog"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    const completeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Complete")) as HTMLButtonElement;
    await act(async () => { completeBtn.click(); });
    await settle();

    // Done-but-unpaid: task row + pendingApproval via the store, zero earn.
    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls[0][0];
    const row = saved.find((t: any) => t.id === 7);
    expect(row.completed).toBe(true);
    expect(row.completedBy).toBe("Caspian Garcia");
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 10 });
    expect(row.completedInWeek).toBe("2026-09-01");
    // No points move until a parent approves: week store untouched.
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.week.points.Caspian).toBe(20);
    expect(store.week.history.some((tx: any) => tx.type === "earn")).toBe(false);
    expect(store.syncTasksToPB).toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
    expect(spyFetch.mock.calls.filter((call) => String(call[0]).includes("/api/members/verify"))).toHaveLength(0);

    // Celebration fires on the pending completion.
    expect(document.querySelector('[aria-label^="Congratulations"]')).not.toBeNull();
    // PIN cleared from state (input reset on modal close).
    expect(JSON.stringify(localStorage)).not.toContain("1234");
  });

  it("a stealable late quest routes through the server claim branch (NOT the pending path) — surface parity with the Tasks page", async () => {
    // M1: the old split keyed ONLY on task.universal — a stealable-late quest
    // completed pending on KidHome but claim-modal on the Tasks page. The
    // real shouldUsePendingTap gate (wired into KidHome now) routes
    // universal || isSnatchable through the claim path.
    const claimFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tasks/claim")) {
        return { ok: true, status: 200, json: async () => ({ success: true, claimedBy: "Caspian Garcia" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", claimFetch);
    store.tasks = [{ id: 11, title: "Late dishes", points: 8, assignee: "Caspian", completed: false, stealable: true, due: "2026-09-01" }];

    const el = await renderAsync(<KidHome />);
    await settle();
    const card = el.querySelector('[aria-label^="Complete quest: Late dishes"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    const completeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Complete")) as HTMLButtonElement;
    await act(async () => { completeBtn.click(); });
    await settle();

    // Claim POST happened. Since Task 6 (server-authoritative claims →
    // pending for kids), a CHILD claimant mirrors the route's pendingApproval
    // answer: the row is claimed done-but-unpaid, still with NO earn tx
    // (routing parity with the Tasks page claim modal is unchanged).
    expect(claimFetch).toHaveBeenCalledWith(expect.stringContaining("/api/tasks/claim"), expect.objectContaining({ method: "POST" }));
    const saved = store.saveTasks.mock.calls.at(-1)![0];
    const row = saved.find((t: any) => t.id === 11);
    expect(row.completed).toBe(true);
    expect(row.pendingApproval).toEqual({ byName: "Caspian Garcia", at: expect.any(String), points: 8 });
    expect(store.week.history).toHaveLength(0);
  });

  it("a successful universal claim carries completedBy/At/InWeek into the synced row (no field wipe)", async () => {    const claimFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tasks/claim")) {
        // Real route shape: { success, claimedBy: <server-normalized FULL
        // name>, weekData } — the local mirror must use claimedBy, not the
        // first-name user.name (a split ledger key).
        return { ok: true, status: 200, json: async () => ({ success: true, claimedBy: "Caspian Garcia" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", claimFetch);
    store.tasks = [{ id: 9, title: "Grab the mail", points: 12, assignee: "All", universal: true, completed: false }];

    const el = await renderAsync(<KidHome />);
    await settle();
    const card = el.querySelector('[aria-label^="Complete quest: Grab the mail"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    const completeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Complete")) as HTMLButtonElement;
    await act(async () => { completeBtn.click(); });
    await settle();

    expect(claimFetch).toHaveBeenCalledWith(expect.stringContaining("/api/tasks/claim"), expect.objectContaining({ method: "POST" }));
    // The claim route owns the server row — the local mirror must carry the
    // SAME completion fields, or syncTasksToPB pushes completedInWeek/At as
    // null and wipes what the server just wrote (the old { ...t, completed: true } bug).
    expect(store.syncTasksToPB).toHaveBeenCalled();
    const synced = store.syncTasksToPB.mock.calls.at(-1)![0];
    const row = synced.find((t: any) => t.id === 9);
    expect(row.completed).toBe(true);
    expect(row.completedBy).toBe("Caspian Garcia");
    expect(row.completedInWeek).toBe("2026-09-01");
    expect(typeof row.completedAt).toBe("string");
    // The saved local row matches (same array is saved + pushed).
    const saved = store.saveTasks.mock.calls.at(-1)![0];
    expect(saved.find((t: any) => t.id === 9).completedInWeek).toBe("2026-09-01");
  });

  it("a quest already completed this week (stale cache) never POSTs or re-awards points", async () => {
    const spyFetch = fetchHandler(true);
    vi.stubGlobal("fetch", spyFetch);
    // Server marked the row done this week; the local completed flag is stale.
    store.tasks = [{ ...QUEST, completedInWeek: "2026-09-01" }];

    const el = await renderAsync(<KidHome />);
    await settle();
    const card = el.querySelector('[aria-label^="Complete quest: Feed the dog"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    const completeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Complete")) as HTMLButtonElement;
    await act(async () => { completeBtn.click(); });
    await settle();

    // Double-completion guard (same as the Tasks page): refuse before any
    // verify/claim POST or point award.
    expect(spyFetch).not.toHaveBeenCalled();
    expect(store.saveTasks).not.toHaveBeenCalled();
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncTasksToPB).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label^="Congratulations"]')).toBeNull();
  });

  it("normal mode renders the EmergencyButton on kid Home", async () => {
    vi.stubGlobal("fetch", fetchHandler(true));
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.querySelector('[data-testid="emergency-button"]')).not.toBeNull();
  });

  it("bedtime mode still renders the EmergencyButton (a child asleep still has an alert path)", async () => {
    // Red-proof: the bedtime "sweet dreams" branch used to return a PageShell
    // WITHOUT the EmergencyButton, leaving a child between 8pm-6am with no
    // alert path on Home.
    modeMock.isBedtime = true;
    vi.stubGlobal("fetch", fetchHandler(true));
    const el = await renderAsync(<KidHome />);
    await settle();
    // The bedtime view is up (control), and the shield is still there.
    expect(el.textContent).toContain("Sweet dreams");
    expect(el.querySelector('[data-testid="emergency-button"]')).not.toBeNull();
  });
});
