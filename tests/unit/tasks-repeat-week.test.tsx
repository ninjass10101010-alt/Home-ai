// @vitest-environment jsdom
// Task 8 — "Repeat last week": the parent-only header action, the confirmation
// sheet (per-row remove), and the confirm handler's durable bulk adds. The feed
// arrives through the REAL restoreFromSnapshot path (a stubbed /api/tasks/sync
// snapshot), never through a page-local shortcut.
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
    refreshMembersCache: vi.fn(async () => true),
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

import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import { getISO } from "@/lib/due-date-utils";
import { localWeekStartISO } from "@/lib/local-date";
import TasksPage from "@/app/tasks/page";

// The feed key, computed from the documented rule (local day 7 days ago →
// that week's Monday) INDEPENDENTLY of the implementation under test.
const LAST_MONDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return localWeekStartISO(d);
})();
const THIS_MONDAY = localWeekStartISO();

const FEED = [
  { title: "Walk the Dogs", points: 10, category: "Chores", priority: "medium", assigneeName: "Emily" },
  { title: "Take out trash", points: 8, category: "Chores", priority: "low", universal: true },
];

function stubSync(archivedTasks: Record<string, any[]>) {
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    if (url.includes("/api/tasks/sync") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          snapshot: {
            tasks: [],
            weekData: { weekStart: THIS_MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
            archivedTasks,
          },
        }),
      };
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

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function repeatButton(root: ParentNode): HTMLButtonElement | null {
  return (Array.from(root.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes("Repeat last week")
  ) as HTMLButtonElement | undefined) ?? null;
}

function dialogAt(index = 0): HTMLElement {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const found = dialogs[index] as HTMLElement | undefined;
  if (!found) throw new Error(`no dialog at ${index}`);
  return found;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === text
  );
  if (!found) throw new Error(`no button: ${text}`);
  return found as HTMLButtonElement;
}

function isManageAdd(entry: { route: string; action: string }): boolean {
  return entry.route === "/api/tasks/manage" && entry.action === "add";
}

async function renderParent(): Promise<HTMLElement> {
  mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
  mockAuth.isLoggedIn = true;
  const el = await renderAsync(<TasksPage />);
  await settle();
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
});

describe("Task 8 — repeat last week", () => {
  it("1. parent + non-empty feed sees the button; guest and kid do not", async () => {
    stubSync({ [LAST_MONDAY]: FEED });

    // Guest: no button.
    mockAuth.currentUser = null; mockAuth.isLoggedIn = false;
    let el = await renderAsync(<TasksPage />); await settle();
    expect(repeatButton(el)).toBeNull();

    // Kid: no button (their surface is KidHome).
    mockAuth.currentUser = { name: "Caspian Garcia", role: "child", age: 5 }; mockAuth.isLoggedIn = true;
    el = await renderAsync(<TasksPage />); await settle(200);
    expect(repeatButton(el)).toBeNull();

    // Parent: the feed reaches the page through restoreFromSnapshot.
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" }; mockAuth.isLoggedIn = true;
    el = await renderAsync(<TasksPage />); await settle();
    const btn = repeatButton(el);
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Repeat last week (2)");
  });

  it("2. an empty feed hides the button (honest empty)", async () => {
    stubSync({ [LAST_MONDAY]: [] });
    const el = await renderParent();
    expect(repeatButton(el)).toBeNull();
  });

  it("3. tap opens the sheet listing both defs (title + points); ✕ removes one row", async () => {
    stubSync({ [LAST_MONDAY]: FEED });
    const el = await renderParent();
    await act(async () => { repeatButton(el)!.click(); });
    await settle();

    const sheet = dialogAt();
    expect(sheet.textContent).toContain("Walk the Dogs");
    expect(sheet.textContent).toContain("+10 pts");
    expect(sheet.textContent).toContain("Take out trash");
    expect(sheet.textContent).toContain("+8 pts");

    const remove = sheet.querySelector('button[aria-label="Remove Walk the Dogs"]') as HTMLButtonElement;
    expect(remove).toBeTruthy();
    await act(async () => { remove.click(); });
    await settle();

    const after = dialogAt();
    expect(after.textContent).not.toContain("Walk the Dogs");
    expect(after.textContent).toContain("Take out trash");
  });

  it("4. nothing is queued before Confirm; Confirm queues exactly one manage add per remaining def", async () => {
    stubSync({ [LAST_MONDAY]: FEED });
    const el = await renderParent();
    await act(async () => { repeatButton(el)!.click(); });
    await settle();
    expect(listTaskOutbox()).toHaveLength(0);

    const remove = dialogAt().querySelector('button[aria-label="Remove Walk the Dogs"]') as HTMLButtonElement;
    await act(async () => { remove.click(); });
    await settle();
    expect(listTaskOutbox()).toHaveLength(0);

    await act(async () => { buttonByText(dialogAt(), "Confirm").click(); });
    await settle(200);

    const entries = listTaskOutbox().filter(isManageAdd);
    expect(entries).toHaveLength(1);
    const task = (entries[0].payload as any).task;
    expect(task.title).toBe("Take out trash");
    expect(task.due).toBe(getISO.today);
    expect(task.recurring).toBeNull();
  });

  it("5. each def gets its own operationId, due today, recurring null, and its mode fields", async () => {
    stubSync({ [LAST_MONDAY]: FEED });
    const el = await renderParent();
    await act(async () => { repeatButton(el)!.click(); });
    await settle();
    await act(async () => { buttonByText(dialogAt(), "Confirm").click(); });
    await settle(200);

    const entries = listTaskOutbox().filter(isManageAdd);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.operationId)).size).toBe(2);
    for (const entry of entries) {
      expect((entry.payload as any).task.due).toBe(getISO.today);
      expect((entry.payload as any).task.recurring).toBeNull();
    }
    const assigned = entries.find((e) => (e.payload as any).task.title === "Walk the Dogs")!;
    expect((assigned.payload as any).task).toMatchObject({ assignee: "Emily", assigneeEmoji: "👧" });
    const open = entries.find((e) => (e.payload as any).task.title === "Take out trash")!;
    expect((open.payload as any).task).toMatchObject({ universal: true, assignee: "All" });
  });
});
