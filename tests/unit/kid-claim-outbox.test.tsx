// 2026-09-23 review, Critical #2 — the kid claim OUTBOX.
//
// A fire-and-forget POST /api/tasks/claim that failed (network / 5xx / an
// expired 15-min kid session) used to strand a kid's completion FOREVER:
// the parent approval queue reads the server snapshot, the local pending row
// never reached it, re-tap was blocked by the completedInWeek guard, kids
// are redirected off /tasks so the self-cancel was unreachable, and a stuck
// pending row stopped recurring tasks from regenerating. These tests pin the
// fixed end-to-end shape: an honest non-blocking notice, a re-POST on the
// refresh tick until the server confirms, legacy-orphan adoption for taps
// that predate the server handoff, and the PIN-free kid self-cancel.
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

// Under-10 by default: assigned quests complete PIN-free (the age predicates
// are the whole gate). Per-test overrides flip age for the 10+/missing cases.
const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Caspian", role: "child", age: 5 } as any }));
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
  saveTasks: vi.fn(async (tasks: any[]) => { store.tasks = tasks.map((t: any) => ({ ...t })); }),
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
  // The REAL age predicates (mirrored here the way the old pre-age seam
  // mirror did): under-10 + child + open + assigned + never
  // snatchable completes PIN-free; every child completion still lands
  // pending-approval after the PIN gate.
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
  isCrewTask: (task: any) => !!task && typeof task.crewSize === "number" && task.crewSize >= 2,
  crewFull: (task: any) => {
    const members = Array.isArray(task?.crew?.members) ? task.crew.members.length : 0;
    return !!task && typeof task.crewSize === "number" && task.crewSize >= 2 && members >= task.crewSize;
  },
  crewHasMember: (task: any, name: string) =>
    !!task?.crew?.members?.some((m: any) => m.name === name),
  crewMemberCount: (task: any) =>
    Array.isArray(task?.crew?.members) ? task.crew.members.length : 0,
  crewCheckinProgress: (task: any) => ({
    checkedIn:
      task?.crew?.members?.filter((m: any) => !!m.checkedInAt).length || 0,
    total: typeof task?.crewSize === "number" ? task.crewSize : 0,
  }),
  // The three helpers kid-board.ts imports (the pure module replaces this
  // mock wholesale — without them its imports resolve to undefined).
  crewMembers: (task: any) => (Array.isArray(task?.crew?.members) ? task.crew.members : []),
  crewMemberCheckedIn: (task: any, name: string) =>
    !!task?.crew?.members?.some((m: any) => m.name === name && !!m.checkedInAt),
  crewAllCheckedIn: (task: any) => {
    const members = Array.isArray(task?.crew?.members) ? task.crew.members : [];
    const total = typeof task?.crewSize === "number" ? task.crewSize : 0;
    return total >= 2 && members.length >= total && members.every((m: any) => !!m.checkedInAt);
  },
  getDaysUntilWeekReset: () => 3,
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
  // 2026-09-23 review: the claim outbox + kid self-cancel seams.
  isPendingApproval: (task: any) => !!task?.completed && !!task?.pendingApproval,
  sendBackPendingCompletion: (tasks: any[], taskId: number) => {
    const task = tasks.find((t: any) => t.id === taskId);
    if (!task || !(!!task.completed && !!task.pendingApproval)) return tasks;
    return tasks.map((t: any) =>
      t.id === taskId
        ? {
            ...t,
            completed: false,
            completedBy: undefined,
            completedAt: undefined,
            completedInWeek: undefined,
            pendingApproval: undefined,
            sentBackAt: new Date().toISOString(),
          }
        : t
    );
  },
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => <div data-testid="emergency-button" /> }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
// KidHome mounts the weekly-win ceremony (Task 10) — stubbed out here; the
// task-utils mock above doesn't carry the hall-of-fame helpers it reads.
vi.mock("@/components/leaderboard/WeeklyWinModal", () => ({ default: () => null }));
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

/** claimResponses: sequential handlers — "throw" (network), 401, or 200. */
function stubFetchWithClaims(claimResponses: Array<"throw" | 401 | 200>) {
  const calls: any[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member: { name: "Caspian", role: "child" } }) } as any;
    }
    if (url.includes("/api/tasks/claim")) {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push(body);
      const mode = claimResponses[Math.min(n, claimResponses.length - 1)];
      n += 1;
      if (mode === "throw") throw new TypeError("Failed to fetch");
      if (mode === 401) return { ok: false, status: 401, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ success: true, pending: true, claimedBy: body.memberName }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  }));
  return calls;
}

function claimCallsFor(calls: any[], taskId: number) {
  return calls.filter((b) => b.action === "complete" && b.taskId === taskId);
}

async function tapQuest(el: HTMLElement, title: string) {
  const card = el.querySelector(`[aria-label^="Complete quest: ${title}"]`) as HTMLElement;
  expect(card).not.toBeNull();
  await act(async () => { card.click(); });
  await settle();
}

function bumpRefresh() {
  act(() => { window.dispatchEvent(new Event("consuela-data-refreshed")); });
}

describe("KidHome claim outbox (failed claim → notice → retry → confirm)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    modeMock.isBedtime = false;
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    store.tasks = [{ ...QUEST }];
    store.week = { weekStart: "2026-09-01", points: {}, streak: {}, lastActive: {}, history: [] };
    store.saveTasks.mockClear();
    store.syncTasksToPB.mockClear();
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("a failed claim POST keeps the celebration but surfaces an honest, non-blocking notice", async () => {
    const calls = stubFetchWithClaims(["throw"]);
    const el = await renderAsync(<KidHome />);
    await settle();
    await tapQuest(el, QUEST.title);

    // The optimistic row still lands (the kid flow never blocks on a 5xx).
    expect(store.tasks[0].completed).toBe(true);
    expect(store.tasks[0].pendingApproval).toBeTruthy();
    expect(claimCallsFor(calls, QUEST.id)).toHaveLength(1);
    // The exact contract body is unchanged.
    expect(claimCallsFor(calls, QUEST.id)[0]).toEqual({
      action: "complete",
      taskId: QUEST.id,
      memberName: "Caspian Garcia",
      assigneeEmoji: undefined,
    });
    expect(el.textContent).toContain("Still sending 1 chore");
  });

  it("the refresh tick re-POSTs the unconfirmed claim and the notice clears once the server confirms", async () => {
    const calls = stubFetchWithClaims(["throw", 200]);
    const el = await renderAsync(<KidHome />);
    await settle();
    await tapQuest(el, QUEST.title);
    expect(el.textContent).toContain("Still sending 1 chore");

    // One 60s refresh tick later: the outbox retries.
    bumpRefresh();
    await settle();
    expect(claimCallsFor(calls, QUEST.id)).toHaveLength(2);
    // Server confirmed → the notice is gone (self-clearing).
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(el.textContent).not.toContain("Still sending");
  });

  it("a 401 (expired kid session) stalls the retry and asks a grown-up instead of hammering", async () => {
    const calls = stubFetchWithClaims([401]);
    const el = await renderAsync(<KidHome />);
    await settle();
    await tapQuest(el, QUEST.title);
    expect(el.textContent).toContain("ask a grown-up");

    // A stalled entry never re-POSTs.
    bumpRefresh();
    await settle();
    expect(claimCallsFor(calls, QUEST.id)).toHaveLength(1);
  });

  it("a legacy orphan pending row (pre-server-handoff tap) is adopted and delivered on mount", async () => {
    // A pending row that only ever existed in this device's localStorage —
    // the parent queue reads the server snapshot, so it was invisible forever.
    store.tasks = [{
      ...QUEST,
      completed: true,
      completedBy: "Caspian Garcia",
      completedAt: new Date().toISOString(),
      completedInWeek: "2026-09-01",
      // Five minutes old — past the two-minute in-flight floor.
      pendingApproval: { byName: "Caspian Garcia", at: new Date(Date.now() - 5 * 60_000).toISOString(), points: 10 },
    }];
    const calls = stubFetchWithClaims([200]);
    const el = await renderAsync(<KidHome />);
    await settle();

    expect(claimCallsFor(calls, QUEST.id)).toHaveLength(1);
    expect(claimCallsFor(calls, QUEST.id)[0].memberName).toBe("Caspian Garcia");
    expect(el.textContent).not.toContain("Still sending");
  });

  it("a FRESH pending row is not re-POSTed by the legacy scan (in-flight guard)", async () => {
    store.tasks = [{
      ...QUEST,
      completed: true,
      completedBy: "Caspian Garcia",
      completedAt: new Date().toISOString(),
      completedInWeek: "2026-09-01",
      pendingApproval: { byName: "Caspian Garcia", at: new Date().toISOString(), points: 10 },
    }];
    const calls = stubFetchWithClaims([200]);
    await renderAsync(<KidHome />);
    await settle();
    expect(claimCallsFor(calls, QUEST.id)).toHaveLength(0);
  });

  it("the kid self-cancel reopens the row with the durable send-back stamp and stops the retry", async () => {
    store.tasks = [{
      ...QUEST,
      completed: true,
      completedBy: "Caspian Garcia",
      completedAt: new Date().toISOString(),
      completedInWeek: "2026-09-01",
      pendingApproval: { byName: "Caspian Garcia", at: new Date().toISOString(), points: 10 },
    }];
    const calls = stubFetchWithClaims([200]);
    const el = await renderAsync(<KidHome />);
    await settle();

    // Pending taps render honestly ("on the way") with a PIN-free cancel.
    expect(el.textContent).toContain("on the way");
    const cancel = el.querySelector(`[aria-label^="Cancel: ${QUEST.title}"]`) as HTMLElement;
    expect(cancel).not.toBeNull();
    await act(async () => { cancel.click(); });
    await settle();

    // Reopened with the SAME durable proof the parent send-back uses — the
    // merge gates and the sync push guard both honour it.
    expect(store.tasks[0].completed).toBe(false);
    expect(store.tasks[0].pendingApproval).toBeUndefined();
    expect(typeof store.tasks[0].sentBackAt).toBe("string");
    expect(el.textContent).not.toContain("on the way");
    // The cancelled row is never delivered as a claim.
    expect(claimCallsFor(calls, QUEST.id)).toHaveLength(0);
  });
});
