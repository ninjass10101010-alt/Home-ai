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
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
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
      { id: 3, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 10, emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Jasmine", fullName: "Jasmine Rose", role: "child", age: 10, emoji: "👧", color: "rose" },
    ],
  },
}));

const MONDAY = todayMondayISO();
const VACUUM = { id: 30, title: "Vacuum the living room", assignee: "All", assigneeEmoji: "🤝", due: todayISO(), points: 6, recurring: null, category: "Chores", completed: false, priority: "low", universal: true };

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

// PIN-verify answers with the given member; /api/tasks/claim answers with
// `claimResponse` (default: the kid branch's {success, pending} shape — no
// weekData). Claim request bodies are captured for assertions.
const claimCalls: any[] = [];
function stubFetches(member: any, claimResponse: any) {
  claimCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member }) };
    }
    if (url.includes("/api/tasks/claim")) {
      try { claimCalls.push(JSON.parse(String(init?.body || "{}"))); } catch {}
      return { ok: true, status: 200, json: async () => claimResponse };
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

async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}

function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

async function claimViaPinModal(pin = "1234") {
  const input = document.querySelector('input[placeholder="4-digit PIN"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText("Submit")!.click(); });
  await settle();
}

async function tapUniversalRow(el: HTMLElement) {
  const row = el.querySelector('[aria-label="Complete Vacuum the living room"]') as HTMLElement;
  expect(row).not.toBeNull();
  await act(async () => { row.click(); });
  await settle();
  // Claims are always PIN-gated and default the "Claim for" select to the
  // signed-in member (pickDefaultClaimMember).
  expect(document.body.textContent).toContain("Claim for");
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

describe("server-authoritative claims → pending for kid claimants (client mirror)", () => {
  it("kid claimant success: optimistic row goes PENDING, no earn tx in weekData", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([VACUUM]);
    stubFetches(
      { name: "Caspian Garcia", fullName: "Caspian Garcia", role: "child", emoji: "🧒" },
      { success: true, pending: true, claimedBy: "Caspian Garcia" }
    );
    const el = await renderAsync(<TasksPage />);
    await settle();
    await tapUniversalRow(el);
    await claimViaPinModal();

    expect(claimCalls.length).toBe(1); // the server route is still the authority
    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].assignee).toBe("Caspian Garcia");
    expect(saved[0].pendingApproval).toEqual({ byName: "Caspian Garcia", at: expect.any(String), points: 6 });
    // Zero points moved: no earn tx, no ledger bump.
    expect(storedWeek().history).toHaveLength(0);
    expect(storedWeek().points["Caspian Garcia"]).toBeUndefined();
    // Honest pending copy, never the instant-earn copy.
    expect(document.body.textContent || "").toContain("on the way");
    await settle(1800);
  });

  it("adult claimant: byte-identical instant earn, no pending record (regression)", async () => {
    mockAuth.currentUser = { name: "Rebecca", role: "parent" };
    mockAuth.isLoggedIn = true;
    seed([VACUUM]);
    stubFetches(
      { name: "Rebecca (Mom)", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩" },
      { success: true, claimedBy: "Rebecca (Mom)" }
    );
    const el = await renderAsync(<TasksPage />);
    await settle();
    await tapUniversalRow(el);
    await claimViaPinModal();

    expect(claimCalls.length).toBe(1);
    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toBeUndefined();
    const history = storedWeek().history;
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("earn");
    expect(history[0].member).toBe("Rebecca (Mom)");
    expect(storedWeek().points["Rebecca (Mom)"]).toBe(6);
    await settle(1800);
  });
});
