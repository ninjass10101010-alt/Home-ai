// @vitest-environment jsdom
// P0 safety gates: kids/guests must not be able to add, edit, or delete family
// tasks; kids are redirected to their KidHome quest surface; delete confirms.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => routerMock,
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", age: 14, emoji: "👧", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
    ],
  },
}));

import TasksPage from "@/app/tasks/page";

const TODAY = new Date().toISOString().split("T")[0];

function seedTask() {
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 77, title: "Walk the Dogs", assignee: "Emily", assigneeEmoji: "👧", due: TODAY, points: 10, recurring: null, category: "Chores", completed: false, priority: "medium" },
  ]));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [] }));
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}
async function settle(ms = 120) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); }

function swipeLeft(row: HTMLElement) {
  const opts = (x: number) => ({ bubbles: true, pointerId: 1, clientX: x });
  row.dispatchEvent(new (window.PointerEvent || window.Event)("pointerdown", opts(300)));
  row.dispatchEvent(new (window.PointerEvent || window.Event)("pointermove", opts(180)));
  row.dispatchEvent(new (window.PointerEvent || window.Event)("pointerup", opts(160)));
}

function storedTasks(): any[] { return JSON.parse(localStorage.getItem("consuela-tasks") || "[]"); }

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
});

describe("P0 — tasks-page safety gates", () => {
  it("a PARENT sees the Add Task button; a guest and a child do not", async () => {
    seedTask();

    // Guest: no Add button.
    mockAuth.currentUser = null; mockAuth.isLoggedIn = false;
    let el = await renderAsync(<TasksPage />); await settle();
    expect(el.querySelectorAll('button[aria-label="Add task"]').length).toBe(0);

    // Child: no Add button either.
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 }; mockAuth.isLoggedIn = true;
    el = await renderAsync(<TasksPage />); await settle();
    expect(el.querySelectorAll('button[aria-label="Add task"]').length).toBe(0);

    // Parent: Add button present.
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" }; mockAuth.isLoggedIn = true;
    el = await renderAsync(<TasksPage />); await settle();
    expect(el.querySelectorAll('button[aria-label="Add task"]').length).toBe(1);
  });

  it("a CHILD session on /tasks is redirected to their KidHome surface", async () => {
    seedTask();
    mockAuth.currentUser = { name: "Caspian Garcia", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    await renderAsync(<TasksPage />); await settle(200);
    expect(routerMock.replace).toHaveBeenCalledWith("/");
  });

  it("a PARENT session is NOT redirected away from /tasks", async () => {
    seedTask();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    await renderAsync(<TasksPage />); await settle(200);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("swipe-to-edit is gated: a guest's swipe does NOT open the Edit modal", async () => {
    seedTask();
    mockAuth.currentUser = null; mockAuth.isLoggedIn = false;
    const el = await renderAsync(<TasksPage />); await settle();
    const row = el.querySelector("[role='button'][aria-label*='Walk the Dogs']") as HTMLElement;
    expect(row).toBeTruthy();
    await act(async () => { swipeLeft(row); });
    await settle();
    expect(document.body.textContent).not.toMatch(/Edit Task/);
  });

  it("delete requires confirmation: first tap opens a confirm, task survives until confirmed", async () => {
    // The parent's filter defaults to "My Tasks" — seed THEIR chore so the
    // row is visible for the swipe.
    localStorage.setItem("consuela-tasks", JSON.stringify([
      { id: 77, title: "Walk the Dogs", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: TODAY, points: 10, recurring: null, category: "Chores", completed: false, priority: "medium" },
    ]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [] }));
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    const el = await renderAsync(<TasksPage />); await settle();

    // Parent swipes left on the row → Edit modal opens.
    const row = el.querySelector("[role='button'][aria-label*='Walk the Dogs']") as HTMLElement;
    await act(async () => { swipeLeft(row); });
    await settle();
    expect(document.body.textContent).toMatch(/Edit Task/);

    // Tap Delete → a confirmation appears; the task is still there.
    const delBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete");
    expect(delBtn).toBeTruthy();
    await act(async () => { delBtn!.click(); });
    await settle();
    expect(document.body.textContent).toMatch(/can't be undone|cannot be undone|This can't be undone/i);
    expect(storedTasks()).toHaveLength(1);

    // Confirm the deletion → the task is gone.
    const confirmBtn = [...document.querySelectorAll("button")].find((b) => /Delete/i.test(b.textContent) && b !== delBtn);
    await act(async () => { confirmBtn!.click(); });
    await settle();
    expect(storedTasks()).toHaveLength(0);
  });

  it("a CHILD cannot reach the edit modal even by swiping (gate defense-in-depth)", async () => {
    seedTask();
    mockAuth.currentUser = { name: "Caspian Garcia", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    const el = await renderAsync(<TasksPage />); await settle(200);
    // The redirect fires; even before it lands, a swipe must not open Edit.
    const row = el.querySelector("[role='button'][aria-label*='Walk the Dogs']") as HTMLElement;
    if (row) {
      await act(async () => { swipeLeft(row); });
      await settle();
      expect(document.body.textContent).not.toMatch(/Edit Task/);
    }
  });
});
