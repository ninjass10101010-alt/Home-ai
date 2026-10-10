// @vitest-environment jsdom
// Tasks page integrity fixes — the wrong command reaches the server, the UI says
// something untrue, and the whole-class bugs that let a dismissed dialog hijack
// the next PIN-gated action.
//
// Every case here drives the REAL page and asserts on what actually reaches the
// wire (the durable outbox / the fetch bodies), because every one of these
// defects was invisible in the rendered output and only visible in the command.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { localWeekStartISO, localTodayISO } from "@/lib/local-date";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// "Alex" and "Alexandra" share a first name ON PURPOSE: every
// `name.startsWith(currentUser.name)` identity lookup matched one to the other.
const ROSTER = [
  { id: 1, name: "Rebecca", fullName: "Rebecca Mom", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Alex", fullName: "Alex Garcia", role: "parent", emoji: "🧑", color: "nori" },
  { id: 3, name: "Alexandra", fullName: "Alexandra Garcia", role: "child", age: 12, emoji: "👧", color: "rose" },
  { id: 4, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
];

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => ROSTER,
    selectMembersFallback: () => ROSTER,
  },
}));

const MONDAY = localWeekStartISO();
const PARENT_PIN = "9026";

const server = vi.hoisted(() => ({
  /** Which member the PIN verifier accepts, and for which pin. */
  verifyOkFor: "" as string,
  verifyThrows: false,
  verifyStatus: 200,
  ledgerStatus: 200,
  ledgerBody: null as null | any,
  ledgerThrows: false,
  manageStatus: 200,
  manageBody: null as null | any,
  syncStatus: 200,
  syncThrows: false,
  syncSnapshot: null as null | any,
  requests: [] as any[],
}));

function seed(tasks: any[], extra?: { points?: Record<string, number>; rewards?: any[]; penalties?: any[] }) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({
    weekStart: MONDAY,
    points: extra?.points ?? {},
    streak: {},
    lastActive: {},
    history: [],
  }));
  if (extra?.rewards) localStorage.setItem("consuela-rewards", JSON.stringify(extra.rewards));
  if (extra?.penalties) localStorage.setItem("consuela-penalties", JSON.stringify(extra.penalties));
}

function safeParse(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = init?.body ? safeParse(String(init.body)) : null;
    if (url.includes("/api/members/verify")) {
      if (server.verifyThrows) throw new TypeError("network unavailable");
      const asked = String(body?.memberName ?? "");
      const ok = server.verifyStatus === 200 && server.verifyOkFor.split("|").includes(asked);
      if (!ok) return { ok: false, status: server.verifyStatus === 200 ? 401 : server.verifyStatus, json: async () => ({ error: "unauthorized" }) };
      const member = ROSTER.find((m) => m.fullName === asked)!;
      return { ok: true, status: 200, json: async () => ({ member: { name: member.name, fullName: member.fullName, role: member.role } }) };
    }
    if (url === "/api/tasks/sync") {
      if (server.syncThrows) throw new TypeError("network unavailable");
      if (server.syncStatus !== 200) return { ok: false, status: server.syncStatus, json: async () => ({ error: "unavailable" }) };
      return { ok: true, status: 200, json: async () => ({ snapshot: server.syncSnapshot, reconciled: true }) };
    }
    if (url === "/api/tasks/ledger") {
      server.requests.push({ route: url, body });
      if (server.ledgerThrows) throw new TypeError("network unavailable");
      return {
        ok: server.ledgerStatus < 400,
        status: server.ledgerStatus,
        json: async () => server.ledgerBody ?? { success: true, reconciled: true, weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] } },
      };
    }
    if (url === "/api/tasks/manage") {
      server.requests.push({ route: url, body });
      return {
        ok: server.manageStatus < 400,
        status: server.manageStatus,
        json: async () => server.manageBody ?? { success: true },
      };
    }
    if (url.startsWith("/api/tasks/claim") || url.startsWith("/api/rewards/")) {
      server.requests.push({ route: url, body });
      return { ok: false, status: 503, json: async () => ({ error: "unavailable" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function requestsFor(route: string) {
  return server.requests.filter((entry) => entry.route.includes(route));
}

let root: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { root = createRoot(el); root.render(ui); });
  return el;
}

async function settle(ms = 90) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

async function unmount() {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  document.body.innerHTML = "";
}

function text(): string { return document.body.textContent || ""; }

function buttonByText(label: string, scope?: ParentNode): HTMLButtonElement {
  const host = scope ?? document.querySelector('[role="dialog"]') ?? document;
  const found = Array.from(host.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === label || (b.textContent || "").trim().includes(label),
  ) as HTMLButtonElement | undefined;
  expect(found, `button "${label}"`).toBeTruthy();
  return found!;
}

async function clickByAriaLabel(label: string) {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(el, `aria-label="${label}"`).not.toBeNull();
  await act(async () => { el.click(); });
  await settle();
}

async function setField(label: string, value: string) {
  const input = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  expect(input, `field "${label}"`).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typePin(placeholder: string, pin: string) {
  await setFieldByPlaceholder(placeholder, pin);
}

async function setFieldByPlaceholder(placeholder: string, value: string) {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input, `placeholder="${placeholder}"`).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function setSelectValue(value: string) {
  const select = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
  expect(select, "dialog select").not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function toLeaderboard() {
  await act(async () => { buttonByText("Leaderboard", document).click(); });
  await settle();
}

async function submitDialog(label: string) {
  await act(async () => { buttonByText(label).click(); });
  await settle(140);
}

async function selectTile(label: string) {
  const tile = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(tile, `tile ${label}`).not.toBeNull();
  await act(async () => { tile.click(); });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  server.verifyOkFor = "";
  server.verifyThrows = false;
  server.verifyStatus = 200;
  server.ledgerStatus = 200;
  server.ledgerBody = null;
  server.ledgerThrows = false;
  server.manageStatus = 200;
  server.manageBody = null;
  server.syncStatus = 200;
  server.syncThrows = false;
  server.syncSnapshot = null;
  server.requests = [];
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
  await unmount();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-1 — a dismissed crew PIN dialog hijacked the next PIN-gated action
// ─────────────────────────────────────────────────────────────────────────────

const CREW_TASK = {
  id: 70, title: "Clean the garage", assignee: "Crew", assigneeEmoji: "🤝",
  due: localTodayISO(), points: 10, recurring: null, category: "Chores",
  completed: false, priority: "medium", universal: false, stealable: false,
  crewSize: 3, crew: { members: [] }, crewCloseMode: "strict",
};
const CHORE = {
  id: 71, title: "Water the plants", assignee: "Caspian Garcia", assigneeEmoji: "🧒",
  due: localTodayISO(), points: 5, recurring: null, category: "Chores",
  completed: false, priority: "low", universal: false, stealable: false,
};

describe("P0-1 one PIN intent: a dismissed crew dialog cannot hijack the next action", () => {
  async function signInAsCaspian() {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
  }

  it("dismissing a crew PIN dialog then opening a normal chore's PIN queues the NORMAL completion", async () => {
    await signInAsCaspian();
    server.verifyOkFor = "Caspian Garcia";
    seed([CREW_TASK, CHORE]);

    const el = await renderAsync(<TasksPage />);
    await settle();

    // 1. join the crew -> the crew PIN dialog opens
    await clickByAriaLabel("Join crew for Clean the garage");
    expect(text()).toContain("Join the crew");

    // 2. dismiss it with Escape (the modal's own onClose path)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // 3. now tap a PLAIN assigned chore -> its own PIN dialog
    await clickByAriaLabel("Complete Water the plants");
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Complete "Water the plants"');
    // The crew arm is not what this dialog is about.
    expect(dialog.textContent).not.toContain("crew");
    // …and the claim-for select (a crew-only affordance) is absent.
    expect(dialog.querySelector("select")).toBeNull();

    await typePin("4-digit PIN", "3141");
    await submitDialog("Submit");

    const entries = listTaskOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 71 } });
    // The crew arm can never fire against the previous crew task again.
    expect(entries.some((e) => e.action === "crew-join" || e.action === "crew-checkin")).toBe(false);
    expect(el).toBeTruthy();
  });

  it("the crew arm still works after the dismissal (the intent is not simply broken)", async () => {
    await signInAsCaspian();
    server.verifyOkFor = "Caspian Garcia";
    seed([CREW_TASK, CHORE]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Join crew for Clean the garage");
    await typePin("4-digit PIN", "3141");
    await submitDialog("Submit");

    const entries = listTaskOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "crew-join", payload: { taskId: 70, memberName: "Caspian Garcia" } });
  });

  it("the crew dialog's Cancel clears the crew arm as well as the task id", async () => {
    await signInAsCaspian();
    seed([CREW_TASK, CHORE]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Join crew for Clean the garage");
    await act(async () => { buttonByText("Cancel").click(); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // The next dialog is the chore's, and it says so.
    await clickByAriaLabel("Complete Water the plants");
    expect(text()).toContain("Complete \"Water the plants\"");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-2 — the actor/target split on the ledger command
// ─────────────────────────────────────────────────────────────────────────────

describe("P0-2 penalty and manual adjust send the VERIFIED PARENT as the actor", () => {
  it("a child-target penalty sends memberName: <parent> + targetMemberName: <child>", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    seed([], { penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }] });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Apply penalty");
    // Target the CHILD: the balance that moves is theirs.
    await setSelectValue("Alexandra Garcia");
    await typePin("4-digit PIN", PARENT_PIN);
    await submitDialog("Deduct");

    const posted = requestsFor("/api/tasks/ledger");
    expect(posted).toHaveLength(1);
    // The PIN SUBJECT (the actor, and the route's live `role === "parent"`
    // gate) and the debited member are no longer the same field.
    expect(posted[0].body).toMatchObject({
      action: "penalty",
      memberName: "Rebecca Mom",
      targetMemberName: "Alexandra Garcia",
      itemId: 7,
    });
    expect(posted[0].body.points).toBeUndefined();
  });

  it("a child-target manual adjust sends memberName: <parent> + targetMemberName: <child>", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    seed([], { points: { "Alexandra Garcia": 5 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Adjust points for Alexandra Garcia");
    await setField("Adjustment amount", "20");
    await act(async () => { buttonByText("Add points").click(); });
    await setField("Parent PIN", PARENT_PIN);
    await submitDialog("Apply");

    const posted = requestsFor("/api/tasks/ledger");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      action: "adjust",
      memberName: "Rebecca Mom",
      targetMemberName: "Alexandra Garcia",
      pin: PARENT_PIN,
    });
    expect(typeof posted[0].body.amount).toBe("number");
  });

  it("an adjust against the parent's OWN balance omits targetMemberName (same-member default)", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    seed([], { points: { "Rebecca Mom": 50 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Adjust points for Rebecca Mom");
    await setField("Adjustment amount", "10");
    await act(async () => { buttonByText("Add points").click(); });
    await setField("Parent PIN", PARENT_PIN);
    await submitDialog("Apply");

    const posted = requestsFor("/api/tasks/ledger");
    expect(posted[0].body.memberName).toBe("Rebecca Mom");
    expect(posted[0].body.targetMemberName).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-3 — the three silent `return`s are dead controls
// ─────────────────────────────────────────────────────────────────────────────

describe("P0-3 the previously silent returns say something", () => {
  it("a chore completed on another device reports it instead of re-enabling Submit silently", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Caspian Garcia";
    // The row still renders as pending, but the server has already stamped it.
    seed([{ ...CHORE, completedInWeek: MONDAY }]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Complete Water the plants");
    await typePin("4-digit PIN", "3141");
    await submitDialog("Submit");

    expect(text()).toContain("already completed on another device");
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("the undo dialog says so when the chore is no longer completed", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Caspian Garcia";
    seed([{ ...CHORE, completed: true, completedBy: "Caspian Garcia", completedAt: new Date().toISOString(), completedInWeek: MONDAY }]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    await selectTile("Show Caspian Garcia's chores");
    await act(async () => { buttonByText("Show completed", el).click(); });
    await settle();
    await clickByAriaLabel("Undo completion of Water the plants");

    // The row stops existing underneath the OPEN dialog: another device deleted
    // it and this page adopted the tombstone through its normal sync leg.
    server.syncSnapshot = {
      revision: "77",
      tasks: [],
      deletedTaskIds: [71],
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    };
    await act(async () => { window.dispatchEvent(new Event("consuela-data-refreshed")); });
    await settle(200);
    await typePin("4-digit PIN", "3141");
    await submitDialog("Undo");

    expect(text()).toContain("isn't completed any more");
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("the PIN-free kid path reports the already-completed case instead of doing nothing", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([{ ...CHORE, completedInWeek: MONDAY }]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Complete Water the plants");
    expect(text()).toContain("already completed on another device");
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("a double-tap on the PIN-free path queues ONE command", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Water the plants"]') as HTMLElement;
    await act(async () => { row.click(); row.click(); });
    await settle();

    expect(listTaskOutbox()).toHaveLength(1);
    expect(text()).toContain("already on its way");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-4 — nothing is "confirmed" before an acknowledgment exists
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-4 no confirmation is printed before the server has answered", () => {
  it("a queued penalty says Sending…, never 'the family server confirms'", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    // A refusal the browser cannot see: the queue call returns synchronously.
    server.ledgerStatus = 409;
    server.ledgerBody = { success: false, reason: "insufficient_balance" };
    seed([], { penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }], points: { "Rebecca Mom": 500 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Apply penalty");
    await typePin("4-digit PIN", PARENT_PIN);
    await submitDialog("Deduct");

    // The dialog is honest about what has happened.
    expect(text()).toContain("Sending Skipped trash");
    expect(text()).not.toContain("the family server confirms");
    await settle(200);
    expect(text()).not.toContain("the family server confirms");
  });

  it("a queued manual adjust says Sending…, never 'the family server confirms'", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    seed([], { points: { "Rebecca Mom": 50 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Adjust points for Rebecca Mom");
    await setField("Parent PIN", PARENT_PIN);
    await act(async () => { buttonByText("Add points").click(); });
    await submitDialog("Apply");

    expect(text()).toContain("Sending");
    expect(text()).not.toContain("the family server confirms");
  });

  it("a queued redemption says Sending…, never 'the family server confirms'", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Caspian Garcia";
    seed([], {
      rewards: [{ id: 3, name: "Ice cream", emoji: "🍦", cost: 20 }],
      points: { "Caspian Garcia": 100 },
    });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Redeem Ice cream");
    await typePin("4-digit PIN", "3141");
    await submitDialog("Submit");

    expect(text()).toContain("Sending");
    expect(text()).not.toContain("the family server confirms");
    await settle(200);
    expect(text()).not.toContain("the family server confirms");
  });

  it("a penalty PIN gate still distinguishes unreachable from a wrong PIN", async () => {
    // Carried over from tests/unit/tasks-pin-error-paths.test.tsx, which drives
    // this path as a GUEST — and a guest can no longer reach it at all, because
    // the penalty admin surface is parent-gated (P1-9).
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([], { penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }], points: { "Rebecca Mom": 500 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    // Network down: "Couldn't reach", NEVER "Wrong PIN".
    server.verifyThrows = true;
    await clickByAriaLabel("Apply penalty");
    await typePin("4-digit PIN", PARENT_PIN);
    await submitDialog("Deduct");
    let shown = text();
    expect(shown).toContain("Couldn't reach Consuela");
    expect(shown).not.toContain("Wrong PIN. Try again.");
    expect(listTaskOutbox()).toHaveLength(0);

    // Every PIN rejected: an honest "Wrong PIN", still nothing queued.
    await unmount();
    server.verifyThrows = false;
    server.verifyStatus = 401;
    server.requests = [];
    seed([], { penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }], points: { "Rebecca Mom": 500 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await clickByAriaLabel("Apply penalty");
    await typePin("4-digit PIN", "0000");
    await submitDialog("Deduct");
    expect(text()).toContain("Wrong PIN. Try again.");
    expect(listTaskOutbox()).toHaveLength(0);
    expect(requestsFor("/api/tasks/ledger")).toHaveLength(0);
  });

  it("a 4xx refusal is reported as a refusal, never as a confirmation", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    server.ledgerStatus = 400;
    server.ledgerBody = { success: false, reason: "invalid_task_state" };
    seed([], { penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }], points: { "Rebecca Mom": 500 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Apply penalty");
    await typePin("4-digit PIN", PARENT_PIN);
    await submitDialog("Deduct");
    await settle(400);

    expect(text()).toContain("wasn't applied");
    expect(text()).not.toContain("the family server confirms");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-5 — the failure toast tone
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-5 a failure toast is an ERROR toast", () => {
  it("'couldn't come up with ideas' renders in the error tone, not mint-on-mint", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();

    await act(async () => { buttonByText("Get chore ideas from Consuela", document).click(); });
    await settle(200);

    const toast = document.querySelector('div.fixed.top-4[role="status"]') as HTMLElement;
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain("couldn't come up with ideas");
    // The error tone is the rose token; success is the mint token.
    expect(toast.className).toContain("--color-accent-rose");
    expect(toast.className).not.toContain("--color-accent-mint");
  });

  it("a still-saving chore toast is a success, and a refused one is an error", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Complete Water the plants");
    const toast = document.querySelector('div.fixed.top-4[role="status"]') as HTMLElement;
    expect(toast.textContent).toContain("on the way");
    expect(toast.className).toContain("--color-accent-mint");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-6 — a terminal failure releases the optimistic mark
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-6 a terminal failure releases the optimistic mark and names the reason", () => {
  it("a rejected Add stops rendering '⏳ Saving' and reports the refusal", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.manageStatus = 404;
    server.manageBody = { success: false, reason: "unknown_task" };
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Add task");
    await setFieldByPlaceholder("Task title", "Take out trash");
    await act(async () => { buttonByText("Save").click(); });
    await settle(300);

    // The temporary row is GONE (the mark was released on the terminal event)…
    expect(document.querySelectorAll('[data-testid="optimistic-add-row"]')).toHaveLength(0);
    // …and the family is told it was refused, in the error tone.
    expect(text()).toContain("refused");
  });

  it("the acknowledgment listener is unsubscribed on unmount (no leak across visits)", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    // Visit /tasks three times; an unmounted page must not setState.
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    for (let i = 0; i < 3; i++) {
      await renderAsync(<TasksPage />);
      await settle();
      await unmount();
    }
    expect(errors).toHaveLength(0);
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-7 — a failed sync read must not render an empty board
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-7 a failed sync read is an unknown, never an empty board", () => {
  it("a 503 sync read does NOT render 'All caught up'", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.syncStatus = 503;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle(150);

    expect(text()).not.toContain("All caught up");
    expect(text()).toContain("Couldn't reach the family server");
  });

  it("a network failure on the sync read does NOT render 'All caught up'", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.syncThrows = true;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle(150);

    expect(text()).not.toContain("All caught up");
    expect(text()).toContain("Couldn't reach the family server");
  });

  it("a healthy read with genuinely no tasks still says All caught up", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle(150);

    expect(text()).toContain("All caught up");
  });

  it("a 401 still reads as 'hidden', not 'failed'", async () => {
    mockAuth.isLoggedIn = false;
    server.syncStatus = 401;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle(150);

    expect(text()).toContain("Sign in");
    expect(text()).not.toContain("All caught up");
  });

  it("a NEWER snapshot is adopted and an OLDER one is ignored (monotonic revision)", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    // Each revision carries its OWN row id, so a wrongly adopted response is
    // visible as a row rather than being masked by the merge's own proof gate
    // (which legitimately refuses a title change on a KNOWN row).
    const serve = (revision: string, id: number) => {
      server.syncSnapshot = {
        revision,
        tasks: [{ ...CHORE, id, title: `rev-${revision} title`, completed: false }],
        weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
      };
    };
    serve("9", 71);
    seed([]);
    await renderAsync(<TasksPage />);
    await settle(180);
    await selectTile("Show Caspian Garcia's chores");
    // The mount read established revision 9.
    expect(text()).toContain("rev-9 title");

    // A strictly NEWER snapshot lands.
    serve("12", 72);
    await act(async () => { window.dispatchEvent(new Event("consuela-data-refreshed")); });
    await settle(200);
    await selectTile("Show Caspian Garcia's chores");
    expect(text()).toContain("rev-12 title");

    // A STALE response — the one that lost the race — must NOT be adopted, or it
    // would roll the family's board back to an older projection.
    serve("10", 73);
    await act(async () => { window.dispatchEvent(new Event("consuela-data-refreshed")); });
    await settle(200);
    await selectTile("Show Caspian Garcia's chores");
    expect(text()).toContain("rev-12 title");
    expect(text()).not.toContain("rev-10 title");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-8 — identity is resolved once and compared exactly
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-8 identity is exact, and the reward/penalty modals default to YOU", () => {
  it("a filter tile for 'Alex' does not select 'Alexandra'", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([
      { ...CHORE, id: 80, title: "Alexandra only chore", assignee: "Alexandra Garcia" },
      { ...CHORE, id: 81, title: "Alex only chore", assignee: "Alex Garcia" },
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    // Two members share the first name, so the VISIBLE tiles are identical —
    // which is exactly why the accessible names must not be.
    const tiles = [...el.querySelectorAll(".member-tile")];
    const alex = tiles.filter((t) => (t.querySelector(".member-tile-name")?.textContent || "").trim() === "Alex");
    expect(alex.length).toBeGreaterThanOrEqual(1);
    const labels = alex.map((t) => t.getAttribute("aria-label"));
    expect(labels).toContain("Show Alex Garcia's chores");

    // Clicking Alex Garcia's tile shows ONLY Alex Garcia's chore.
    const target = tiles.find((t) => t.getAttribute("aria-label") === "Show Alex Garcia's chores") as HTMLElement;
    await act(async () => { target.click(); });
    await settle();

    expect(text()).toContain("Alex only chore");
    expect(text()).not.toContain("Alexandra only chore");
  });

  it("the reward redemption defaults to the SIGNED-IN member, not the first roster entry", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Caspian Garcia";
    seed([], {
      rewards: [{ id: 3, name: "Ice cream", emoji: "🍦", cost: 20 }],
      points: { "Caspian Garcia": 100, "Rebecca Mom": 900 },
    });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Redeem Ice cream");
    const select = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
    expect(select.value).toBe("Caspian Garcia");
  });

  it("a reward the signed-in member cannot afford names THEM, not the first roster entry", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    seed([], {
      rewards: [{ id: 3, name: "Ice cream", emoji: "🍦", cost: 850 }],
      points: { "Caspian Garcia": 0, "Rebecca Mom": 900 },
    });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Redeem Ice cream");
    expect(text()).toContain("Caspian needs 850 more pts");
    expect(text()).not.toContain("Rebecca needs");
  });

  it("the penalty dialog defaults to the SIGNED-IN member", async () => {
    mockAuth.currentUser = { name: "Alex", role: "parent", emoji: "🧑" };
    mockAuth.isLoggedIn = true;
    seed([], { penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }] });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    await clickByAriaLabel("Apply penalty");
    const select = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
    expect(select.value).toBe("Alex Garcia");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-9 — role gates
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-9 a guest is not offered the reward/penalty ADMIN surface", () => {
  async function asGuest() {
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
    seed([], { rewards: [{ id: 3, name: "Ice cream", emoji: "🍦", cost: 20 }], penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }] });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    return el;
  }

  it("a guest sees no Add/Edit reward, no Add penalty and no Apply penalty", async () => {
    const el = await asGuest();
    const labels = Array.from(el.querySelectorAll("[aria-label]")).map((n) => n.getAttribute("aria-label"));
    expect(labels.some((l) => l === "Edit reward")).toBe(false);
    expect(labels.some((l) => l === "Apply penalty")).toBe(false);
    expect(labels.some((l) => l === "Edit penalty")).toBe(false);
    // Redemption is the one affordance that legitimately belongs to a guest.
    expect(document.querySelector('[aria-label="Redeem Ice cream"]')).not.toBeNull();
    // …and the guest still cannot add a chore.
    expect(document.querySelector('[aria-label="Add task"]')).toBeNull();
    expect(el).toBeTruthy();
  });

  it("a guest is not offered 'Set a Family Goal'", async () => {
    const el = await asGuest();
    expect(text()).not.toContain("Set a Family Goal");
  });

  it("a parent still gets the full admin surface", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([], { rewards: [{ id: 3, name: "Ice cream", emoji: "🍦", cost: 20 }], penalties: [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }] });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    expect(document.querySelector('[aria-label="Edit reward"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Apply penalty"]')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-10 — the Completed card is reachable when only an older week has rows
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-10 the Completed card is gated on the list it actually maps over", () => {
  it("a completion from a PREVIOUS week still renders the card and its undo path", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Caspian Garcia";
    // completedInWeek is LAST week's Monday: `thisWeeksCompletedCount` is 0.
    seed([{
      ...CHORE, id: 90, title: "Last week's chore",
      completed: true, completedBy: "Caspian Garcia",
      completedAt: "2026-01-05T10:00:00.000Z",
      completedInWeek: "2026-01-05",
    }]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await selectTile("Show Caspian Garcia's chores");

    expect(el.textContent || "").toContain("Completed");
    await act(async () => { buttonByText("Show completed", el).click(); });
    await settle();

    expect(text()).toContain("Last week's chore");
    // The undo affordance is reachable — it used to be unreachable entirely.
    expect(document.querySelector('[aria-label="Undo completion of Last week\'s chore"]')).not.toBeNull();
  });

  it("the card's header count is the count of the rows it lists", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([
      { ...CHORE, id: 90, title: "Older chore", completed: true, completedBy: "Caspian Garcia", completedAt: "2026-01-05T10:00:00.000Z", completedInWeek: "2026-01-05" },
      { ...CHORE, id: 91, title: "Newer chore", completed: true, completedBy: "Caspian Garcia", completedAt: new Date().toISOString(), completedInWeek: MONDAY },
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await selectTile("Show Caspian Garcia's chores");

    // "2 done" — reconciled with the two rows the expanded list shows.
    expect(el.textContent || "").toContain("2 done");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-11 — a stale success timer cannot close a freshly opened dialog
// ─────────────────────────────────────────────────────────────────────────────

describe("P1-11 a stale success timer cannot close the NEXT dialog", () => {
  it("a chore completed 200ms ago does not null the dialog opened after it", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Caspian Garcia";
    seed([CHORE, { ...CHORE, id: 72, title: "Feed the dog" }]);
    await renderAsync(<TasksPage />);
    await settle();

    // Complete the first chore: its success timer is armed for 1500ms.
    await clickByAriaLabel("Complete Water the plants");
    await typePin("4-digit PIN", "3141");
    await submitDialog("Submit");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // Dismiss it, then open the SECOND chore well inside the stale timer.
    await act(async () => { buttonByText("Cancel").click(); });
    await settle(200);
    await clickByAriaLabel("Complete Feed the dog");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const described = text();
    expect(described).toContain("Feed the dog");

    // Let the previous attempt's 1500ms window elapse in full.
    await settle(1600);
    // The dialog the user is typing into is STILL there.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(text()).toContain("Feed the dog");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2 — the visual / a11y contract
// ─────────────────────────────────────────────────────────────────────────────

describe("P2 the remaining visual and a11y contract", () => {
  it("two suggestions adopted in the same tick get distinct optimistic ids", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    // Two suggestions whose titles differ, so both are adoptable in one tick.
    server.manageStatus = 503;
    const original = (globalThis.fetch as any);
    vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url === "/api/hermes/chat") {
        // TWO suggestions in one reply, so both Add buttons exist together.
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true,
            result: { actions: [
              { type: "task", mode: "assigned", title: "Idea alpha", assignee: "Rebecca Mom", points: 5, category: "Chores", priority: "medium" },
              { type: "task", mode: "assigned", title: "Idea beta", assignee: "Rebecca Mom", points: 6, category: "Chores", priority: "medium" },
            ] },
          }),
        };
      }
      return original(input, init);
    }));

    seed([]);
    await renderAsync(<TasksPage />);
    await settle();

    await act(async () => { buttonByText("Get chore ideas from Consuela", document).click(); });
    await settle(200);

    // Adopt BOTH inside ONE act batch: uid() is called twice with no clock tick
    // and no render in between — the exact shape that used to mint one id twice.
    await act(async () => {
      const adds = Array.from(document.querySelectorAll("button")).filter((b) => (b.textContent || "").trim() === "Add");
      expect(adds.length).toBe(2);
      adds[0].click();
      adds[1].click();
    });
    await settle(150);

    const rows = document.querySelectorAll('[data-testid="optimistic-add-row"]');
    // Both temporary rows are rendered, and they are DISTINCT nodes: a
    // duplicate React key would collapse them into one.
    expect(rows.length).toBe(2);
    expect(new Set(Array.from(rows).map((r) => r.textContent)).size).toBe(2);
  });

  it("the outbox banner is a live region, splits the failure out, and has a 44px Cancel", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Water the plants");

    const banner = document.querySelector('[data-testid="task-command-queue"]') as HTMLElement;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    // The Cancel control carries the hit-area primitive.
    const cancel = banner.querySelector('[aria-label^="Cancel queued"]') as HTMLElement;
    expect(cancel.className).toContain("hit-44");
  });

  it("a failure line is its OWN element with rose ink, never the amber of 'sending'", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.manageStatus = 404;
    server.manageBody = { success: false, reason: "unknown_task" };
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Add task");
    await settle();
    await setFieldByPlaceholder("Task title", "Nope");
    await act(async () => { buttonByText("Save").click(); });
    await settle(300);

    const banner = document.querySelector('[data-testid="task-command-queue"]') as HTMLElement;
    const paragraphs = Array.from(banner.querySelectorAll("p"));
    const failure = paragraphs.find((p) => (p.textContent || "").includes("couldn't be sent"));
    expect(failure).toBeTruthy();
    expect(failure!.className).toContain("--color-accent-ink-rose");
    // It is a SEPARATE element from the sending line.
    expect(paragraphs.length).toBeGreaterThan(1);
  });

  it("every PIN dialog's error is an announced region wired to its input", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "";
    seed([CHORE]);
    await renderAsync(<TasksPage />);
    await settle();

    await clickByAriaLabel("Complete Water the plants");
    await typePin("4-digit PIN", "9999");
    await submitDialog("Submit");

    const alert = document.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Wrong");
    const input = document.querySelector('input[placeholder="4-digit PIN"]') as HTMLInputElement;
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("the completed row is inert and the undo button is the single affordance", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([{ ...CHORE, id: 95, title: "Done chore", completed: true, completedBy: "Caspian Garcia", completedAt: new Date().toISOString(), completedInWeek: MONDAY }]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await selectTile("Show Caspian Garcia's chores");
    await act(async () => { buttonByText("Show completed", el).click(); });
    await settle();

    // No `role="button"` row wrapping the control, and the control names its row.
    expect(el.querySelector('[role="button"][aria-label^="Undo completion"]')).toBeNull();
    const undo = document.querySelector('[aria-label="Undo completion of Done chore"]');
    expect(undo).not.toBeNull();
  });

  it("a keyboard parent gets a visible per-row Edit control (swipe was pointer-only)", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await selectTile("Show Caspian Garcia's chores");

    const edit = document.querySelector('[aria-label="Edit Water the plants"]');
    expect(edit).not.toBeNull();
    await act(async () => { (edit as HTMLElement).click(); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(text()).toContain("Edit Task");
  });

  it("every clipped task title carries a title attribute", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([{ ...CHORE, title: "A very long chore title that will certainly truncate on a phone" }]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await selectTile("Show Caspian Garcia's chores");
    // A row title clips in TWO ways and both hide text from the reader: the
    // single-line `truncate` (an ellipsis) and the two-line `line-clamp-2`
    // (a third line cut with no ellipsis at all). Either way the full string is
    // only reachable through `title`, so the contract covers both — the clamp
    // is the stricter case, since it gives the reader no visual cue that
    // anything was cut.
    const clipped = el.querySelectorAll(".truncate.text-sm, .line-clamp-2.text-sm");
    expect(clipped.length).toBeGreaterThan(0);
    for (const node of Array.from(clipped)) {
      expect(node.getAttribute("title"), `title for "${node.textContent}"`).toBeTruthy();
    }
  });

  it("the member filter is a named group and its tiles have distinct accessible names", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const group = el.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute("aria-label")).toBeTruthy();
  });

  it("an unset due date renders no double separator in the Pending meta line", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([{ ...CHORE, due: "" }]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent || "").not.toContain("·  ·");
  });

  it("the Open board and the repeat sheet both have honest empty states", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    // The Open card is present even with nothing claimable. U3 moved the glyph
    // out of the title into the card's icon seat, so the title is the word
    // alone and the glyph lives in the header's aria-hidden badge.
    expect(text()).toContain("Open");
    expect(text()).toContain("🫳");
    expect(text()).not.toContain("🫳 Open");
    expect(text()).toContain("Nothing up for grabs");
    expect(el).toBeTruthy();
  });

  it("a half-typed Add sheet is not discarded by Escape without a confirmation", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Add task");
    await settle();
    await setFieldByPlaceholder("Task title", "Half typed");

    // The sheet's own Cancel (three of them exist on the page; the dialog's is
    // the one inside the open sheet).
    await act(async () => { buttonByText("Cancel", document.querySelector('[role="dialog"]')!).click(); });
    await settle();
    // The sheet is still there, asking.
    expect(text()).toContain("Discard these changes?");

    await act(async () => { buttonByText("Discard", document).click(); });
    await settle();
    expect(text()).not.toContain("Discard these changes?");
  });

  it("the manual adjust refuses a non-positive amount and coerces a negative one", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    seed([], { points: { "Rebecca Mom": 50 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await clickByAriaLabel("Adjust points for Rebecca Mom");

    const amount = document.querySelector('[aria-label="Adjustment amount"]') as HTMLInputElement;
    expect(amount.getAttribute("min")).toBe("1");

    // Zero: the Apply control is disabled and nothing is queued.
    await setField("Adjustment amount", "0");
    await setField("Parent PIN", PARENT_PIN);
    expect((buttonByText("Apply") as HTMLButtonElement).disabled).toBe(true);
    await submitDialog("Apply");
    expect(requestsFor("/api/tasks/ledger")).toHaveLength(0);

    // A typed "-50" with "Remove points" selected must NOT become a credit.
    await setField("Adjustment amount", "-50");
    await act(async () => { buttonByText("Remove points").click(); });
    await submitDialog("Apply");
    const posted = requestsFor("/api/tasks/ledger");
    expect(posted).toHaveLength(1);
    expect(posted[0].body.amount).toBe(-50);
  });

  it("the adjust sheet clears a VERIFIED parent PIN on close", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom";
    seed([], { points: { "Rebecca Mom": 50 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await clickByAriaLabel("Adjust points for Rebecca Mom");
    await setField("Parent PIN", PARENT_PIN);
    await act(async () => { buttonByText("Cancel").click(); });
    await settle();

    // Reopening must NOT carry the previous PIN.
    await clickByAriaLabel("Adjust points for Rebecca Mom");
    const pin = document.querySelector('[aria-label="Parent PIN"]') as HTMLInputElement;
    expect(pin.value).toBe("");
  });

  it("a cancelled parent-approval dialog does not leak its verified PIN into the next redemption", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    server.verifyOkFor = "Rebecca Mom|Caspian Garcia";
    seed([], {
      rewards: [
        { id: 4, name: "Movie night", emoji: "🎬", cost: 150 },
        { id: 5, name: "Ice cream", emoji: "🍦", cost: 20 },
      ],
      points: { "Caspian Garcia": 500 },
    });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    // The >100pt reward opens the PARENT approval dialog.
    await clickByAriaLabel("Redeem Movie night");
    await setFieldByPlaceholder("Parent PIN", PARENT_PIN);
    await submitDialog("Approve");
    expect(text()).toContain("Redeem for");

    // Cancel the redemption dialog (the verified parent PIN is now in the refs).
    await act(async () => { buttonByText("Cancel").click(); });
    await settle();

    // A cheap redemption — a different reward entirely — must NOT ride the
    // earlier parent approval.
    server.requests = [];
    await clickByAriaLabel("Redeem Ice cream");
    await typePin("4-digit PIN", "3141");
    await submitDialog("Submit");

    const posted = requestsFor("/api/rewards/redeem");
    expect(posted).toHaveLength(1);
    expect(posted[0].body.parentName).toBeUndefined();
    expect(posted[0].body.parentPin).toBeUndefined();
  });

  it("the top-level board cards render h2, not an h3 straight under the page h1", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    // The page's own cards are h2s directly under the page h1. (A card's own
    // EmptyState h3 is a valid NEST, not a skip — the assertion is on the
    // direct children of the board panel.)
    const board = el.querySelector("#tasks-board-panel") as HTMLElement;
    expect(board).not.toBeNull();
    const headings = Array.from(board.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    expect(headings.length).toBeGreaterThan(0);
    // The card TITLES are the top level of this page, so they are h2s…
    // U3 moved the Open card's glyph into its icon seat, so the h2 text is the
    // title alone while the 🫳 stays in the card's header badge.
    const titles = Array.from(board.querySelectorAll("h2")).map((h) => (h.textContent || "").trim());
    expect(titles).toContain("Open");
    expect(titles).not.toContain("🫳 Open");
    expect(titles).toContain("Pending");
    // …and the page itself emits no h3/h4 of its own (every remaining h3 belongs
    // to a nested component such as a card's EmptyState, which is a valid nest).
    const ownHeadings = Array.from(
      (board as HTMLElement).querySelectorAll("h3, h4, h5, h6"),
    ).filter((h) => !h.closest("[data-card], .widget-card > div > div > h3"));
    // Nothing on the board renders a bare h3 straight under the page h1.
    expect(Array.from(board.querySelectorAll("h3")).every((h) => h.closest("p, [role], div") !== null)).toBe(true);
    expect(headings.length).toBeGreaterThan(1);
  });

  it("the two panels the view switch swaps are labelled regions", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    const board = el.querySelector("#tasks-board-panel");
    expect(board).not.toBeNull();
    expect(board!.getAttribute("role")).toBe("tabpanel");

    await toLeaderboard();
    const board2 = el.querySelector("#tasks-leaderboard-panel");
    expect(board2).not.toBeNull();
    expect(board2!.getAttribute("role")).toBe("tabpanel");
  });

  it("the 'change is saving' ink uses the AA ink token, not the raw accent", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CHORE]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Water the plants");

    // Both amber strings ("Saving" on the optimistic row and the banner's
    // sending line) must use the ink variant.
    const amberInk = el.querySelectorAll('[class*="--color-accent-ink-amber"]');
    expect(amberInk.length).toBeGreaterThan(0);
  });
});