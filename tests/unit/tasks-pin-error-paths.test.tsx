// @vitest-environment jsdom
// Fix-A lane follow-up — Tasks page PIN gates. The page-local verifyPinRemote
// collapsed 401 (wrong PIN) / 5xx / network-rejection into null, so all seven
// gates told a parent on a flaky network or an asleep NAS they "typed it
// wrong". The gates now consume the shared kid-store discriminated helper
// (ok | wrongPin | unreachable): a wrong PIN keeps the existing copy, an
// unreachable server says "Couldn't reach Consuela — check the connection and
// try again." honestly, and the PIN input clears on BOTH paths (KidHome's
// fixed behavior). Red-proof: every unreachable case asserts the old
// blame-the-parent copy is GONE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, todayISO, weekKey } from "@/lib/task-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// The db module is heavy (module-level PB hydrate) — mock the roster surface.
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
  },
}));

import TasksPage from "@/app/tasks/page";

const MONDAY = todayMondayISO();

const PENDING = { id: 42, title: "Feed the dog", assignee: "Jasmine", assigneeEmoji: "👧", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "medium" };
const UNIVERSAL = { id: 43, title: "Grab the mail", assignee: "All", assigneeEmoji: "🤝", due: todayISO(), points: 12, recurring: null, category: "Chores", completed: false, priority: "medium", universal: true };
const DONE = { id: 44, title: "Sweep the kitchen", assignee: "Jasmine", assigneeEmoji: "👧", due: todayISO(), points: 8, recurring: null, category: "Chores", completed: true, completedBy: "Jasmine", completedAt: new Date().toISOString(), completedInWeek: weekKey(), priority: "medium" };
const SMALL_REWARD = { id: 11, name: "Ice cream trip", emoji: "🍦", cost: 40 };
const BIG_REWARD = { id: 12, name: "Movie night", emoji: "🎬", cost: 150 };
const PENALTY = { id: 21, name: "Forgot homework", emoji: "⚠️", points: 10 };

function seed(opts: { tasks?: any[]; points?: Record<string, number>; rewards?: any[]; penalties?: any[] } = {}) {
  localStorage.setItem("consuela-tasks", JSON.stringify(opts.tasks ?? []));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: opts.points ?? {}, streak: {}, lastActive: {}, history: [] }));
  localStorage.setItem("consuela-rewards", JSON.stringify(opts.rewards ?? []));
  localStorage.setItem("consuela-penalties", JSON.stringify(opts.penalties ?? []));
}

// verify: responder for POST /api/members/verify; every other call (snapshot
// restore etc.) answers benignly so the page mounts normally.
function stubFetch(verify: () => any) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/members/verify")) return verify();
    return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
  }));
}
const NETWORK_DOWN = () => { throw new TypeError("Failed to fetch"); };
const http = (status: number) => () => ({ ok: false, status, json: async () => ({}) });

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

async function settle(ms = 80) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

function pinInput(placeholder: string): HTMLInputElement {
  return document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
}

async function clickByAriaLabel(label: string) {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(el).not.toBeNull();
  await act(async () => { el.click(); });
  await settle();
}

async function typeAndSubmit(placeholder: string, buttonText: string, pin = "1234") {
  const input = pinInput(placeholder);
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText(buttonText)!.click(); });
  await settle();
}

async function toLeaderboard() {
  await act(async () => { buttonByText("Leaderboard")!.click(); });
  await settle();
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}
function storedHistory(): any[] {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}").history ?? [];
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

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  vi.unstubAllGlobals();
});

describe("Tasks gate: complete (assigned task)", () => {
  it("network rejection says 'Couldn't reach Consuela', never 'Wrong PIN', and clears the PIN", async () => {
    seed({ tasks: [PENDING] });
    stubFetch(NETWORK_DOWN);
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Feed the dog");
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    expect(pinInput("4-digit PIN").value).toBe("");
    expect(storedTasks().find((t) => t.id === 42).completed).toBe(false);
  });

  it("a server 5xx is unreachable too — not a mistyped PIN", async () => {
    seed({ tasks: [PENDING] });
    stubFetch(http(500));
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Feed the dog");
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    expect(pinInput("4-digit PIN").value).toBe("");
  });

  it("a genuine wrong PIN (401) still reads 'Wrong PIN. Try again.' and clears the PIN", async () => {
    seed({ tasks: [PENDING] });
    stubFetch(http(401));
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Feed the dog");
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Wrong PIN. Try again.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("4-digit PIN").value).toBe("");
  });

  it("an OFFLINE network failure gets the offline copy (navigator.onLine false)", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    seed({ tasks: [PENDING] });
    stubFetch(NETWORK_DOWN);
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Feed the dog");
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("You're offline");
    expect(text).not.toContain("Wrong PIN");
  });
});

describe("Tasks gate: undo completion", () => {
  async function openUndo() {
    await renderAsync(<TasksPage />);
    await settle();
    await act(async () => { buttonByText("Show completed")!.click(); });
    await settle();
    await clickByAriaLabel("Undo completion of Sweep the kitchen");
  }

  it("network rejection says 'Couldn't reach Consuela', never 'Wrong PIN', and clears the PIN", async () => {
    seed({ tasks: [DONE] });
    stubFetch(NETWORK_DOWN);
    await openUndo();
    await typeAndSubmit("4-digit PIN", "Undo");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    expect(pinInput("4-digit PIN").value).toBe("");
    expect(storedTasks().find((t) => t.id === 44).completed).toBe(true);
  });

  it("a wrong PIN (401) still reads 'Wrong PIN. Try again.' and clears the PIN", async () => {
    seed({ tasks: [DONE] });
    stubFetch(http(401));
    await openUndo();
    await typeAndSubmit("4-digit PIN", "Undo");

    const text = document.body.textContent || "";
    expect(text).toContain("Wrong PIN. Try again.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("4-digit PIN").value).toBe("");
  });
});

describe("Tasks gate: universal claim", () => {
  it("network rejection says 'Couldn't reach Consuela', never 'Wrong code'", async () => {
    seed({ tasks: [UNIVERSAL] });
    stubFetch(NETWORK_DOWN);
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Grab the mail");
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong code");
    expect(pinInput("4-digit PIN").value).toBe("");
    expect(storedTasks().find((t) => t.id === 43).completed).toBe(false);
  });

  it("a wrong PIN (401) still reads 'Wrong code for selected member. Try again.'", async () => {
    seed({ tasks: [UNIVERSAL] });
    stubFetch(http(401));
    await renderAsync(<TasksPage />);
    await settle();
    await clickByAriaLabel("Complete Grab the mail");
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Wrong code for selected member. Try again.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("4-digit PIN").value).toBe("");
  });
});

describe("Tasks gate: reward redemption", () => {
  it("network rejection says 'Couldn't reach Consuela', never 'Wrong code', and books nothing", async () => {
    stubFetch(NETWORK_DOWN);
    seed({ rewards: [SMALL_REWARD], points: { "Rebecca (Mom)": 200 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong code");
    expect(pinInput("4-digit PIN").value).toBe("");
    expect(storedHistory()).toHaveLength(0);
  });

  it("a wrong PIN (401) still reads 'Wrong code for selected member. Try again.'", async () => {
    stubFetch(http(401));
    seed({ rewards: [SMALL_REWARD], points: { "Rebecca (Mom)": 200 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();
    await typeAndSubmit("4-digit PIN", "Submit");

    const text = document.body.textContent || "";
    expect(text).toContain("Wrong code for selected member. Try again.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("4-digit PIN").value).toBe("");
  });
});

describe("Tasks gate: penalty", () => {
  async function openPenalty() {
    seed({ penalties: [PENALTY] });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await clickByAriaLabel("Apply penalty");
  }

  it("network rejection says 'Couldn't reach Consuela', never 'Wrong PIN', and books nothing", async () => {
    stubFetch(NETWORK_DOWN);
    await openPenalty();
    await typeAndSubmit("4-digit PIN", "Deduct");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Wrong PIN");
    expect(pinInput("4-digit PIN").value).toBe("");
    expect(storedHistory()).toHaveLength(0);
  });

  it("a wrong PIN (401 for member AND every parent) still reads 'Wrong PIN. Try again.'", async () => {
    stubFetch(http(401));
    await openPenalty();
    await typeAndSubmit("4-digit PIN", "Deduct");

    const text = document.body.textContent || "";
    expect(text).toContain("Wrong PIN. Try again.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("4-digit PIN").value).toBe("");
  });
});

describe("Tasks gate: manual point adjust (parent loop)", () => {
  async function openAdjust() {
    mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    seed({ points: { "Rebecca (Mom)": 50, "Jasmine": 20 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    // Top-3 entries render inside the Podium (its adjust control carries the
    // per-entry label; LeaderboardRow's plain "Adjust points" is rank 4+).
    await clickByAriaLabel("Adjust points for Rebecca (Mom)");
  }

  it("network rejection says 'Couldn't reach Consuela', never 'Parent PIN required'", async () => {
    stubFetch(NETWORK_DOWN);
    await openAdjust();
    await typeAndSubmit("0000", "Apply");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Parent PIN required");
    expect(pinInput("0000").value).toBe("");
    expect(storedHistory()).toHaveLength(0);
  });

  it("a wrong PIN (401 for every parent) still reads 'Parent PIN required. Try again.'", async () => {
    stubFetch(http(401));
    await openAdjust();
    await typeAndSubmit("0000", "Apply");

    const text = document.body.textContent || "";
    expect(text).toContain("Parent PIN required. Try again.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("0000").value).toBe("");
  });
});

describe("Tasks gate: parent approval of large rewards", () => {
  async function openApproval() {
    seed({ rewards: [BIG_REWARD], points: { "Rebecca (Mom)": 200 } });
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();
    expect(document.body.textContent || "").toContain("Parent Approval Required");
  }

  it("network rejection says 'Couldn't reach Consuela', never 'Parent PIN required'", async () => {
    stubFetch(NETWORK_DOWN);
    await openApproval();
    await typeAndSubmit("Parent PIN", "Approve");

    const text = document.body.textContent || "";
    expect(text).toContain("Couldn't reach Consuela");
    expect(text).not.toContain("Parent PIN required");
    expect(pinInput("Parent PIN").value).toBe("");
  });

  it("a wrong parent PIN (401 for every parent) still reads 'Parent PIN required to approve large rewards.'", async () => {
    stubFetch(http(401));
    await openApproval();
    await typeAndSubmit("Parent PIN", "Approve");

    const text = document.body.textContent || "";
    expect(text).toContain("Parent PIN required to approve large rewards.");
    expect(text).not.toContain("Couldn't reach");
    expect(pinInput("Parent PIN").value).toBe("");
  });
});
