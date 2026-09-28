// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { localWeekStartISO } from "@/lib/local-date";
import { todayISO } from "@/lib/task-utils";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const serverTaskReads = vi.hoisted(() => ({ hall: [] as any[], archives: [] as any[] }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine Rose", role: "child", emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine Rose", role: "child", emoji: "👧", color: "rose" },
    ],
    selectHallOfFame: async () => serverTaskReads.hall,
    listArchivedWeeks: async () => serverTaskReads.archives,
  },
}));

const MONDAY = localWeekStartISO();
const NOW = new Date().toISOString();
// The row BOTH devices already share (parent created it, snapshot synced it
// to the kid's device). The kid tapped it on THEIR device — the snapshot now
// carries the completed+pending row while this device still has it open.
const SHARED_ID = 77;
const OPEN_ROW = { id: SHARED_ID, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };
const TAPPED_ROW = {
  ...OPEN_ROW,
  completed: true,
  completedBy: "Jasmine Rose",
  completedAt: NOW,
  completedInWeek: MONDAY,
  pendingApproval: { byName: "Jasmine Rose", at: NOW, points: 5 },
};

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function stubSnapshotFetch(snapshot: any) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input).includes("/api/tasks/sync")) {
      return { ok: true, status: 200, json: async () => ({ snapshot }) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}

function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  serverTaskReads.hall = [];
  serverTaskReads.archives = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

describe("cross-device snapshot restore on the Tasks page", () => {
  it("a kid's tap on ANOTHER device reaches this parent's open Needs-approval queue (known row, same id)", async () => {
    // Device B already has the open row; device A tapped it and pushed the
    // snapshot. The page's own restore must adopt the pending field change
    // on the KNOWN row — Home's badge (store merge) already does.
    stubSnapshotFetch({
      tasks: [TAPPED_ROW],
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    });
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([OPEN_ROW]);
    await renderAsync(<TasksPage />);
    await settle();

    expect(document.body.textContent || "").toContain("Needs approval");
    expect(storedTasks()[0].pendingApproval).toEqual({ byName: "Jasmine Rose", at: expect.any(String), points: 5 });
  });

  it("another device's APPROVAL clears this device's stale On-the-way row and lands the points", async () => {
    // This device (kid's tablet) still shows the row pending; the parent
    // approved elsewhere — snapshot has the cleared row + the earn tx.
    stubSnapshotFetch({
      tasks: [{ ...OPEN_ROW, completed: true, completedBy: "Jasmine Rose", completedAt: NOW, completedInWeek: MONDAY }],
      weekData: {
        weekStart: MONDAY, points: { "Jasmine Rose": 5 }, streak: {}, lastActive: {},
        history: [{ id: 7, timestamp: NOW, member: "Jasmine Rose", type: "earn", amount: 5, description: "Completed: Make bed (+5pts)", taskId: SHARED_ID }],
      },
    });
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([TAPPED_ROW]);
    await renderAsync(<TasksPage />);
    await settle();

    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedTasks()[0].completed).toBe(true);
    expect(storedWeek().points["Jasmine Rose"]).toBe(5);
    expect(storedWeek().history).toHaveLength(1);
  });

  it("a fresh tap on THIS device is never clobbered by a stale snapshot without proof", async () => {
    // Guard the guard: a snapshot that predates the tap (open row) must not
    // wipe a locally fresh pending tap (no earn tx, no sentBackAt proof).
    stubSnapshotFetch({
      tasks: [OPEN_ROW],
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    });
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([TAPPED_ROW]);
    await renderAsync(<TasksPage />);
    await settle();

    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(document.body.textContent || "").toContain("Needs approval");
  });

  it("loads server HOF and previous archive ranks on a fresh device", async () => {
    const priorDate = new Date(`${MONDAY}T12:00:00Z`);
    priorDate.setUTCDate(priorDate.getUTCDate() - 7);
    const prior = priorDate.toISOString().slice(0, 10);
    serverTaskReads.hall = [{
      member: "Rebecca (Mom)",
      emoji: "👩",
      weekStart: prior,
      points: 20,
      rank: 1,
      prize: "Server prize",
    }];
    serverTaskReads.archives = [{ weekStart: prior, points: JSON.stringify({ "Rebecca (Mom)": 20 }) }];
    stubSnapshotFetch({
      tasks: [OPEN_ROW],
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    });
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([OPEN_ROW]);
    localStorage.removeItem("consuela-hall-of-fame");
    localStorage.removeItem("consuela-previous-ranks");
    await renderAsync(<TasksPage />);
    await settle();

    expect(JSON.parse(localStorage.getItem("consuela-hall-of-fame") || "[]")).toEqual([
      expect.objectContaining({ member: "Rebecca (Mom)", points: 20, prize: "Server prize" }),
    ]);
    expect(JSON.parse(localStorage.getItem("consuela-previous-ranks") || "{}")).toEqual({
      "Rebecca (Mom)": 1,
    });
  });

  it("uses the task sync endpoint for reads only", async () => {
    const fetchMock = stubSnapshotFetch({
      tasks: [OPEN_ROW],
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    });
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([OPEN_ROW]);
    await renderAsync(<TasksPage />);
    await settle(5300);

    const taskSyncCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/tasks/sync"));
    expect(taskSyncCalls.length).toBeGreaterThan(0);
    expect(taskSyncCalls.every((call) => (call[1] as RequestInit | undefined)?.method !== "POST")).toBe(true);
  }, 7000);
});
