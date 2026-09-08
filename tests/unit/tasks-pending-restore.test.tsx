// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, todayISO } from "@/lib/task-utils";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine Rose", role: "child", emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine Rose", role: "child", emoji: "👧", color: "rose" },
    ],
  },
}));

const MONDAY = todayMondayISO();
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
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tasks/sync")) {
      return { ok: true, status: 200, json: async () => ({ snapshot }) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  }));
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
});
