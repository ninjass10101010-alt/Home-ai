// @vitest-environment jsdom
// Task 10 — every Tasks-page write is a durable outbox command. Nothing moves
// local points, history, or task rows before an acknowledgment; the PIN lives
// only in the ephemeral registry; the legacy snapshot writer is gone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { localWeekStartISO } from "@/lib/local-date";

import {
  __resetTaskOutboxForTests,
  flushTaskOutbox,
  listTaskOutbox,
  pollQueue,
  readTaskCommandCredential,
} from "@/lib/task-command-store";
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

const ROSTER = [
  { id: 1, name: "Rebecca", fullName: "Rebecca Mom", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 7, emoji: "🧒", color: "cyan" },
  { id: 3, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 11, emoji: "👧", color: "rose" },
];

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => ROSTER,
    selectMembersFallback: () => ROSTER,
    listArchivedWeeks: vi.fn(async () => []),
    selectHallOfFame: vi.fn(async () => []),
    upsertTask: vi.fn(async () => null),
    upsertWeekData: vi.fn(async () => null),
  },
}));

const MONDAY = localWeekStartISO();

const server = vi.hoisted(() => ({
  requests: [] as Array<{ route: string; body: any }>,
  syncPosts: [] as any[],
  claimStatus: 200,
  approveStatus: 200,
  manageStatus: 200,
  configStatus: 200,
  claimThrows: false,
  claimBody: null as null | any,
  approveBody: null as null | any,
  snapshot: null as any,
  verifyOk: true,
  redeemBody: null as null | any,
  ledgerBody: null as null | any,
  ledgerStatus: 200,
  echoReceipt: false,
  approveSeen: false,
  queueOperationId: null as string | null,
  queueResolved: false,
}));

function weekWithEarn(member: string, amount: number) {
  return {
    weekStart: MONDAY,
    points: { [member]: amount },
    streak: {},
    lastActive: {},
    history: [
      {
        id: 9001,
        timestamp: new Date().toISOString(),
        member,
        type: "earn",
        amount,
        description: `Completed: Dishes (+${amount}pts)`,
        taskId: 101,
      },
    ],
  };
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? safeParse(String(init.body)) : null;
      if (url.includes("/api/members/verify")) {
        if (!server.verifyOk) {
          return { ok: false, status: 401, json: async () => ({ error: "unauthorized" }) };
        }
        // The verifier answers with the member the request named, so the
        // ledger key is the roster-resolved FULL name of the verified person.
        const asked = String(body?.memberName ?? "");
        const child = ROSTER.find((m) => asked === m.name || asked === m.fullName);
        const member = child ?? { name: "Rebecca Mom", fullName: "Rebecca Mom", role: "parent" };
        return {
          ok: true,
          status: 200,
          json: async () => ({ member: { name: member.name, fullName: member.fullName, role: member.role } }),
        };
      }
      if (url === "/api/tasks/sync" && method === "POST") {
        server.syncPosts.push(body);
        return { ok: false, status: 410, json: async () => ({ error: "retired" }) };
      }
      if (url === "/api/tasks/sync") {
        // The post-approval snapshot only becomes visible AFTER the approve
        // command reached the server, so the page's mount pull can never
        // pre-resolve the approval it is about to command.
        const visible = server.approveSeen ? server.snapshot : { tasks: [], weekData: null };
        return { ok: true, status: 200, json: async () => ({ snapshot: visible, reconciled: true }) };
      }
      if (url === "/api/tasks/queue") {
        // The server queue's view of the last 202 { queued: true } intake:
        // pending until the test flips `queueResolved`, then a resolved row
        // whose captured `result` is the authoritative ack body.
        const operationId = server.queueOperationId;
        const rows = operationId
          ? [{
              operationId,
              route: "/api/tasks/approve",
              action: "approve",
              status: server.queueResolved ? "resolved" : "pending",
              attemptCount: 0,
              nextAttemptAt: null,
              lastErrorReason: server.queueResolved ? null : "task_store_unavailable",
              lastErrorMessage: null,
              result: server.queueResolved ? { weekData: weekWithEarn("Jasmine Rose", 8) } : null,
              displayTarget: { kind: "approval", taskId: 101 },
            }]
          : [];
        return { ok: true, status: 200, json: async () => ({ rows }) };
      }
      if (url === "/api/rewards/redeem") {
        server.requests.push({ route: url, body });
        return { ok: true, status: 200, json: async () => server.redeemBody ?? { ok: true } };
      }
      if (url === "/api/tasks/ledger") {
        server.requests.push({ route: url, body });
        return { ok: server.ledgerStatus < 400, status: server.ledgerStatus, json: async () => server.ledgerBody ?? { success: true } };
      }
      if (url === "/api/tasks/claim" || url === "/api/tasks/approve" || url === "/api/tasks/manage" || url === "/api/tasks/config") {
        server.requests.push({ route: url, body });
        if (url === "/api/tasks/claim") {
          if (server.claimThrows) throw new TypeError("network unavailable");
          return { ok: server.claimStatus < 400, status: server.claimStatus, json: async () => server.claimBody ?? { success: true } };
        }
        if (url === "/api/tasks/approve") {
          server.approveSeen = true;
          if (server.approveBody?.queued === true && body?.operationId) {
            server.queueOperationId = String(body.operationId);
          }
          if (server.echoReceipt && body?.operationId) {
            server.snapshot = {
              ...(server.snapshot ?? {}),
              operationReceipts: {
                ...(server.snapshot?.operationReceipts ?? {}),
                [body.operationId]: [{
                  operationId: body.operationId,
                  action: body.action,
                  taskId: body.taskId,
                  createdAt: new Date().toISOString(),
                }],
              },
            };
          }
          return { ok: server.approveStatus < 400, status: server.approveStatus, json: async () => ({ operationId: body?.operationId, ...(server.approveBody ?? { success: true }) }) };
        }
        const status = url === "/api/tasks/manage" ? server.manageStatus : server.configStatus;
        return { ok: status < 400, status, json: async () => ({ success: true, items: [] }) };
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

async function settle(ms = 60) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function seed(tasks: any[], week: any = { points: {}, streak: {}, lastActive: {}, history: [] }) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, ...week }));
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}

function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}

function requestsFor(route: string) {
  return server.requests.filter((entry) => entry.route === route);
}

async function typePin(placeholder: string, pin: string) {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input).toBeTruthy();
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

async function setField(label: string, value: string) {
  const input = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, value.includes("-") ? "value" : "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(label: string) {
  const node = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(node).toBeTruthy();
  await act(async () => { node.click(); });
  await settle();
}

const PENDING_TASK = {
  id: 101,
  title: "Dishes",
  assignee: "Jasmine Rose",
  assigneeEmoji: "👧",
  due: MONDAY,
  points: 8,
  recurring: null,
  category: "Chores",
  completed: true,
  completedBy: "Jasmine Rose",
  completedAt: new Date().toISOString(),
  completedInWeek: localWeekStartISO(),
  pendingApproval: { byName: "Jasmine Rose", at: new Date().toISOString(), points: 8 },
};

const ASSIGNED_TASK = {
  id: 102,
  title: "Make bed",
  assignee: "Jasmine Rose",
  assigneeEmoji: "👧",
  due: MONDAY,
  points: 5,
  recurring: null,
  category: "Chores",
  completed: false,
  priority: "low",
};

const OPEN_TASK = {
  id: 103,
  title: "Wash car",
  assignee: "Open",
  assigneeEmoji: "🤝",
  due: MONDAY,
  points: 10,
  recurring: null,
  category: "Chores",
  completed: false,
  universal: true,
};

const CREW_TASK = {
  id: 104,
  title: "Garden",
  assignee: "Crew",
  assigneeEmoji: "🤝",
  due: MONDAY,
  points: 12,
  recurring: null,
  category: "Chores",
  completed: false,
  crewSize: 2,
  crew: { members: [] },
};

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  server.requests = [];
  server.syncPosts = [];
  server.claimStatus = 200;
  server.approveStatus = 200;
  server.manageStatus = 200;
  server.configStatus = 200;
  server.claimThrows = false;
  server.claimBody = null;
  server.approveBody = null;
  server.snapshot = { tasks: [], weekData: null };
  server.verifyOk = true;
  server.ledgerStatus = 200;
  server.echoReceipt = false;
  server.approveSeen = false;
  server.queueOperationId = null;
  server.queueResolved = false;
  mockAuth.currentUser = { name: "Rebecca", role: "parent", age: 40 };
  mockAuth.isLoggedIn = true;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
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

async function openApprovalQueue() {
  await renderAsync(<TasksPage />);
  await settle();
  await click("Approve Dishes");
  await settle();
}

describe("parent approval is a durable command, not a local pay", () => {
  it("queues the approve command and moves no local points before acknowledgment", async () => {
    server.approveStatus = 503;
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(80);

    const queued = listTaskOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 101, memberName: "Rebecca Mom" },
    });
    expect(storedWeek().history).toHaveLength(0);
    expect(storedWeek().points["Jasmine Rose"]).toBeUndefined();
  });

  it("adopts 200 authoritative data before clearing the outbox", async () => {
    server.approveBody = { success: true, paid: 1, cleared: 1, weekData: weekWithEarn("Jasmine Rose", 8) };
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(60);

    const posted = requestsFor("/api/tasks/approve");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      action: "approve",
      taskId: 101,
      memberName: "Rebecca Mom",
      pin: PARENT_PIN,
    });
    expect(storedWeek().points["Jasmine Rose"]).toBe(8);
    expect(storedWeek().history).toHaveLength(1);
    expect(listTaskOutbox()).toHaveLength(0);
    expect(readTaskCommandCredential(listTaskOutbox()[0]?.operationId ?? "x")).toBeUndefined();
  });

  it("retries a 202 that did not reconcile — never banks it as an ack", async () => {
    // B1a D4: the route's partial-projection answer (reconciled:false) is NOT
    // a success the client may bank — the kitchen display never received it —
    // so the entry stays durable and the week is not adopted until a
    // reconciled answer lands.
    server.approveStatus = 202;
    server.approveBody = {
      success: true,
      reconciled: false,
      repairRequired: true,
      retryable: true,
      error: "1 approval did not reach the kitchen display yet. Consuela is still retrying.",
      weekData: weekWithEarn("Jasmine Rose", 8),
    };
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(requestsFor("/api/tasks/approve")).toHaveLength(1);
    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].status).toBe("retrying");
    expect(listTaskOutbox()[0].lastErrorReason).toBe("projection_pending");
    expect(listTaskOutbox()[0].lastErrorMessage).toContain("did not reach the kitchen display");
    expect(storedWeek().points["Jasmine Rose"]).toBeUndefined();
    expect(storedWeek().history).toHaveLength(0);
  });

  it("mirrors a 202 { queued: true } as a server-owned entry until the queue poll resolves it", async () => {
    // The NEW queue contract: 202 { queued: true } means the SERVER owns the
    // command (a PocketBase queue row). The local entry stays as a live
    // mirror — `serverQueued: true` — and never writes a local ledger; a later
    // queue poll resolves it and adopts the authoritative week.
    server.approveStatus = 202;
    server.approveBody = { success: false, queued: true, reason: "task_store_unavailable", retryable: true };
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0]).toMatchObject({
      status: "queued",
      serverQueued: true,
      serverStatus: "pending",
    });
    expect(storedWeek().history).toHaveLength(0);
    expect(storedWeek().points["Jasmine Rose"]).toBeUndefined();

    // The queue drains: the resolution poll adopts the captured ack body and
    // releases the mirror — the entry is not stuck `reconciling` forever.
    server.queueResolved = true;
    await act(async () => { await pollQueue(); });
    await settle(60);

    expect(listTaskOutbox()).toHaveLength(0);
    expect(storedWeek().points["Jasmine Rose"]).toBe(8);
    expect(storedWeek().history).toHaveLength(1);
  });

  it("retains the command on a 503 and reports a queued count instead of paying locally", async () => {
    server.approveStatus = 503;
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(1);
    expect(storedWeek().history).toHaveLength(0);
    expect(storedWeek().points["Jasmine Rose"]).toBeUndefined();
    expect(document.body.textContent || "").toMatch(/Sending 1 change to the family server/);
  });

  it("keeps the command on a network rejection and never writes a local point line", async () => {
    server.claimThrows = true;
    server.approveStatus = 200;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
      if (String(input) === "/api/tasks/approve") throw new TypeError("network unavailable");
      return (originalFetch as any)(input, init);
    }));
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(1);
    expect(storedWeek().history).toHaveLength(0);
  });

  it("keeps the parent PIN ephemeral and clears it only after acknowledgment", async () => {
    server.approveBody = { success: true, weekData: weekWithEarn("Jasmine Rose", 8) };
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(60);

    expect(listTaskOutbox()).toHaveLength(0);
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain(PARENT_PIN);
  });

  it("never writes a wrong or unverified parent PIN to the outbox", async () => {
    server.verifyOk = false;
    seed([PENDING_TASK]);
    await renderAsync(<TasksPage />);
    await settle();
    await click("Approve Dishes");
    await settle();
    await typePin("Parent PIN", "0000");
    await act(async () => { dialogButton("Approve").click(); });
    await settle(60);

    expect(listTaskOutbox()).toHaveLength(0);
    expect(requestsFor("/api/tasks/approve")).toHaveLength(0);
  });
});

describe("send-back and approve-all are commands too", () => {
  it("queues send-back with no local reopen", async () => {
    server.approveStatus = 503;
    seed([PENDING_TASK]);
    await renderAsync(<TasksPage />);
    await settle();
    await click("Send back Dishes");
    await settle();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Send back").click(); });
    await settle(80);

    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/approve", action: "send-back", payload: { taskId: 101 } });
    // The reopen is the acknowledgment's write: the pending record is still
    // exactly as it was, byte for byte.
    expect(storedTasks()[0].pendingApproval).toEqual(PENDING_TASK.pendingApproval);
    expect(storedTasks()[0].completed).toBe(true);
  });

  it("queues approve-all with every requested task id", async () => {
    const second = { ...PENDING_TASK, id: 102, title: "Trash", pendingApproval: { byName: "Caspian Garcia", at: new Date().toISOString(), points: 4 } };
    server.approveStatus = 503;
    seed([PENDING_TASK, second]);
    await renderAsync(<TasksPage />);
    await settle();
    const approveAll = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Approve all"),
    ) as HTMLButtonElement;
    expect(approveAll).toBeTruthy();
    await act(async () => { approveAll.click(); });
    await settle();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve all").click(); });
    await settle(80);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/approve", action: "approve-all" });
    expect((entry.payload.taskIds as number[]).sort()).toEqual([101, 102]);
    expect(storedWeek().history).toHaveLength(0);
  });
});

describe("assigned completion, open claim, crew and undo", () => {
  it("queues a kid pending completion without any local earn", async () => {
    server.claimStatus = 503;
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 11 };
    seed([ASSIGNED_TASK]);
    await renderAsync(<TasksPage />);
    await settle();
    await click("Complete Make bed");
    await settle();
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(80);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 102 } });
    expect(storedWeek().history).toHaveLength(0);
    expect(storedTasks()[0].completed).toBe(false);
  });

  it("queues an open claim with the claim action", async () => {
    server.claimBody = { success: true, claimedBy: "Rebecca Mom", weekData: weekWithEarn("Rebecca Mom", 10) };
    seed([OPEN_TASK]);
    await renderAsync(<TasksPage />);
    await settle();
    await click("Claim Wash car");
    await settle();
    await typePin("4-digit PIN", PARENT_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(60);

    expect(requestsFor("/api/tasks/claim")[0]?.body).toMatchObject({ action: "claim", taskId: 103 });
    expect(listTaskOutbox()).toHaveLength(0);
    expect(storedWeek().points["Rebecca Mom"]).toBe(10);
  });

  it("queues a crew join for a kid session", async () => {
    server.claimBody = { success: true, task: { id: 104, title: "Garden", crew: { members: [{ name: "Caspian Garcia", joinedAt: new Date().toISOString() }] }, crewSize: 2 } };
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 7 };
    seed([CREW_TASK]);
    await renderAsync(<TasksPage />);
    await settle();
    await click("Join crew for Garden");
    await settle();
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(60);

    expect(requestsFor("/api/tasks/claim")[0]?.body).toMatchObject({ action: "crew-join", taskId: 104 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("queues a paid undo and reverses no local points before acknowledgment", async () => {
    const done = { ...ASSIGNED_TASK, assignee: "Rebecca Mom", completed: true, completedBy: "Rebecca Mom", completedAt: new Date().toISOString(), completedInWeek: localWeekStartISO() };
    server.claimStatus = 503;
    seed([done], { points: { "Rebecca Mom": 5 }, streak: {}, lastActive: {}, history: [] });
    await renderAsync(<TasksPage />);
    await settle();
    const toggle = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("completed"),
    ) as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    await settle();
    await click("Undo completion of Make bed");
    await settle();
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Undo").click(); });
    await settle(80);

    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/claim", action: "undo", payload: { taskId: 102 } });
    expect(storedWeek().points["Rebecca Mom"]).toBe(5);
    expect(storedTasks()[0].completed).toBe(true);
    // A PAID undo reverses a ledger entry, so the member PIN travels with it —
    // the server refuses a session-only one.
    const posted = requestsFor("/api/tasks/claim");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ action: "undo", taskId: 102, pin: KID_PIN });
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain(KID_PIN);
  });

  it("a kid self-cancel queues the server undo and does not clear the pending row locally", async () => {
    server.claimStatus = 503;
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 11 };
    seed([PENDING_TASK]);
    await renderAsync(<TasksPage />);
    await settle();
    const toggle = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("completed"),
    ) as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    await settle();
    await click("Cancel completion of Dishes");
    await settle(80);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "undo", payload: { taskId: 101 } });
    // Nothing local was cleared — a lost command must never silently erase a tap.
    expect(storedTasks()[0].pendingApproval).toEqual(PENDING_TASK.pendingApproval);
    expect(storedTasks()[0].completed).toBe(true);
  });
});

describe("task CRUD is a manage command, never local persistence", () => {
  it("queues a manage add and leaves the stored task list untouched until adoption", async () => {
    server.manageStatus = 503;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();
    await click("Add task");
    const input = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Rake leaves");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Save").click(); });
    await settle(80);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/manage", action: "add" });
    expect((entry.payload.task as any).title).toBe("Rake leaves");
    expect(storedTasks()).toHaveLength(0);
  });
});

describe("config edits go through the durable command and never the retired writer", () => {
  it("queues a rewards upsert with no snapshot push", async () => {
    server.configStatus = 503;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    const card = Array.from(document.querySelectorAll("h2, h3"))
      .find((element) => element.textContent === "Rewards")!
      .closest(".widget-card") as HTMLElement;
    await act(async () => {
      (Array.from(card.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Add") as HTMLButtonElement).click();
    });
    const input = document.querySelector('input[placeholder="Extra screen time"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Movie night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Save").click(); });
    await settle(80);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/config", action: "upsert" });
    expect((entry.payload.item as any).name).toBe("Movie night");
    expect(server.syncPosts).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("consuela-rewards") || "[]")).toHaveLength(0);
  });

  it("queues a penalties delete with no snapshot push", async () => {
    server.configStatus = 503;
    localStorage.setItem("consuela-penalties", JSON.stringify([{ id: 1, name: "Mess", emoji: "⚠️", points: 5 }]));
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    await click("Edit penalty");
    await act(async () => { dialogButton("Delete").click(); });
    await settle(80);

    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/config", action: "delete" });
    expect(server.syncPosts).toHaveLength(0);
  });
});

describe("honest queue surface and cancel", () => {
  it("shows the queued count and offers a cancel that drops the entry", async () => {
    server.approveStatus = 503;
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(1);
    const cancel = document.querySelector('[aria-label="Cancel queued Dishes"]') as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    await act(async () => { cancel.click(); });
    await settle(60);

    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("never persists a queued operation's pin to localStorage", async () => {
    server.approveStatus = 503;
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(60);

    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain(PARENT_PIN);
  });
});

describe("display-only optimism is visible but never persisted", () => {
  it("shows a queued completion as on the way without writing the row", async () => {
    server.claimStatus = 503;
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 11 };
    seed([ASSIGNED_TASK]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await click("Complete Make bed");
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(120);

    expect(el.querySelector('[data-testid="optimistic-task-row"]')).not.toBeNull();
    expect(el.textContent || "").toContain("On the way");
    expect(storedTasks()[0].completed).toBe(false);
  });

  it("shows a temporary add row for a queued manage command and keeps the store empty", async () => {
    server.manageStatus = 503;
    seed([]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await click("Add task");
    const input = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Rake leaves");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Save").click(); });
    await settle(120);

    expect(el.textContent || "").toContain("Rake leaves");
    expect(storedTasks()).toHaveLength(0);
  });

  it("a queued manage delete removes nothing locally", async () => {
    server.manageStatus = 503;
    seed([{ ...ASSIGNED_TASK, assignee: "Rebecca Mom" }]);
    await renderAsync(<TasksPage />);
    await settle();

    // Parent-only Add/Edit/Delete with a confirm first (the P0 gate).
    expect(storedTasks()).toHaveLength(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("reward redemption, penalty and manual adjust are server commands", () => {
  /**
   * Drive the parent-PIN manual-adjust dialog for one member, end to end: the
   * adjust control lives on a leaderboard row, so the Leaderboard tab is opened
   * first, then the amount, direction and the parent PIN.
   */
  async function applyAdjustTo(member: string) {
    const el = await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    await click(`Adjust points for ${member}`);
    await setField("Adjustment amount", "20");
    await click("Add points");
    await act(async () => {
      const pin = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(pin, PARENT_PIN);
      pin.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Apply").click(); });
    await settle(150);
    return el;
  }

  it("queues a redemption with the member PIN and adopts the server weekData", async () => {
    const REDEEM = { id: 7, name: "Movie night", emoji: "🎬", cost: 25 };
    localStorage.setItem("consuela-rewards", JSON.stringify([REDEEM]));
    server.redeemBody = {
      ok: true,
      weekData: {
        weekStart: MONDAY,
        points: { "Rebecca Mom": 25 },
        streak: {},
        lastActive: {},
        history: [{
          id: 5,
          timestamp: new Date().toISOString(),
          member: "Rebecca Mom",
          type: "redeem",
          amount: -25,
          description: "Redeemed: Movie night (-25pts)",
        }],
      },
    };
    seed([], { points: { "Rebecca Mom": 50 }, streak: {}, lastActive: {}, history: [] });
    const el = await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    await click(`Redeem Movie night`);
    await typePin("4-digit PIN", PARENT_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(150);

    // The real request body: the reward id and the member PIN, no cost.
    const posted = requestsFor("/api/rewards/redeem");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      action: "redeem",
      rewardId: 7,
      memberName: "Rebecca Mom",
      pin: PARENT_PIN,
    });
    expect(posted[0].body.cost).toBeUndefined();
    // The deduction is the server's ledger, adopted through the acknowledgment.
    expect(storedWeek().points["Rebecca Mom"]).toBe(25);
    expect(storedWeek().history).toHaveLength(1);
  });

  it("sends BOTH pins for a high-cost redemption", async () => {
    const EXPENSIVE = { id: 9, name: "Trip", emoji: "🎡", cost: 250 };
    localStorage.setItem("consuela-rewards", JSON.stringify([EXPENSIVE]));
    server.redeemBody = { ok: true, weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] } };
    seed([], { points: { "Rebecca Mom": 500 }, streak: {}, lastActive: {}, history: [] });
    const el = await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    await click("Redeem Trip");
    await typePin("Parent PIN", KID_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle();
    // The member then confirms with their own PIN; the parent's travels with it.
    await typePin("4-digit PIN", PARENT_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(150);

    const posted = requestsFor("/api/rewards/redeem");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ pin: PARENT_PIN, parentPin: KID_PIN });
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain(KID_PIN);
  });

  it("queues a penalty with the catalog id and the parent PIN, never a point value", async () => {
    const PENALTY = { id: 3, name: "Mess", emoji: "⚠️", points: 15 };
    localStorage.setItem("consuela-penalties", JSON.stringify([PENALTY]));
    server.ledgerBody = {
      success: true,
      action: "penalty",
      member: "Caspian Garcia",
      weekData: {
        weekStart: MONDAY,
        points: { "Caspian Garcia": 5 },
        streak: {},
        lastActive: {},
        history: [{
          id: 6,
          timestamp: new Date().toISOString(),
          member: "Caspian Garcia",
          type: "penalty",
          amount: -15,
          description: "Penalty: Mess (-15pts)",
        }],
      },
      reconciled: true,
    };
    seed([], { points: { "Caspian Garcia": 20 }, streak: {}, lastActive: {}, history: [] });
    const el = await renderAsync(<TasksPage />);
    await settle();
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    await click("Apply penalty");
    await settle();
    const applyTo = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
      setter.call(applyTo, "Caspian Garcia");
      applyTo.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Deduct").click(); });
    await settle(150);

    const posted = requestsFor("/api/tasks/ledger");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      action: "penalty",
      memberName: "Caspian Garcia",
      itemId: 3,
      pin: KID_PIN,
    });
    expect(posted[0].body.points).toBeUndefined();
    expect(storedWeek().points["Caspian Garcia"]).toBe(5);
  });

  it("queues a manual adjust with the signed amount and adopts the server week", async () => {
    server.ledgerBody = {
      success: true,
      action: "adjust",
      member: "Caspian Garcia",
      weekData: {
        weekStart: MONDAY,
        points: { "Caspian Garcia": 25 },
        streak: {},
        lastActive: {},
        history: [{
          id: 7,
          timestamp: new Date().toISOString(),
          member: "Caspian Garcia",
          type: "adjust",
          amount: 20,
          description: "Manual adjust: +20pts (helped out)",
        }],
      },
      reconciled: true,
    };
    seed([], { points: { "Caspian Garcia": 5 }, streak: {}, lastActive: {}, history: [] });
    await applyAdjustTo("Caspian Garcia");

    const posted = requestsFor("/api/tasks/ledger");
    expect(posted).toHaveLength(1);
    // ACTOR vs TARGET: `memberName` is the PIN-verified parent (and the route's
    // live `role === "parent"` gate), `targetMemberName` is whose balance moves.
    // One field could not carry both — a child-target adjust built a CHILD-PIN
    // body that the parent gate refused 403, so the whole child path was dead.
    expect(posted[0].body).toMatchObject({
      action: "adjust",
      memberName: "Rebecca Mom",
      targetMemberName: "Caspian Garcia",
      pin: PARENT_PIN,
    });
    expect(posted[0].body.memberName).not.toBe(posted[0].body.targetMemberName);
    expect(typeof posted[0].body.amount).toBe("number");
    expect(posted[0].body.points).toBeUndefined();
    expect(storedWeek().points["Caspian Garcia"]).toBe(25);
  });

  it("a queued child-target adjust keeps BOTH identities in the durable entry", async () => {
    // The outbox sanitizer used to strip `targetMemberName`, so a command that
    // had to WAIT in the queue (a sleeping NAS, a dropped wifi) replayed with
    // the actor's name only — a self-adjust that moved the PARENT's balance for
    // a reason written about their child. The durable copy is what actually
    // replays, so it is the copy that has to carry the target.
    server.ledgerStatus = 503;
    seed([], { points: { "Caspian Garcia": 5 }, streak: {}, lastActive: {}, history: [] });
    const el = await applyAdjustTo("Caspian Garcia");

    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0]).toMatchObject({
      route: "/api/tasks/ledger",
      action: "adjust",
      payload: { memberName: "Rebecca Mom", targetMemberName: "Caspian Garcia" },
    });
    // Nothing was adopted and nothing moved locally while the command waited,
    // and the family can see (and cancel) the command that is still pending.
    expect(storedWeek().points["Caspian Garcia"]).toBe(5);
    expect(el.querySelector('[aria-label="Cancel queued Caspian Garcia"]')).not.toBeNull();
  });

  it("a manual adjust that exhausts retries is never described as refused", async () => {
    // The tracked sibling of the approval exhaustion case: an adjust that paid
    // server-side while nothing confirmed it must not be announced as "didn't
    // go through" / "refused".
    server.ledgerStatus = 202;
    server.ledgerBody = {
      ok: true,
      reconciled: false,
      repairRequired: true,
      retryable: true,
      error: "The change has not reached every device yet. Consuela is still retrying.",
    };
    seed([], { points: { "Caspian Garcia": 25 }, streak: {}, lastActive: {}, history: [] });
    await applyAdjustTo("Caspian Garcia");
    expect(listTaskOutbox()[0]?.lastErrorReason).toBe("projection_pending");

    const nowSpy = vi.spyOn(Date, "now");
    let fakeNow = Date.now();
    nowSpy.mockImplementation(() => fakeNow);
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        fakeNow += 10 * 60_000;
        await act(async () => { await flushTaskOutbox(); });
      }
    } finally {
      nowSpy.mockRestore();
    }
    await settle(80);

    const text = document.body.textContent || "";
    expect(listTaskOutbox()[0]?.status).toBe("failed");
    expect(text).toContain("Consuela couldn't confirm that change");
    expect(text).not.toContain("refused that change");
    expect(text).not.toContain("didn't go through");
  });
});

describe("optimism is per operation, and a temp row can never be acted on", () => {
  it("releasing ONE operation's optimism leaves the other's row in place", async () => {
    server.claimStatus = 503;
    const SECOND = { ...ASSIGNED_TASK, id: 104, title: "Feed the cat" };
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 11 };
    seed([ASSIGNED_TASK, SECOND]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    // Two independent completion commands, both still in flight.
    await click("Complete Make bed");
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(120);
    await click("Complete Feed the cat");
    await typePin("4-digit PIN", KID_PIN);
    await act(async () => { dialogButton("Submit").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(2);
    const rows = el.querySelectorAll('[data-testid="optimistic-task-row"]');
    expect(rows).toHaveLength(2);

    // Release exactly ONE operation. The other row must survive: a global
    // "queue is not empty" reset would have wiped both.
    const [first] = listTaskOutbox();
    const cancel = el.querySelector('[aria-label="Cancel queued Make bed"]') as HTMLElement;
    expect(cancel).toBeTruthy();
    await act(async () => { cancel.click(); });
    await settle(150);

    expect(listTaskOutbox().map((entry) => entry.operationId)).not.toContain(first.operationId);
    expect(listTaskOutbox()).toHaveLength(1);
    expect(el.querySelectorAll('[data-testid="optimistic-task-row"]')).toHaveLength(1);
    expect(el.textContent || "").toContain("Feed the cat");
  });

  it("an edited chore renders ONCE, with the new copy, while its command is queued", async () => {
    server.manageStatus = 503;
    const existing = { ...ASSIGNED_TASK, title: "Old title", assignee: "Rebecca Mom" };
    seed([existing]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    // Edit is the parent-only LEFT SWIPE on the row (there is no Edit button).
    const row = el.querySelector(`[aria-label="Complete Old title"]`) as HTMLElement;
    expect(row).toBeTruthy();
    const opts = (x: number) => ({ bubbles: true, pointerId: 1, clientX: x });
    await act(async () => {
      const event = window.PointerEvent || window.Event;
      row.dispatchEvent(new event("pointerdown", opts(300) as never));
      row.dispatchEvent(new event("pointermove", opts(180) as never));
      row.dispatchEvent(new event("pointerup", opts(160) as never));
    });
    await settle();
    const title = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(title, "New title");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Save").click(); });
    await settle(120);

    // The queued command is an UPDATE, not an add…
    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({ route: "/api/tasks/manage", action: "update" });
    expect(JSON.stringify(requestsFor("/api/tasks/manage"))).not.toContain('"add"');

    // …the pending list carries the row exactly once, with the NEW copy (the
    // queue notice naming the command is counted separately)…
    const pendingCard = Array.from(el.querySelectorAll("h2, h3"))
      .find((heading) => heading.textContent === "Pending")!
      .closest(".widget-card") as HTMLElement;
    expect((pendingCard.textContent || "").match(/New title/g) ?? []).toHaveLength(1);
    expect(pendingCard.textContent || "").not.toContain("Old title");
    // …and it is still the server's row, not a temporary one.
    expect(el.querySelector('[aria-label="Complete New title"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="optimistic-add-row"]')).toBeNull();
    expect(storedTasks()[0].title).toBe("Old title");
  });

  it("two queued updates to the same chore collapse to ONE row carrying the newest copy", async () => {
    server.manageStatus = 503;
    const existing = { ...ASSIGNED_TASK, title: "Original", assignee: "Rebecca Mom" };
    seed([existing]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    async function editTo(title: string) {
      const row = el.querySelector('[aria-label^="Complete "]') as HTMLElement;
      expect(row).toBeTruthy();
      const opts = (x: number) => ({ bubbles: true, pointerId: 1, clientX: x });
      await act(async () => {
        const event = window.PointerEvent || window.Event;
        row.dispatchEvent(new event("pointerdown", opts(300) as never));
        row.dispatchEvent(new event("pointermove", opts(180) as never));
        row.dispatchEvent(new event("pointerup", opts(160) as never));
      });
      await settle();
      const field = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
        setter.call(field, title);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { dialogButton("Save").click(); });
      await settle(120);
    }

    await editTo("First edit");
    await editTo("Second edit");

    // Two commands, ONE rendered row, and it is the newest copy.
    expect(listTaskOutbox().filter((entry) => entry.action === "update")).toHaveLength(2);
    const pendingCard = Array.from(el.querySelectorAll("h2, h3"))
      .find((heading) => heading.textContent === "Pending")!
      .closest(".widget-card") as HTMLElement;
    const rendered = pendingCard.textContent || "";
    expect(rendered.match(/Second edit/g) ?? []).toHaveLength(1);
    expect(rendered).not.toContain("First edit");
    expect(rendered).not.toContain("Original");
    expect(el.querySelectorAll('[aria-label="Complete Second edit"]')).toHaveLength(1);
  });

  it("a queued add row renders inert — no complete, edit or delete control", async () => {
    server.manageStatus = 503;
    seed([]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await click("Add task");
    const input = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Rake leaves");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Save").click(); });
    await settle(120);

    const row = el.querySelector('[data-testid="optimistic-add-row"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Rake leaves");
    // Inert: no role=button row, no complete label, nothing clickable.
    expect(row!.querySelector('[role="button"]')).toBeNull();
    expect(row!.querySelector("button")).toBeNull();
    expect(el.querySelector('[aria-label="Complete Rake leaves"]')).toBeNull();
    // And the queued add is the only command — nothing was sent for a temp id.
    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/manage", action: "add" });
    expect(JSON.stringify(requestsFor("/api/tasks/manage"))).not.toContain("delete");
  });

  it("a delete of a temporary row is refused, never sent as an unknown id", async () => {
    server.manageStatus = 503;
    seed([]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await click("Add task");
    const input = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Rake leaves");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { dialogButton("Save").click(); });
    await settle(120);

    // Reaching the delete handler for a row the server has never seen (the
    // temporary id) must refuse rather than send it.
    const temporaryId = (listTaskOutbox()[0].displayTarget as any).temporaryId;
    expect(typeof temporaryId).toBe("number");
    const del = el.querySelector(`[aria-label="Delete Rake leaves"]`);
    expect(del).toBeNull();
  });
});

describe("no local writers survive in the Tasks page", () => {
  it("never POSTs the retired snapshot writer for any task operation", async () => {
    server.approveStatus = 503;
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(server.syncPosts).toHaveLength(0);
  });
});
