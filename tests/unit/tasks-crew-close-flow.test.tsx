// @vitest-environment jsdom
// Task 5 — the parent-facing crew-close UI: the Add/Edit "Close when" control,
// the Crew card mode chips + "Close with check-ins (N of M)" button, the
// crew→solo payload hygiene (a stale crewCloseMode must never ride an
// assigned-task patch), and the approval ack's eligibility copy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { localWeekStartISO } from "@/lib/local-date";
import { todayISO } from "@/lib/task-utils";
import {
  __resetTaskOutboxForTests,
  listTaskOutbox,
} from "@/lib/task-operation-outbox";
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

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Bailey", fullName: "Bailey Garcia", role: "child", age: 12, emoji: "👧", color: "mint" },
      { id: 4, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 8, emoji: "🌈", color: "amber" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Bailey", fullName: "Bailey Garcia", role: "child", age: 12, emoji: "👧", color: "mint" },
      { id: 4, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 8, emoji: "🌈", color: "amber" },
    ],
  },
}));

const MONDAY = localWeekStartISO();
const PARENT = { name: "Rebecca (Mom)", role: "parent" };

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

const CLAIM_CALLS: any[] = [];
const MANAGE_CALLS: any[] = [];
const APPROVE_CALLS: any[] = [];
// `approveSkipped` drives the ack body the page must turn into eligibility
// copy; claim + manage answer 503 so the queued entry stays observable.
function stubFetch(approveBody?: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member: PARENT }) };
    }
    if (url.includes("/api/tasks/claim")) {
      CLAIM_CALLS.push(body);
      return { ok: false, status: 503, json: async () => ({ error: "unavailable" }) };
    }
    if (url.includes("/api/tasks/manage")) {
      MANAGE_CALLS.push(body);
      return { ok: false, status: 503, json: async () => ({ error: "unavailable" }) };
    }
    if (url.includes("/api/tasks/approve")) {
      APPROVE_CALLS.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          operationId: body?.operationId,
          action: body?.action,
          paid: 1,
          cleared: 0,
          weekData: {
            weekStart: MONDAY,
            points: { "Caspian Garcia": 15 },
            streak: {},
            lastActive: {},
            history: [
              { id: 1, timestamp: new Date().toISOString(), member: "Caspian Garcia", type: "earn", amount: 15, description: "Completed: Van wash (+15pts)", taskId: 70 },
            ],
          },
          ...approveBody,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
  }));
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}
async function settle(ms = 100) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); }

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function scope(): HTMLElement {
  return (document.querySelector('[role="dialog"]') as HTMLElement) ?? document.body;
}
function buttonByText(text: string, exact = false): HTMLButtonElement | undefined {
  return Array.from(scope().querySelectorAll("button")).find((b) =>
    exact ? (b.textContent || "").trim() === text : (b.textContent || "").includes(text),
  ) as HTMLButtonElement | undefined;
}
async function clickButton(text: string, exact = false) {
  const button = buttonByText(text, exact);
  expect(button, `button "${text}"`).toBeTruthy();
  await act(async () => { button!.click(); });
  await settle();
}
async function clickAria(label: string) {
  const node = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(node, `[aria-label="${label}"]`).toBeTruthy();
  await act(async () => { node.click(); });
  await settle();
}
async function setParentPin(pin = "1234") {
  const input = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInput(input, pin); });
}
function radio(groupLabel: string, label: string): HTMLElement {
  const group = document.querySelector(`[role="radiogroup"][aria-label="${groupLabel}"]`);
  expect(group, `radiogroup "${groupLabel}"`).not.toBeNull();
  const found = Array.from(group!.querySelectorAll('[role="radio"]')).find((r) =>
    (r.textContent || "").trim().includes(label),
  ) as HTMLElement | undefined;
  expect(found, `radio "${label}"`).toBeTruthy();
  return found!;
}
async function clickRadio(groupLabel: string, label: string) {
  const node = radio(groupLabel, label);
  await act(async () => { node.click(); });
  await settle();
}
function crewCard(title: string): HTMLElement {
  const cards = Array.from(document.querySelectorAll("div")).filter(
    (d) => typeof d.className === "string" && d.className.includes("glass-subtle") && (d.textContent || "").includes(title),
  );
  expect(cards.length, `crew card for "${title}"`).toBeGreaterThan(0);
  return cards[cards.length - 1] as HTMLElement;
}

function member(name: string, checkedIn: boolean) {
  return { name, emoji: "🧒", joinedAt: "2026-09-29T10:00:00.000Z", ...(checkedIn ? { checkedInAt: "2026-09-29T11:00:00.000Z" } : {}) };
}

let root: Root | null = null;
afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
  document.body.innerHTML = "";
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  CLAIM_CALLS.length = 0;
  MANAGE_CALLS.length = 0;
  APPROVE_CALLS.length = 0;
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
});

function asParent() {
  mockAuth.currentUser = PARENT;
  mockAuth.isLoggedIn = true;
}

describe("crew-close — the parent close button queues the claim command", () => {
  it("parent sees 'Close with check-ins (2 of 4)' and tapping it queues crew-close after the PIN", async () => {
    asParent();
    seed([{
      id: 42, title: "Wash the van", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
      points: 15, recurring: null, category: "Chores", completed: false, priority: "medium",
      crewSize: 4, crewCloseMode: "parent",
      crew: { members: [member("Caspian Garcia", true), member("Aurora Garcia", true), member("Bailey Garcia", false), member("Rebecca (Mom)", false)] },
    }]);
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const closeBtn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Close with check-ins (2 of 4)"));
    expect(closeBtn, "close-with-check-ins button").toBeTruthy();
    await act(async () => { closeBtn!.click(); });
    await settle();

    await setParentPin("1234");
    await clickButton("Close crew", true);
    await settle(120);

    expect(CLAIM_CALLS).toHaveLength(1);
    expect(CLAIM_CALLS[0]).toMatchObject({ action: "crew-close", taskId: 42 });

    const [entry] = listTaskOutbox();
    expect(entry, "queued crew-close entry").toBeTruthy();
    expect(entry!.displayTarget).toMatchObject({ title: "Wash the van" });
    expect(entry!.action).toBe("crew-close");
  });
});

describe("crew-close — the Add sheet's Close when control", () => {
  it("offers Everyone / Parent closes / At due date, defaulting to Everyone, and queues deadline", async () => {
    asParent();
    seed([]);
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();

    await clickAria("Add task");
    const title = document.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    expect(title).not.toBeNull();
    await act(async () => { setInput(title, "Wash the van"); });

    await clickRadio("Task type", "Crew");

    const closeWhen = document.querySelector('[role="radiogroup"][aria-label="Close when"]');
    expect(closeWhen, "Close when control").not.toBeNull();
    const options = Array.from(closeWhen!.querySelectorAll('[role="radio"]'));
    expect(options.map((o) => (o.textContent || "").trim())).toEqual(["Everyone", "Parent closes", "At due date"]);
    expect(options[0].getAttribute("aria-checked")).toBe("true");

    await clickRadio("Close when", "At due date");
    await clickButton("Save", true);
    await settle(120);

    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/manage", action: "add" });
    expect((listTaskOutbox()[0]!.payload as any).task.crewCloseMode).toBe("deadline");
    expect(MANAGE_CALLS[0]?.task?.crewCloseMode).toBe("deadline");
  });
});

describe("crew-close — mode chips on the Crew card", () => {
  it("shows the deadline chip on a deadline crew and neither chip nor button on a strict crew", async () => {
    asParent();
    seed([
      {
        id: 60, title: "Deck sweep", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
        points: 10, recurring: null, category: "Chores", completed: false, priority: "low",
        crewSize: 3, crewCloseMode: "deadline",
        crew: { members: [member("Caspian Garcia", true), member("Aurora Garcia", false), member("Bailey Garcia", false)] },
      },
      {
        id: 61, title: "Gutter clear", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
        points: 12, recurring: null, category: "Chores", completed: false, priority: "low",
        crewSize: 2, crewCloseMode: "strict",
        crew: { members: [member("Caspian Garcia", true), member("Aurora Garcia", true)] },
      },
    ]);
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();

    expect(el.textContent || "").toContain("Deck sweep");
    expect(el.textContent || "").toContain("Gutter clear");

    const deadlineCard = crewCard("Deck sweep");
    expect(deadlineCard.textContent).toContain("Auto-closes at the due date");

    const strictCard = crewCard("Gutter clear");
    expect(strictCard.textContent).not.toContain("Auto-closes at the due date");
    expect(strictCard.textContent).not.toContain("Parent closes");
    expect([...strictCard.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Close with check-ins"))).toBe(false);

    // Neither seeded crew is parent-mode, so no close affordance exists yet.
    expect(el.textContent || "").not.toContain("Close with check-ins");
  });
});

describe("crew-close — switching a crew to Assigned never leaks crewCloseMode", () => {
  it("queues the manage update with crewCloseMode: null", async () => {
    asParent();
    seed([{
      id: 45, title: "Wipe counters", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
      points: 8, recurring: null, category: "Chores", completed: false, priority: "medium",
      // crewSize 3 with 2 joined keeps the crew not-full, so the row is on the
      // parent's "My Tasks" board (a full crew is not claimable there).
      crewSize: 3, crewCloseMode: "parent",
      crew: { members: [member("Caspian Garcia", true), member("Aurora Garcia", true)] },
    }]);
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Wipe counters"]') as HTMLElement;
    expect(row, "pending crew row").toBeTruthy();
    const opts = (x: number) => ({ bubbles: true, pointerId: 1, clientX: x });
    await act(async () => {
      const event = window.PointerEvent || window.Event;
      row.dispatchEvent(new event("pointerdown", opts(300) as never));
      row.dispatchEvent(new event("pointermove", opts(180) as never));
      row.dispatchEvent(new event("pointerup", opts(160) as never));
    });
    await settle();

    expect(document.querySelector('input[placeholder="Task title"]'), "edit modal").not.toBeNull();
    await clickRadio("Task type", "Assigned");
    await clickButton("Save", true);
    await settle(120);

    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/manage", action: "update" });
    expect((listTaskOutbox()[0]!.payload as any).patch.crewCloseMode).toBeNull();
    expect(MANAGE_CALLS[0]?.patch?.crewCloseMode ?? null).toBeNull();
  });
});

describe("crew-close — approval ack says who was not eligible", () => {
  it("toasts 'N not eligible' when the server acknowledges a skipped payee", async () => {
    asParent();
    seed([{
      id: 70, title: "Van wash", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
      points: 15, recurring: null, category: "Chores", completed: true, completedBy: "Caspian Garcia",
      completedAt: "2026-09-29T11:00:00.000Z", completedInWeek: MONDAY, priority: "medium",
      crewSize: 4, crewCloseMode: "parent",
      crew: { members: [member("Caspian Garcia", true), member("Aurora Garcia", true), member("Bailey Garcia", false), member("Rebecca (Mom)", false)] },
      pendingApproval: { byName: "Crew", at: "2026-09-29T11:00:00.000Z", points: 15, crew: ["Caspian Garcia", "Aurora Garcia"] },
    }]);
    stubFetch({ skipped: 1 });
    const el = await renderAsync(<TasksPage />);
    await settle();

    await clickAria("Approve Van wash");
    await setParentPin("1234");
    await clickButton("Approve", true);
    await settle(200);

    expect(APPROVE_CALLS).toHaveLength(1);
    const text = el.textContent || document.body.textContent || "";
    expect(text).toContain("1 not eligible");
    expect(text).not.toContain("skipped 1");
  });

  it("adds no eligibility toast when the ack carries no skipped count", async () => {
    asParent();
    seed([{
      id: 71, title: "Van wax", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
      points: 15, recurring: null, category: "Chores", completed: true, completedBy: "Caspian Garcia",
      completedAt: "2026-09-29T11:00:00.000Z", completedInWeek: MONDAY, priority: "medium",
      crewSize: 4, crewCloseMode: "parent",
      crew: { members: [member("Caspian Garcia", true), member("Aurora Garcia", true), member("Bailey Garcia", false), member("Rebecca (Mom)", false)] },
      pendingApproval: { byName: "Crew", at: "2026-09-29T11:00:00.000Z", points: 15, crew: ["Caspian Garcia", "Aurora Garcia"] },
    }]);
    stubFetch({ skipped: undefined, paid: 2 });
    const el = await renderAsync(<TasksPage />);
    await settle();

    await clickAria("Approve Van wax");
    await setParentPin("1234");
    await clickButton("Approve", true);
    await settle(200);

    expect(APPROVE_CALLS).toHaveLength(1);
    const text = el.textContent || document.body.textContent || "";
    expect(text).not.toContain("not eligible");
  });
});
