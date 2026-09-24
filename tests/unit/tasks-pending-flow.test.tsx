// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, todayISO, weekKey, pendingPointsFor } from "@/lib/task-utils";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// Jasmine's roster row has DISTINCT name vs fullName: the auth session signs
// in as "Jasmine" but the ledger key (weekData.points) is the roster-resolved
// fullName "Jasmine Rose" — the same key the classic PIN path credits.
vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 10, emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 10, emoji: "👧", color: "rose" },
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

// Bodies POSTed to /api/tasks/approve by submitApproval (Task 7).
const approveCalls: any[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  approveCalls.length = 0;
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

describe("kid tap-to-complete", () => {
  it("child (10) tap opens the PIN step; a verified PIN lands done with pending record, zero earn tx", async () => {
    // Jasmine is 10 — PIN-free taps are for under-10 only. Identity is still
    // proved by PIN, but a verified CHILD completion lands done-but-unpaid:
    // the parent verifies the work before points move.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/members/verify")) {
        return { ok: true, status: 200, json: async () => ({ member: { name: "Jasmine Rose", fullName: "Jasmine Rose", role: "child" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
    }));
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    // Reach the row through the member tile (filter = roster fullName), the
    // way the queue resolves: the auth session carries "Jasmine" but the
    // roster's ledger name is "Jasmine Rose".
    const jasmineTile = [...el.querySelectorAll(".member-tile-name")].find((s) => (s.textContent || "").trim() === "Jasmine")!.closest("button") as HTMLElement;
    await act(async () => { jasmineTile.click(); });
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await typeAndSubmit("4-digit PIN", "Submit");

    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    // The pending record credits the roster-resolved FULL name (the ledger
    // key), not the raw auth first name — approve posts the earn to the same
    // key, so points never strand on a split ledger entry.
    expect(saved[0].pendingApproval).toEqual({ byName: "Jasmine Rose", at: expect.any(String), points: 5 });
    expect(saved[0].completedBy).toBe("Jasmine Rose");
    expect(pendingPointsFor("Jasmine Rose", saved)).toBe(5);
    expect(pendingPointsFor("Jasmine", saved)).toBe(0);
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).toContain("/api/members/verify");
    expect(document.body.textContent || "").toContain("on the way");
    // Flush the success-copy auto-close (1500ms + exit) so the portaled
    // dialog unmounts inside this test, not after the next teardown wipes
    // the body out from under the portal.
    await settle(1800);
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
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([{ ...OPEN, completed: true, completedBy: "Jasmine Rose", completedAt: new Date().toISOString(), completedInWeek: weekKey(), pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 5 } }]);
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

function pendingSeed() {
  return [{
    ...OPEN, id: 52, completed: true, completedBy: "Jasmine Rose",
    completedAt: new Date().toISOString(), completedInWeek: weekKey(),
    pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 5 },
  }];
}

function stubVerifyOk() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member: { name: "Rebecca (Mom)", fullName: "Rebecca (Mom)" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
  }));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  // Scope to the open dialog first: the Needs-approval rows behind the modal
  // carry identically-labeled buttons ("Approve"/"Send back") that come
  // earlier in document order (the modal portals to document.body) and would
  // otherwise win the find and merely reset the modal instead of submitting.
  const scope = document.querySelector('[role="dialog"]') ?? document;
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

async function clickByAriaLabel(label: string) {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(el).not.toBeNull();
  await act(async () => { el.click(); });
  await settle();
}

async function typeAndSubmit(placeholder: string, buttonText: string, pin = "1234") {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText(buttonText)!.click(); });
  await settle();
}

describe("needs approval queue", () => {
  it("hidden for kids, shown for parents", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();
    expect(document.body.textContent || "").not.toContain("Needs approval");

    document.body.innerHTML = "";
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    await renderAsync(<TasksPage />);
    await settle();
    expect(document.body.textContent || "").toContain("Needs approval");
  });

  it("hidden for signed-out guests too (even with pending rows seeded)", async () => {
    stubGuestFetches();
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();
    expect(document.body.textContent || "").not.toContain("Needs approval");
  });

  it("approve with parent PIN awards points and clears the queue", async () => {
    stubVerifyOk();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Approve Make bed");
    await settle();
    expect(document.body.textContent || "").toContain("Approve points");
    await typeAndSubmit("Parent PIN", "Approve");

    const week = JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
    // The earn lands on the roster-resolved FULL-name ledger key.
    expect(week.points["Jasmine Rose"]).toBe(5);
    expect(week.history).toHaveLength(1);
    expect(week.history[0].type).toBe("earn");
    expect(week.history[0].member).toBe("Jasmine Rose");
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(document.body.textContent || "").not.toContain("Needs approval");
  });

  it("send-back reopens with zero ledger entries", async () => {
    stubVerifyOk();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Send back Make bed");
    await settle();
    await typeAndSubmit("Parent PIN", "Send back");

    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("wrong parent PIN keeps the queue and says Parent PIN required", async () => {
    stubGuestFetches();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Approve Make bed");
    await settle();
    await typeAndSubmit("Parent PIN", "Approve", "0000");

    expect(document.body.textContent || "").toContain("Parent PIN required to review tapped tasks.");
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(storedHistory()).toHaveLength(0);
  });
});

// Task 7: single Approve / Send-back go through POST /api/tasks/approve —
// optimistic first, adopt server weekData on 200, revert on 4xx, keep the
// local approval on network failure (D8).

function approveSeed() {
  // pendingApproval.points (8) deliberately differs from task.points (6) so
  // the B1 toast / server ledger prove the recorded amount is what pays.
  return [{
    ...OPEN, id: 101, title: "Dishes", points: 6,
    completed: true, completedBy: "Jasmine Rose",
    completedAt: new Date().toISOString(), completedInWeek: weekKey(),
    pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 8 },
  }];
}

type ApproveRouteMode = "ok" | "reject" | "offline";

function stubApproveRoute(mode: ApproveRouteMode = "ok") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member: { name: "Rebecca (Mom)", fullName: "Rebecca (Mom)" } }) } as any;
    }
    if (url.includes("/api/tasks/approve")) {
      const payload = JSON.parse(String(init?.body || "{}"));
      approveCalls.push(payload);
      if (mode === "offline") throw new TypeError("Failed to fetch");
      if (mode === "reject") {
        return { ok: false, status: 404, json: async () => ({ success: false, reason: "unknown-task" }) } as any;
      }
      if (payload.action === "send-back") {
        return { ok: true, status: 200, json: async () => ({ success: true, paid: 0, cleared: 1, skipped: 0 }) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          paid: 1,
          cleared: 1,
          skipped: 0,
          weekData: {
            weekStart: MONDAY,
            points: { "Caspian Garcia": 8 },
            streak: {},
            lastActive: {},
            history: [{
              id: 1,
              timestamp: new Date().toISOString(),
              member: "Caspian Garcia",
              type: "earn",
              amount: 8,
              description: "Completed: Dishes (+8pts)",
              taskId: 101,
            }],
          },
        }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null }) } as any;
  }));
}

function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}

async function driveApproval(buttonLabel: string, buttonText: string) {
  mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
  mockAuth.isLoggedIn = true;
  seed(approveSeed());
  const el = await renderAsync(<TasksPage />);
  await settle();
  await clickByAriaLabel(buttonLabel);
  await settle();
  await typeAndSubmit("Parent PIN", buttonText, "0202");
  return el;
}

describe("needs approval → server route", () => {
  it("single Approve POSTs the exact contract body and adopts server weekData", async () => {
    stubApproveRoute("ok");
    const el = await driveApproval("Approve Dishes", "Approve");

    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0]).toEqual({
      action: "approve",
      taskId: 101,
      memberName: "Rebecca (Mom)",
      pin: "0202",
    });
    // Server-adopted ledger: only the route's weekData carries the Caspian
    // key — local optimistic state would have credited Jasmine Rose instead.
    expect(storedWeek().points["Caspian Garcia"]).toBe(8);
    expect(storedWeek().history[0]?.amount).toBe(8);
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    // B1 toast uses the recorded approval amount (8), not task.points (6).
    expect(document.body.textContent || "").toContain("+8pts");
    expect(el.textContent || "").not.toContain("Needs approval");
  });

  it("send-back POSTs send-back and reopens the row with sentBackAt", async () => {
    stubApproveRoute("ok");
    await driveApproval("Send back Dishes", "Send back");

    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0]).toEqual({
      action: "send-back",
      taskId: 101,
      memberName: "Rebecca (Mom)",
      pin: "0202",
    });
    const saved = storedTasks();
    expect(saved[0].completed).toBe(false);
    expect(saved[0].pendingApproval).toBeUndefined();
    expect(typeof saved[0].sentBackAt).toBe("string");
    expect(storedHistory()).toHaveLength(0);
  });

  it("4xx from the route reverts the optimistic approval", async () => {
    stubApproveRoute("reject");
    await driveApproval("Approve Dishes", "Approve");

    expect(approveCalls).toHaveLength(1);
    // The optimistic pay was rolled back — the row still waits.
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(storedWeek().history).toHaveLength(0);
    expect(document.body.textContent || "").toContain("no longer waiting");
  });

  it("network failure KEEPS the local approval (D8 degraded mode)", async () => {
    stubApproveRoute("offline");
    await driveApproval("Approve Dishes", "Approve");

    expect(approveCalls).toHaveLength(1);
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedWeek().history).toHaveLength(1);
    expect(document.body.textContent || "").toContain("Approved!");
  });

  it("a 5xx from the route keeps the local approval (same class as network failure, never a 4xx revert)", async () => {
    // 2026-09-23 review: the route pays the snapshot week + clears the row
    // INSIDE the lock before a later PB write can throw — a 5xx can be a
    // PARTIAL apply. Reverting fought the next merge's paidElsewhere
    // adoption (approve → un-approve → re-approve churn). 5xx now takes the
    // D8 keep-local path.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/members/verify")) {
        return { ok: true, status: 200, json: async () => ({ member: { name: "Rebecca (Mom)", fullName: "Rebecca (Mom)" } }) } as any;
      }
      if (url.includes("/api/tasks/approve")) {
        approveCalls.push(JSON.parse(String(init?.body || "{}")));
        return { ok: false, status: 502, json: async () => ({ error: "db_error" }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ snapshot: null }) } as any;
    }));
    await driveApproval("Approve Dishes", "Approve");

    expect(approveCalls).toHaveLength(1);
    // Local optimistic approval SURVIVES the 5xx (no revert — identical to
    // the offline path)…
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedWeek().history).toHaveLength(1);
    // …and the caller's saved-locally success copy wins, never a 4xx-style
    // "the server refused" revert toast.
    expect(document.body.textContent || "").toContain("Approved!");
    expect(document.body.textContent || "").not.toContain("refused");
  });
});
