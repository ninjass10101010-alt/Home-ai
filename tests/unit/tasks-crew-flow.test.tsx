// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, todayISO } from "@/lib/task-utils";
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
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Bailey", fullName: "Bailey Garcia", role: "child", age: 12, emoji: "👧", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Bailey", fullName: "Bailey Garcia", role: "child", age: 12, emoji: "👧", color: "mint" },
    ],
  },
}));

const MONDAY = todayMondayISO();

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

const CLAIM_CALLS: any[] = [];
function stubVerify(member: any) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) return { ok: true, status: 200, json: async () => ({ member }) };
    if (url.includes("/api/tasks/claim")) {
      try { CLAIM_CALLS.push(JSON.parse(String(init?.body || "{}"))); } catch {}
      return { ok: true, status: 200, json: async () => ({ success: true }) };
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string, exact = false): HTMLButtonElement | undefined {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  return Array.from(scope.querySelectorAll("button")).find((b) =>
    exact ? (b.textContent || "").trim() === text : (b.textContent || "").includes(text)
  ) as HTMLButtonElement | undefined;
}

async function submitPin(pin = "1234") {
  const input = document.querySelector('input[placeholder="4-digit PIN"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText("Submit")!.click(); });
  await settle();
}

function storedTasks(): any[] { return JSON.parse(localStorage.getItem("consuela-tasks") || "[]"); }

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  CLAIM_CALLS.length = 0;
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
});

const CREW = {
  id: 40, title: "Wash the van", assignee: "Crew", assigneeEmoji: "🤝", due: todayISO(),
  points: 15, recurring: null, category: "Chores", completed: false, priority: "medium",
  crewSize: 2, crew: { members: [] },
};

describe("Crew tasks — open board + join/check-in", () => {
  it("an open crew task appears on the Open board with a Join crew button", async () => {
    mockAuth.currentUser = { name: "Caspian Garcia", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CREW]);
    stubVerify({ name: "Caspian Garcia", fullName: "Caspian Garcia", role: "child", emoji: "🧒" });
    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("Wash the van");
    expect(text).toContain("Crew 0/2 joined");
    expect(text).toContain("Join crew");
  });

  it("joining a crew sends the crew-join action with the member's PIN", async () => {
    mockAuth.currentUser = { name: "Caspian Garcia", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([CREW]);
    stubVerify({ name: "Caspian Garcia", fullName: "Caspian Garcia", role: "child", emoji: "🧒" });
    const el = await renderAsync(<TasksPage />);
    await settle();

    const joinBtn = [...el.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").includes("Join crew for"));
    expect(joinBtn).toBeTruthy();
    await act(async () => { (joinBtn as HTMLElement).click(); });
    await settle();
    expect(document.body.textContent).toContain("Join the crew");
    await submitPin();

    expect(CLAIM_CALLS.length).toBe(1);
    expect(CLAIM_CALLS[0]).toMatchObject({ action: "crew-join", taskId: 40, memberName: "Caspian Garcia" });
    await settle(1800);
  });

  it("a member already on the crew sees Check in instead of Join", async () => {
    mockAuth.currentUser = { name: "Bailey Garcia", role: "child", age: 12 };
    mockAuth.isLoggedIn = true;
    seed([{ ...CREW, crew: { members: [{ name: "Bailey Garcia", emoji: "👧", joinedAt: "t" }] } }]);
    stubVerify({ name: "Bailey Garcia", fullName: "Bailey Garcia", role: "child", emoji: "👧" });
    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    // A joined member is no longer on the Open board; the task lives in Pending
    // with crew progress and opens the check-in PIN step.
    expect(text).toContain("Crew 0/2 checked in");
    const row = [...el.querySelectorAll("[role='button']")].find((b) => (b.getAttribute("aria-label") || "").includes("Wash the van"));
    expect(row).toBeTruthy();
    await act(async () => { (row as HTMLElement).click(); });
    await settle();
    expect(document.body.textContent).toContain("Check in");
    await submitPin();
    expect(CLAIM_CALLS[0]).toMatchObject({ action: "crew-checkin", taskId: 40, memberName: "Bailey Garcia" });
    await settle(1800);
  });
});

describe("Crew tasks — open claim speed bonus", () => {
  it("an open task's claim sends action:claim (server adds the bonus)", async () => {
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([{ id: 50, title: "Clean the garage", assignee: "Open", assigneeEmoji: "🤝", due: todayISO(), points: 10, recurring: null, category: "Chores", completed: false, priority: "low", universal: true, speedBonus: 3 }]);
    stubVerify({ name: "Rebecca (Mom)", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩" });

    const el = await renderAsync(<TasksPage />);
    await settle();
    const claimBtn = [...el.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").includes("Claim Clean the garage"));
    expect(claimBtn).toBeTruthy();
    await act(async () => { (claimBtn as HTMLElement).click(); });
    await settle();
    await submitPin();

    expect(CLAIM_CALLS.length).toBe(1);
    expect(CLAIM_CALLS[0]).toMatchObject({ action: "claim", taskId: 50 });
    await settle(1800);
  });
});
