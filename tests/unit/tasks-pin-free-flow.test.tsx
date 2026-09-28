// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { localWeekStartISO } from "@/lib/local-date";
import { todayISO, pendingPointsFor } from "@/lib/task-utils";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// The age-gated roster: Caspian (5) earns PIN-free taps, Jasmine (10) must
// pass a PIN first — and EITHER way an assigned child completion lands as
// done-but-unpaid pending, never an instant earn. name vs fullName stay
// distinct for Jasmine so the ledger-key contract keeps proving something.
vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 10, emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 10, emoji: "👧", color: "rose" },
    ],
  },
}));

const MONDAY = localWeekStartISO();
const FEED_CASP = { id: 51, title: "Feed the dog", assignee: "Caspian Garcia", assigneeEmoji: "🧒", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };
const FEED_JASM = { id: 52, title: "Feed the dog", assignee: "Jasmine Rose", assigneeEmoji: "👧", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };
const MOW = { id: 53, title: "Mow lawn", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function stubGuestFetches() {
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    if (String(input) === "/api/tasks/sync") {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  }));
}

// Every /api/members/verify call answers with the given (sanitized) member —
// exactly the shape the real route returns via sanitizeMember.
const claimStatus = { value: 200 };

function stubVerifyMember(member: any) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member }) };
    }
    if (String(input) === "/api/tasks/claim") {
      return { ok: claimStatus.value < 400, status: claimStatus.value, json: async () => ({ success: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
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

function storedHistory(): any[] {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}").history || [];
}

function verifyCalls(): string {
  return ((globalThis.fetch as any)?.mock?.calls || []).flat().join(" ");
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  // Scope to the open dialog first (the modal portals to document.body).
  const scope = document.querySelector('[role="dialog"]') ?? document;
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

async function typeAndSubmit(pin = "1234") {
  const input = document.querySelector('input[placeholder="4-digit PIN"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText("Submit")!.click(); });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  claimStatus.value = 200;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

describe("age-gated task completion", () => {
  it("Caspian (5) taps an assigned chore: one PIN-free durable command, NO PIN modal", async () => {
    stubVerifyMember({ name: "Caspian Garcia", fullName: "Caspian Garcia", role: "child" });
    claimStatus.value = 503;
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([FEED_CASP]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Feed the dog"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    // The tap is queued FIRST on the roster-resolved FULL-name ledger key,
    // with NO credential at all — the session is the identity.
    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 51 } });
    expect((entry.payload as any).memberName).toBe("Caspian Garcia");
    // No local row and no local ledger line — the acknowledgment writes both.
    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(pendingPointsFor("Caspian Garcia", saved)).toBe(0);
    expect(storedHistory()).toHaveLength(0);
    // No PIN step, no verify traffic — and the honest copy tells the truth.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('input[inputMode="numeric"]')).toBeNull();
    expect(verifyCalls()).not.toContain("/api/members/verify");
    expect(el.textContent || "").toContain("on the way"); // "on the way — a parent approves" toast
    // The queue is honestly reported instead of pretending the row landed.
    expect(el.textContent || "").toMatch(/Sending 1 change|Still sending/);
  });

  it("Jasmine (10) taps an assigned chore: PIN modal, and the verified PIN is queued ephemerally (no instant points)", async () => {
    stubVerifyMember({ name: "Jasmine Rose", fullName: "Jasmine Rose", role: "child" });
    claimStatus.value = 503;
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([FEED_JASM]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Feed the dog"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    // 10+ kids hit the PIN step — identity still needs proving.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('input[inputMode="numeric"]')).not.toBeNull();

    await typeAndSubmit();
    expect(verifyCalls()).toContain("/api/members/verify");

    // Verified child: the completion is QUEUED and points never move locally.
    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 52 } });
    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
    const week = JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
    expect(week.points["Jasmine Rose"]).toBeUndefined();
    // The PIN lives only in the ephemeral registry — never in localStorage.
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain("1234");
    // Honest pending copy, never the instant-earn copy.
    expect(document.body.textContent || "").toContain("on the way");
    expect(document.body.textContent || "").not.toContain("completed Feed the dog");
    // Flush the success-copy auto-close (1500ms + exit) so the portaled
    // dialog unmounts inside this test, not after the next teardown wipes
    // the body out from under the portal.
    await settle(1800);
  });

  it("parent PIN-complete queues one command and moves no local point line", async () => {
    stubVerifyMember({ name: "Rebecca (Mom)", fullName: "Rebecca (Mom)", role: "parent" });
    claimStatus.value = 503;
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([MOW]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Mow lawn"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await typeAndSubmit();

    // Adults are the SAME command as a kid's — only the PIN differs. The
    // earn line is the server's, and arrives with the acknowledgment.
    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 53 } });
    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
    const week = JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
    expect(week.points["Rebecca (Mom)"]).toBeUndefined();
    expect(document.body.textContent || "").toContain("completed Mow lawn! +5pts");
    // Flush the success-copy auto-close (1500ms + exit) — same portal-
    // teardown hygiene as the child test.
    await settle(1800);
  });
});
