// @vitest-environment jsdom
// B1a D5/D6/D7 — the review dialogs tell the truth and own their timers.
//
// D6: a wrong PIN used to read "Parent PIN required to review tapped tasks."
// — the same sentence as "no parent is on the roster", which reads as a
// permission error. D7: the three review openers never cleared the dialog timer
// registry, so one attempt's 2500 ms error-clear erased the next dialog's
// error. D5: an approval refusal now names its real reason.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/tasks",
}));

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Rebecca", role: "parent", emoji: "👩" } as any, isLoggedIn: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const roster = vi.hoisted(() => ({ members: [] as any[] }));
vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => roster.members,
    selectMembersFallback: () => roster.members,
  },
}));

import TasksPage from "@/app/tasks/page";
import { localWeekStartISO } from "@/lib/local-date";
import { todayISO } from "@/lib/task-utils";
import { __resetTaskOutboxForTests } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";

const MONDAY = localWeekStartISO();
const PARENTS = [
  { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
  { id: 4, name: "David", fullName: "David (Dad)", role: "parent", emoji: "👨", color: "amber" },
];
const CHILDREN = [
  { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
  { id: 3, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 7, emoji: "🌈", color: "mint" },
];

function pendingRow(id: number, title: string, assignee: string, emoji: string) {
  return {
    id,
    title,
    assignee,
    assigneeEmoji: emoji,
    due: todayISO(),
    points: 5,
    recurring: null,
    category: "Chores",
    completed: true,
    completedBy: assignee,
    completedAt: "2026-09-19T18:00:00.000Z",
    completedInWeek: MONDAY,
    priority: "low",
    pendingApproval: { byName: assignee, at: "2026-09-19T18:00:00.000Z", points: 5 },
  };
}

function seedTwo() {
  localStorage.setItem("consuela-tasks", JSON.stringify([
    pendingRow(101, "Quest A", "Caspian Garcia", "🧒"),
    pendingRow(102, "Quest B", "Aurora Garcia", "🌈"),
  ]));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
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
async function settle(ms = 120) {
  if (vi.isFakeTimers()) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    return;
  }
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function verifyFetch(mode: "wrongPin" | "ok" | "unreachable", approveBody?: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      if (mode === "unreachable") throw new Error("network down");
      if (mode === "ok") {
        return { ok: true, status: 200, json: async () => ({ member: { name: "Rebecca (Mom)", role: "parent", emoji: "👩" } }) } as any;
      }
      return { ok: false, status: 401, json: async () => ({ error: "Invalid PIN" }) } as any;
    }
    if (url.includes("/api/tasks/approve")) {
      return { ok: false, status: 404, json: async () => approveBody ?? ({ reason: "unknown-task", code: "unknown_task" }) } as any;
    }
    return { ok: false, status: 401, json: async () => ({}) } as any;
  });
}

async function openApprovalFor(el: HTMLElement, title: string, pin: string) {
  const approveButton = el.querySelector(`button[aria-label="Approve ${title}"]`) as HTMLButtonElement;
  await act(async () => { approveButton.click(); });
  await settle();
  const input = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
  await act(async () => { setInput(input, pin); });
  const dialog = document.querySelector('[role="dialog"]');
  const confirm = [...dialog!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Approve");
  await act(async () => { confirm!.click(); });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  roster.members = [...PARENTS, ...CHILDREN];
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
});

afterEach(async () => {
  vi.useRealTimers();
  if (activeRoot) {
    await act(async () => { activeRoot!.unmount(); });
    activeRoot = null;
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the review dialog says what actually happened", () => {
  it("says the PIN was wrong, not that a grown-up is required", async () => {
    seedTwo();
    vi.stubGlobal("fetch", verifyFetch("wrongPin"));
    const el = await renderAsync(<TasksPage />);
    await settle();
    await openApprovalFor(el, "Quest A", "9999");

    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toContain("wasn't right");
    expect(error?.textContent).not.toContain("Parent PIN required");
  });

  it("keeps the permission sentence when the roster holds no parent", async () => {
    seedTwo();
    roster.members = [...CHILDREN];
    vi.stubGlobal("fetch", verifyFetch("ok"));
    const el = await renderAsync(<TasksPage />);
    await settle();
    await openApprovalFor(el, "Quest A", "1234");

    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toBe("Parent PIN required to review tapped tasks.");
  });

  it("says the server was unreachable for an outage", async () => {
    seedTwo();
    vi.stubGlobal("fetch", verifyFetch("unreachable"));
    const el = await renderAsync(<TasksPage />);
    await settle();
    await openApprovalFor(el, "Quest A", "1234");

    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toContain("Couldn't reach Consuela");
  });

  it("does not erase the next dialog's error with the previous attempt's timer", async () => {
    vi.useFakeTimers();
    seedTwo();
    vi.stubGlobal("fetch", verifyFetch("wrongPin"));
    const el = await renderAsync(<TasksPage />);
    await settle(50);

    // Attempt A: wrong PIN arms its 2500 ms error-clear.
    await openApprovalFor(el, "Quest A", "1111");
    await settle(1000);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("wasn't right");
    // Dismiss A and open B — the opener must clear A's pending timer.
    const cancel = [...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel");
    await act(async () => { cancel!.click(); });
    await settle(200);
    await openApprovalFor(el, "Quest B", "2222");
    // B's own timer is now at ~3500; advancing past A's deadline (2500) must
    // NOT clear B's error.
    await settle(1600);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("wasn't right");
    // B's own timer still works.
    await settle(1000);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("names the real reason when the server refuses a row that is gone", async () => {
    seedTwo();
    localStorage.setItem("consuela-tasks", JSON.stringify([pendingRow(101, "Quest A", "Caspian Garcia", "🧒")]));
    vi.stubGlobal("fetch", verifyFetch("ok", { reason: "unknown-task", code: "unknown_task" }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    await openApprovalFor(el, "Quest A", "0202");
    await settle(200);

    const text = document.body.textContent || "";
    expect(text).toContain("That chore isn't on the family's list any more.");
  });
});
