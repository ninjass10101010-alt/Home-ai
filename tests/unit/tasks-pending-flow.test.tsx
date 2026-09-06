// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, todayISO, weekKey } from "@/lib/task-utils";
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
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
  },
}));

const MONDAY = todayMondayISO();
const OPEN = { id: 51, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function stubGuestFetches() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
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

function storedHistory(): any[] {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}").history || [];
}

function verifyCalls(): string {
  return ((globalThis.fetch as any)?.mock?.calls || []).flat().join(" ");
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

describe("kid tap-to-complete", () => {
  it("child tap marks done with pending record, zero earn tx, zero PIN traffic", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Jasmine", role: "child" };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toEqual({ byName: "Jasmine", at: expect.any(String), points: 5 });
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).not.toContain("/api/members/verify");
    expect(el.textContent || "").toContain("on the way");
  });

  it("adult tap still opens a real dialog and writes no pending record", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const jasmineTile = [...el.querySelectorAll(".member-tile-name")].find((s) => (s.textContent || "").trim() === "Jasmine")!.closest("button") as HTMLElement;
    await act(async () => { jasmineTile.click(); });
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    await act(async () => { row.click(); });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
  });

  it("guest tap creates no pending record", async () => {
    stubGuestFetches();
    seed([OPEN]);
    await renderAsync(<TasksPage />);
    await settle();

    const row = document.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    await act(async () => { row.click(); });
    await settle();

    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("pending rows show On the way and the owner can self-cancel PIN-free", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Jasmine", role: "child" };
    mockAuth.isLoggedIn = true;
    seed([{ ...OPEN, completed: true, completedBy: "Jasmine", completedAt: new Date().toISOString(), completedInWeek: weekKey(), pendingApproval: { byName: "Jasmine", at: new Date().toISOString(), points: 5 } }]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const toggle = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("completed")) as HTMLElement;
    await act(async () => { toggle.click(); });
    await settle();

    expect(el.textContent || "").toContain("On the way");
    const cancel = el.querySelector('[aria-label="Cancel completion of Make bed"]') as HTMLElement;
    expect(cancel).not.toBeNull();
    await act(async () => { cancel.click(); });
    await settle();

    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).not.toContain("/api/members/verify");
  });
});
