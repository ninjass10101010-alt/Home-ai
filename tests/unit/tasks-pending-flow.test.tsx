// @vitest-environment jsdom
// Task 10 — the pending-approval flow, now driven entirely by the durable
// outbox. A kid tap, a parent approval and a send-back are COMMANDS: nothing
// writes a local pending row, point line or ledger entry before the family
// server acknowledges. The PIN is ephemeral and the acknowledgment is the only
// thing that can move the family's ledger.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, weekKey } from "@/lib/task-utils";
import {
  __resetTaskOutboxForTests,
  listTaskOutbox,
} from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PARENT_PIN = "9026";
const KID_PIN = "3141";

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
const OPEN = { id: 51, title: "Make bed", assignee: "Jasmine", assigneeEmoji: "👧", due: MONDAY, points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };

const server = vi.hoisted(() => ({
  claimStatus: 200,
  approveStatus: 200,
  claimThrows: false,
  approveThrows: false,
  claimBody: null as null | any,
  approveBody: null as null | any,
  requests: [] as any[],
  syncPosts: [] as any[],
}));

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? safeParse(String(init.body)) : null;
      if (url.includes("/api/members/verify")) {
        // The verifier answers with the member the request named, so the
        // ledger key is the roster-resolved FULL name of the verified person.
        const asked = String(body?.memberName ?? "Rebecca (Mom)");
        const rosterName = asked === "Jasmine" || asked === "Jasmine Rose" ? "Jasmine Rose" : "Rebecca (Mom)";
        return {
          ok: true,
          status: 200,
          json: async () => ({ member: { name: rosterName, fullName: rosterName, role: rosterName.startsWith("Jasmine") ? "child" : "parent" } }),
        };
      }
      if (url === "/api/tasks/sync" && method === "POST") {
        server.syncPosts.push(body);
        return { ok: false, status: 410, json: async () => ({ error: "retired" }) };
      }
      if (url === "/api/tasks/sync") {
        return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
      }
      if (url === "/api/tasks/claim") {
        server.requests.push({ route: url, body });
        if (server.claimThrows) throw new TypeError("network unavailable");
        return { ok: server.claimStatus < 400, status: server.claimStatus, json: async () => server.claimBody ?? { success: true } };
      }
      if (url === "/api/tasks/approve") {
        server.requests.push({ route: url, body });
        if (server.approveThrows) throw new TypeError("network unavailable");
        return { ok: server.approveStatus < 400, status: server.approveStatus, json: async () => server.approveBody ?? { success: true } };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}

function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}

function storedHistory(): any[] {
  return storedWeek().history || [];
}

function verifyCalls(): string {
  return ((globalThis.fetch as any)?.mock?.calls || []).flat().join(" ");
}

function requestsFor(route: string) {
  return server.requests.filter((entry) => entry.route === route);
}

async function typePin(placeholder: string, pin: string) {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, pin);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function dialogButton(text: string): HTMLButtonElement {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const found = Array.from(scope.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
  expect(found).toBeTruthy();
  return found!;
}

async function clickByAriaLabel(label: string) {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(el).not.toBeNull();
  await act(async () => { el.click(); });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  server.claimStatus = 200;
  server.approveStatus = 200;
  server.claimThrows = false;
  server.approveThrows = false;
  server.claimBody = null;
  server.approveBody = null;
  server.requests = [];
  server.syncPosts = [];
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
  installFetch();
});

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
  vi.unstubAllGlobals();
});

describe("kid tap-to-complete", () => {
  it("a 10-year-old's tap opens the PIN step and queues a PIN-gated completion with zero local points", async () => {
    // Jasmine is 10 — PIN-free taps are for under-10 only. Identity is still
    // proved by PIN, and the completed row lands through the acknowledgment.
    server.claimStatus = 503;
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const jasmineTile = [...el.querySelectorAll(".member-tile-name")]
      .find((s) => (s.textContent || "").trim() === "Jasmine")!
      .closest("button") as HTMLElement;
    await act(async () => { jasmineTile.click(); });
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(120);

    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 51 } });
    // The roster-resolved FULL name is the ledger key, so approve credits the
    // same row the tap queued.
    expect((entry.payload as any).memberName).toBe("Jasmine Rose");
    // Nothing local moved.
    expect(storedTasks()[0].completed).toBe(false);
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).toContain("/api/members/verify");
  });

  it("adult tap still opens a real dialog and writes no pending record", async () => {
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([OPEN]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const jasmineTile = [...el.querySelectorAll(".member-tile-name")]
      .find((s) => (s.textContent || "").trim() === "Jasmine")!
      .closest("button") as HTMLElement;
    await act(async () => { jasmineTile.click(); });
    await settle();

    const row = el.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    await act(async () => { row.click(); });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
  });

  it("guest tap creates no pending record and no command", async () => {
    seed([OPEN]);
    await renderAsync(<TasksPage />);
    await settle();

    const row = document.querySelector('[aria-label="Complete Make bed"]') as HTMLElement;
    await act(async () => { row.click(); });
    await settle();

    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("a pending row's owner self-cancel queues the server undo and keeps the row in place", async () => {
    server.claimStatus = 503;
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([{
      ...OPEN,
      completed: true,
      completedBy: "Jasmine Rose",
      completedAt: new Date().toISOString(),
      completedInWeek: weekKey(),
      pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 5 },
    }]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const toggle = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("completed")) as HTMLElement;
    await act(async () => { toggle.click(); });
    await settle();

    expect(el.textContent || "").toContain("On the way");
    await clickByAriaLabel("Cancel completion of Make bed");
    await settle(120);

    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "undo", payload: { taskId: 51 } });
    // PIN-free: the cancel never verified anything, so no credential is sent.
    expect(entry.payload.pin).toBeUndefined();
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).not.toContain("/api/members/verify");
  });
});

function pendingSeed() {
  return [{
    ...OPEN,
    id: 52,
    completed: true,
    completedBy: "Jasmine Rose",
    completedAt: new Date().toISOString(),
    completedInWeek: weekKey(),
    pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 5 },
  }];
}

describe("needs approval queue", () => {
  it("hidden for kids and guests, shown for parents", async () => {
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    const kidView = await renderAsync(<TasksPage />);
    await settle();
    expect(kidView.textContent || "").not.toContain("Needs approval");

    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
    document.body.innerHTML = "";
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    const parentView = await renderAsync(<TasksPage />);
    await settle();
    expect(parentView.textContent || "").toContain("Needs approval");
  });

  it("approving with a parent PIN queues the command and awards points only on acknowledgment", async () => {
    server.approveBody = {
      success: true,
      paid: 1,
      cleared: 1,
      weekData: {
        weekStart: MONDAY,
        points: { "Jasmine Rose": 5 },
        streak: {},
        lastActive: {},
        history: [{
          id: 1,
          timestamp: new Date().toISOString(),
          member: "Jasmine Rose",
          type: "earn",
          amount: 5,
          description: "Completed: Make bed (+5pts)",
          taskId: 52,
        }],
      },
    };
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Approve Make bed");
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(150);

    // Only the server's authoritative weekData lands, and it lands the FULL
    // ledger key the queue credits.
    expect(storedWeek().points["Jasmine Rose"]).toBe(5);
    expect(storedHistory()).toHaveLength(1);
    expect(storedHistory()[0].type).toBe("earn");
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("send-back queues the reopen command with zero ledger entries", async () => {
    server.approveStatus = 503;
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Send back Make bed");
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Send back").click(); });
    await settle(120);

    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/approve", action: "send-back", payload: { taskId: 52 } });
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("a refused parent PIN queues nothing and says Parent PIN required", async () => {
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(pendingSeed());
    vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/api/members/verify")) {
        return { ok: false, status: 401, json: async () => ({ error: "unauthorized" }) };
      }
      if (url === "/api/tasks/approve") {
        return { ok: false, status: 200, json: async () => ({ success: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
    }));
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Approve Make bed");
    await typePin("Parent PIN", "0000");
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(document.body.textContent || "").toContain("Parent PIN required to review tapped tasks.");
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("needs approval → durable command", () => {
  function approveSeed() {
    // pendingApproval.points (8) deliberately differs from task.points (6) so
    // the recorded amount is what the toast names.
    return [{
      ...OPEN,
      id: 101,
      title: "Dishes",
      points: 6,
      completed: true,
      completedBy: "Jasmine Rose",
      completedAt: new Date().toISOString(),
      completedInWeek: weekKey(),
      pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 8 },
    }];
  }

  function approvedWeek(member: string, amount: number) {
    return {
      weekStart: MONDAY,
      points: { [member]: amount },
      streak: {},
      lastActive: {},
      history: [{
        id: 1,
        timestamp: new Date().toISOString(),
        member,
        type: "earn",
        amount,
        description: `Completed: Dishes (+${amount}pts)`,
        taskId: 101,
      }],
    };
  }

  async function driveApproval(buttonLabel: string, buttonText: string) {
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed(approveSeed());
    const el = await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel(buttonLabel);
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton(buttonText).click(); });
    await settle(150);
    return el;
  }

  it("single Approve sends the exact contract body and adopts the server weekData", async () => {
    server.approveBody = { success: true, paid: 1, cleared: 1, weekData: approvedWeek("Jasmine Rose", 8) };
    const el = await driveApproval("Approve Dishes", "Approve");

    const posted = requestsFor("/api/tasks/approve");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      action: "approve",
      taskId: 101,
      memberName: "Rebecca (Mom)",
      pin: PARENT_PIN,
      operationId: expect.any(String),
    });
    expect(storedWeek().points["Jasmine Rose"]).toBe(8);
    expect(storedHistory()[0]?.amount).toBe(8);
    expect(listTaskOutbox()).toHaveLength(0);
    // The recorded approval amount (8), not task.points (6).
    expect(el.textContent || document.body.textContent || "").toContain("+8pts");
  });

  it("send-back sends send-back and leaves the reopen to the acknowledgment", async () => {
    server.approveBody = {
      success: true,
      cleared: 1,
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    };
    await driveApproval("Send back Dishes", "Send back");

    const posted = requestsFor("/api/tasks/approve");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ action: "send-back", taskId: 101, pin: PARENT_PIN });
    // A send-back acknowledgment carries no task row, so the reopen arrives on
    // the next snapshot PULL — never as a local write. No ledger entry either.
    expect(listTaskOutbox()).toHaveLength(0);
    expect(storedHistory()).toHaveLength(0);
  });

  it("a 404 from the route leaves the command failed and the row waiting", async () => {
    server.approveStatus = 404;
    server.approveBody = { success: false, reason: "unknown-task" };
    await driveApproval("Approve Dishes", "Approve");

    expect(requestsFor("/api/tasks/approve")).toHaveLength(1);
    const [entry] = listTaskOutbox();
    expect(entry.status).toBe("failed");
    expect(storedTasks()[0].pendingApproval).toBeDefined();
    expect(storedHistory()).toHaveLength(0);
  });

  it("a network failure keeps the command queued and never pays locally", async () => {
    server.approveThrows = true;
    await driveApproval("Approve Dishes", "Approve");

    expect(listTaskOutbox()).toHaveLength(1);
    expect(storedHistory()).toHaveLength(0);
  });

  it("a 5xx keeps the command queued and never pays locally", async () => {
    server.approveStatus = 502;
    await driveApproval("Approve Dishes", "Approve");

    expect(listTaskOutbox()).toHaveLength(1);
    expect(storedHistory()).toHaveLength(0);
    expect(document.body.textContent || "").not.toContain("refused");
  });

  it("never posts the retired snapshot writer for any review action", async () => {
    server.approveStatus = 503;
    await driveApproval("Approve Dishes", "Approve");
    expect(server.syncPosts).toHaveLength(0);
  });
});
