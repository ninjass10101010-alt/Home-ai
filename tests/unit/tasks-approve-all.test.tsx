// @vitest-environment jsdom
// P3 parent efficiency: the Needs-approval queue gets an "Approve all" that
// costs ONE parent-PIN confirmation instead of a PIN per row, and the Add
// modal gets progressive disclosure (points stepper, recurring select).
import { describe, it, expect, vi, beforeEach } from "vitest";
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

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 7, emoji: "🌈", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
    ],
  },
}));

import TasksPage from "@/app/tasks/page";
import { todayMondayISO, todayISO } from "@/lib/task-utils";

const MONDAY = todayMondayISO();

function seedPendingTaps() {
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 101, title: "Quest A", assignee: "Caspian Garcia", assigneeEmoji: "🧒", due: todayISO(), points: 6, recurring: null, category: "Chores", completed: true, completedBy: "Caspian Garcia", completedAt: "2026-09-19T18:00:00.000Z", completedInWeek: MONDAY, priority: "low", pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 6 } },
    { id: 102, title: "Quest B", assignee: "Aurora Garcia", assigneeEmoji: "🌈", due: todayISO(), points: 8, recurring: null, category: "Chores", completed: true, completedBy: "Aurora Garcia", completedAt: "2026-09-19T18:30:00.000Z", completedInWeek: MONDAY, priority: "low", pendingApproval: { byName: "Aurora Garcia", at: "2026-09-19T18:30:00.000Z", points: 8 } },
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
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}
function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const approveCalls: any[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  activeRoot?.unmount?.();
  activeRoot = null;
  approveCalls.length = 0;
  // verifyPinRemote answers ok for the parent, wrongPin for the kids.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      const body = JSON.parse(String(init?.body || "{}"));
      const ok = body.memberName === "Rebecca (Mom)" && body.pin === "0202";
      return {
        ok,
        status: ok ? 200 : 401,
        json: async () => (ok ? { member: { name: "Rebecca (Mom)", role: "parent", emoji: "👩" } } : { error: "Invalid PIN" }),
      } as any;
    }
    if (url.includes("/api/tasks/approve")) {
      approveCalls.push(JSON.parse(String(init?.body || "{}")));
      const body = JSON.parse(String(init?.body || "{}"));
      const n = Array.isArray(body.taskIds) ? body.taskIds.length : 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          paid: n,
          cleared: n,
          skipped: 0,
          weekData: {
            weekStart: MONDAY,
            points: { "Caspian Garcia": 6, "Aurora Garcia": 8 },
            streak: {},
            lastActive: {},
            history: [
              { id: 1, timestamp: new Date().toISOString(), member: "Caspian Garcia", type: "earn", amount: 6, description: "Completed: Quest A (+6pts)", taskId: 101 },
              { id: 2, timestamp: new Date().toISOString(), member: "Aurora Garcia", type: "earn", amount: 8, description: "Completed: Quest B (+8pts)", taskId: 102 },
            ],
          },
        }),
      } as any;
    }
    return { ok: false, status: 401, json: async () => ({}) } as any;
  }));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
});

describe("Needs-approval — Approve all (one parent PIN)", () => {
  it("pays EVERY pending row with a single parent-PIN confirm", async () => {
    seedPendingTaps();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const approveAll = [...el.querySelectorAll("button")].find((b) => /Approve all/i.test(b.textContent || ""));
    expect(approveAll).toBeTruthy();
    await act(async () => { approveAll!.click(); });
    await settle();

    // One PIN modal for the whole queue.
    const pinInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    expect(pinInput).not.toBeNull();
    await act(async () => { setInput(pinInput, "0202"); });
    const dlg = document.querySelector('[role="dialog"]');
    const confirm = [...dlg!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Approve all");
    await act(async () => { confirm!.click(); });
    await settle();

    const week = storedWeek();
    expect(week.points["Caspian Garcia"]).toBe(6);
    expect(week.points["Aurora Garcia"]).toBe(8);
    expect(week.history.filter((t: any) => t.type === "earn")).toHaveLength(2);
    // The queue is gone — every row cleared its pendingApproval.
    const tasks = JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
    expect(tasks.every((t: any) => !t.pendingApproval)).toBe(true);
    expect(el.textContent).not.toContain("Needs approval");

    // Task 8: exactly one POST, carrying every visible pending id + credentials.
    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0].action).toBe("approve-all");
    expect([...approveCalls[0].taskIds].sort((a, b) => a - b)).toEqual([101, 102]);
    expect(approveCalls[0].memberName).toBe("Rebecca (Mom)");
    expect(approveCalls[0].pin).toBe("0202");
  });

  it("a wrong parent PIN approves NOTHING", async () => {
    seedPendingTaps();
    const el = await renderAsync(<TasksPage />);
    await settle();
    const approveAll = [...el.querySelectorAll("button")].find((b) => /Approve all/i.test(b.textContent || ""));
    await act(async () => { approveAll!.click(); });
    await settle();
    const pinInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    await act(async () => { setInput(pinInput, "9999"); });
    const confirm = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Approve all");
    await act(async () => { confirm!.click(); });
    await settle();

    const week = storedWeek();
    expect(week.history).toHaveLength(0);
    expect(week.points["Caspian Garcia"]).toBeUndefined();
    expect(el.textContent).toContain("Needs approval");
    // Task 8: a wrong PIN never reaches the server.
    expect(approveCalls).toHaveLength(0);
  });
});

describe("Add modal — progressive disclosure", () => {
  it("Points uses a stepper (+/-), not a bare number input", async () => {
    localStorage.setItem("consuela-tasks", JSON.stringify([]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const addBtn = el.querySelector('button[aria-label="Add task"]') as HTMLButtonElement;
    await act(async () => { addBtn.click(); });
    await settle();

    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg).not.toBeNull();
    const minus = [...dlg!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Decrease Points");
    const plus = [...dlg!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Increase Points");
    expect(minus).toBeTruthy();
    expect(plus).toBeTruthy();
    // The old raw number input is gone.
    const numberInputs = [...dlg!.querySelectorAll('input[type="number"]')];
    expect(numberInputs.filter((i) => i.closest("label")?.textContent?.includes("Points"))).toHaveLength(0);
  });

  it("Recurring is a select (None/Daily/Weekdays/Weekly), not free text", async () => {
    localStorage.setItem("consuela-tasks", JSON.stringify([]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const addBtn = el.querySelector('button[aria-label="Add task"]') as HTMLButtonElement;
    await act(async () => { addBtn.click(); });
    await settle();

    const dlg = document.querySelector('[role="dialog"]');
    const selects = [...dlg!.querySelectorAll("select")];
    const recurring = selects.find((s) => (s.textContent || "").includes("Daily"));
    expect(recurring).toBeTruthy();
    const optionTexts = [...recurring!.querySelectorAll("option")].map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(["None", "Daily", "Weekdays", "Weekly"]));
  });
});
