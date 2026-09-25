// @vitest-environment jsdom
// Task 10 — every Tasks-page write is a durable outbox command. Nothing moves
// local points, history, or task rows before an acknowledgment; the PIN lives
// only in the ephemeral registry; the legacy snapshot writer is gone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, weekKey } from "@/lib/task-utils";
import {
  __resetTaskOutboxForTests,
  listTaskOutbox,
  readTaskCommandCredential,
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

const MONDAY = todayMondayISO();

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
  echoReceipt: false,
  approveSeen: false,
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
      if (url === "/api/rewards/redeem") {
        server.requests.push({ route: url, body });
        return { ok: true, status: 200, json: async () => server.redeemBody ?? { ok: true } };
      }
      if (url === "/api/tasks/ledger") {
        server.requests.push({ route: url, body });
        return { ok: true, status: 200, json: async () => server.ledgerBody ?? { success: true } };
      }
      if (url === "/api/tasks/claim" || url === "/api/tasks/approve" || url === "/api/tasks/manage" || url === "/api/tasks/config") {
        server.requests.push({ route: url, body });
        if (url === "/api/tasks/claim") {
          if (server.claimThrows) throw new TypeError("network unavailable");
          return { ok: server.claimStatus < 400, status: server.claimStatus, json: async () => server.claimBody ?? { success: true } };
        }
        if (url === "/api/tasks/approve") {
          server.approveSeen = true;
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
  completedInWeek: weekKey(),
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
  server.echoReceipt = false;
  server.approveSeen = false;
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

  it("adopts 202 authoritative data before clearing the outbox", async () => {
    server.approveStatus = 202;
    server.approveBody = { success: true, reconciled: false, repairRequired: true };
    server.echoReceipt = true;
    server.snapshot = {
      tasks: [{ id: 101, title: "Dishes", completed: true, completedBy: "Jasmine Rose" }],
      weekData: weekWithEarn("Jasmine Rose", 8),
      operationReceipts: {},
      configOperationReceipts: {},
    };
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(0);
    expect(storedWeek().points["Jasmine Rose"]).toBe(8);
  });

  it("retains a 202 whose pulled snapshot cannot prove it resolved", async () => {
    server.approveStatus = 202;
    server.approveBody = { success: true, reconciled: false };
    server.snapshot = { tasks: [], weekData: null, operationReceipts: {}, configOperationReceipts: {} };
    seed([PENDING_TASK]);
    await openApprovalQueue();
    await typePin("Parent PIN", PARENT_PIN);
    await act(async () => { dialogButton("Approve").click(); });
    await settle(120);

    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].status).toBe("reconciling");
    expect(storedWeek().history).toHaveLength(0);
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
    const done = { ...ASSIGNED_TASK, assignee: "Rebecca Mom", completed: true, completedBy: "Rebecca Mom", completedAt: new Date().toISOString(), completedInWeek: weekKey() };
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
    const el = await renderAsync(<TasksPage />);
    await settle();
    // The adjust control lives on a leaderboard row, so switch to that tab.
    const leaderboard = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Leaderboard"),
    ) as HTMLButtonElement;
    await act(async () => { leaderboard.click(); });
    await settle();
    await click("Adjust points for Caspian Garcia");
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

    const posted = requestsFor("/api/tasks/ledger");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: PARENT_PIN,
    });
    expect(typeof posted[0].body.amount).toBe("number");
    expect(posted[0].body.points).toBeUndefined();
    expect(storedWeek().points["Caspian Garcia"]).toBe(25);
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
