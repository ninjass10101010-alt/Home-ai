// @vitest-environment jsdom
// B1b — D9: a queued command must never make its row invisible everywhere. A
// completion whose row is hidden by a queued delete (or by a reload that drops
// the in-memory mark) still renders ONE "On the way" affordance resolved by the
// outbox entry's own displayTarget title.
// D10: an unrelated command's ack may release only ITS task's double-tap
// guard, never the whole set.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { localWeekStartISO } from "@/lib/local-date";

import {
  TASK_OUTBOX_STORAGE_KEY,
  __resetTaskOutboxForTests,
  listTaskOutbox,
  cancelTaskOutboxEntry,
} from "@/lib/task-command-store";
import { queueTaskCommand } from "@/lib/task-command-queue";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({
  currentUser: { name: "Caspian", role: "child", age: 7 } as any,
  isLoggedIn: true,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const ROSTER = [
  { id: 1, name: "Rebecca", fullName: "Rebecca Mom", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 7, emoji: "🧒", color: "cyan" },
];

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => ROSTER,
    selectMembersFallback: () => ROSTER,
    listArchivedWeeks: vi.fn(async () => []),
    selectHallOfFame: vi.fn(async () => []),
  },
}));

const MONDAY = localWeekStartISO();

function seedTasks() {
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 101, title: "Quest A", assignee: "Caspian Garcia", assigneeEmoji: "🧒", points: 6, recurring: null, category: "Chores", completed: false, priority: "low", universal: false },
    { id: 102, title: "Quest B", assignee: "Caspian Garcia", assigneeEmoji: "🧒", points: 8, recurring: null, category: "Chores", completed: false, priority: "low", universal: false },
  ]));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("/api/tasks/sync")) {
      return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) } as any;
    }
    if (url === "/api/tasks/queue") {
      return { ok: true, status: 200, json: async () => ({ rows: [] }) } as any;
    }
    if (url.includes("/api/tasks/claim") || url.includes("/api/tasks/manage")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ ok: false, reason: "task_store_unavailable", error: "The family server could not apply this change just yet." }),
      } as any;
    }
    return { ok: false, status: 401, json: async () => ({}) } as any;
  }));
}

let root: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(ui);
  });
  return el;
}

async function settle(ms = 80) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  installFetch();
});

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
  document.body.innerHTML = "";
});

describe("D9 — a queued command's row is never invisible everywhere", () => {
  it("a queued completion and a queued delete render exactly one affordance, resolved by title", async () => {
    seedTasks();
    queueTaskCommand({
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 101, memberName: "Caspian Garcia" },
      displayTarget: { kind: "claim", taskId: 101, title: "Quest A" },
    });
    queueTaskCommand({
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 101 },
      displayTarget: { kind: "task", taskId: 101, title: "Quest A" },
    });

    const el = await renderAsync(<TasksPage />);
    await settle();

    const rows = el.querySelectorAll('[data-testid="optimistic-task-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Quest A");
    // The queued delete still hides the board row — the strip is the fallback,
    // not a second copy.
    expect(el.querySelector('[aria-label="Complete Quest A"]')).toBeNull();
  });

  it("re-seeds the affordance from the persisted command after a reload", async () => {
    seedTasks();
    queueTaskCommand({
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 101, memberName: "Caspian Garcia" },
      displayTarget: { kind: "claim", taskId: 101, title: "Quest A" },
    });
    const persisted = localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
    expect(persisted).toBeTruthy();

    __resetTaskOutboxForTests();
    localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, persisted!);

    const el = await renderAsync(<TasksPage />);
    await settle();

    const rows = el.querySelectorAll('[data-testid="optimistic-task-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Quest A");
  });
});

describe("D10 — an unrelated ack releases only its own task's guard", () => {
  it("does not release the double-tap guard for another task", async () => {
    seedTasks();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const rowA = el.querySelector('[aria-label="Complete Quest A"]') as HTMLElement;
    expect(rowA).toBeTruthy();

    let unrelated: ReturnType<typeof queueTaskCommand> | null = null;
    await act(async () => {
      unrelated = queueTaskCommand({
        route: "/api/tasks/claim",
        action: "complete",
        payload: { taskId: 102, memberName: "Caspian Garcia" },
        displayTarget: { kind: "claim", taskId: 102, title: "Quest B" },
      });
    });

    // Everything inside one act: tap A (arms the guard), an unrelated command
    // acks, tap A again. The DOM is still pre-render, exactly like a fast
    // double-tap racing an ack.
    await act(async () => {
      rowA.click();
      cancelTaskOutboxEntry(unrelated!.operationId);
      rowA.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const completes = listTaskOutbox().filter(
      (entry) => entry.route === "/api/tasks/claim" &&
        entry.action === "complete" &&
        Number(entry.payload.taskId) === 101,
    );
    expect(completes).toHaveLength(1);
    expect(el.textContent || document.body.textContent).toContain("That tap is already on its way.");
  });
});
