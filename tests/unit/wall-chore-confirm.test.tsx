// @vitest-environment jsdom
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act pattern (see wall-chrome.test.tsx and
// tasks-pin-free-flow.test.tsx, whose page harness block is copied verbatim
// below). The wall 2-step chore-confirm contract is encoded at two levels:
//   1. useWallConfirm (the extracted row-tap seam): proceed-spy unit tests.
//      `proceed` IS the row's original onClick body — the page passes
//      `() => openPinEntry(task.id)` so every downstream path (PIN-free,
//      PIN-gated, undo…) is driven unchanged.
//   2. Tasks page wiring: the real pending-row tap + "✓ Complete — tap to
//      confirm" pill through the age-gated paths (Jasmine 10 = PIN path,
//      Caspian 5 = PIN-free completesWithoutPin path) plus the non-wall
//      single-tap regression guard.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const wallState = vi.hoisted(() => ({ wall: false, mounted: true }));
vi.mock("@/hooks/useWallMode", () => ({ useWallMode: () => wallState }));

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

import { useWallConfirm } from "@/hooks/useWallConfirm";
import TasksPage from "@/app/tasks/page";
import { todayMondayISO, todayISO } from "@/lib/task-utils";

/* ─────────────────────────── 1. hook seam tests ─────────────────────────── */

let probeRoot: Root | null = null;
function ConfirmProbe({ wall, resetKey, proceed }: { wall: boolean; resetKey: string; proceed: () => void }) {
  const { confirmId, armOrConfirm } = useWallConfirm(wall, resetKey);
  return (
    <div>
      <button data-testid="row-t1" onClick={() => armOrConfirm("t1", proceed)}>Task one</button>
      <button data-testid="row-t2" onClick={() => armOrConfirm("t2", proceed)}>Task two</button>
      {confirmId === "t1" && (
        <button data-testid="pill-t1" onClick={() => armOrConfirm("t1", proceed)}>✓ Complete — tap to confirm</button>
      )}
      {confirmId === "t2" && (
        <button data-testid="pill-t2" onClick={() => armOrConfirm("t2", proceed)}>✓ Complete — tap to confirm</button>
      )}
      <span data-testid="confirm-id">{String(confirmId)}</span>
    </div>
  );
}

function renderProbe(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  probeRoot = createRoot(el);
  act(() => {
    probeRoot!.render(ui);
  });
  return el;
}

function click(el: ParentNode, testid: string) {
  const target = el.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
  if (!target) throw new Error(`missing ${testid}`);
  act(() => {
    target.click();
  });
}

describe("useWallConfirm (the extracted row-tap seam)", () => {
  it("wall on: first tap arms the row (reveals the confirm pill) and does NOT proceed", () => {
    const proceed = vi.fn();
    const el = renderProbe(<ConfirmProbe wall resetKey="k" proceed={proceed} />);
    click(el, "row-t1");
    expect(proceed).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="pill-t1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="confirm-id"]')!.textContent).toBe("t1");
  });

  it("wall on: tapping the confirm pill proceeds — the same seam a non-wall single tap drives", () => {
    const proceed = vi.fn();
    const el = renderProbe(<ConfirmProbe wall resetKey="k" proceed={proceed} />);
    click(el, "row-t1");
    click(el, "pill-t1");
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="pill-t1"]')).toBeNull();
    expect(el.querySelector('[data-testid="confirm-id"]')!.textContent).toBe("null");
  });

  it("wall on: a second tap on the row itself also confirms", () => {
    const proceed = vi.fn();
    const el = renderProbe(<ConfirmProbe wall resetKey="k" proceed={proceed} />);
    click(el, "row-t1");
    click(el, "row-t1");
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="pill-t1"]')).toBeNull();
  });

  it("wall on: tapping a different row re-arms — only one row is armed", () => {
    const proceed = vi.fn();
    const el = renderProbe(<ConfirmProbe wall resetKey="k" proceed={proceed} />);
    click(el, "row-t1");
    click(el, "row-t2");
    expect(proceed).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="pill-t1"]')).toBeNull();
    expect(el.querySelector('[data-testid="pill-t2"]')).not.toBeNull();
  });

  it("wall off: single tap proceeds directly, no arming step (regression guard)", () => {
    const proceed = vi.fn();
    const el = renderProbe(<ConfirmProbe wall={false} resetKey="k" proceed={proceed} />);
    click(el, "row-t1");
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="pill-t1"]')).toBeNull();
  });

  it("changing the reset key (filter member / tab switch) clears the armed row", () => {
    const proceed = vi.fn();
    const el = renderProbe(<ConfirmProbe wall resetKey="member-a|tasks" proceed={proceed} />);
    click(el, "row-t1");
    expect(el.querySelector('[data-testid="pill-t1"]')).not.toBeNull();
    act(() => {
      probeRoot!.render(<ConfirmProbe wall resetKey="member-b|tasks" proceed={proceed} />);
    });
    expect(el.querySelector('[data-testid="pill-t1"]')).toBeNull();
    expect(el.querySelector('[data-testid="confirm-id"]')!.textContent).toBe("null");
    // And the next tap re-arms instead of confirming.
    click(el, "row-t1");
    expect(proceed).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="pill-t1"]')).not.toBeNull();
  });
});

/* ─────────────────────── 2. Tasks page wiring tests ─────────────────────── */

const MONDAY = todayMondayISO();
const FEED_CASP = { id: 51, title: "Feed the dog", assignee: "Caspian Garcia", assigneeEmoji: "🧒", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };
const FEED_JASM = { id: 52, title: "Feed the dog", assignee: "Jasmine Rose", assigneeEmoji: "👧", due: todayISO(), points: 5, recurring: null, category: "Chores", completed: false, priority: "low" };

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function stubGuestFetches() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
}

function stubVerifyMember(member: any) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/members/verify")) {
      return { ok: true, status: 200, json: async () => ({ member }) };
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
  }));
}

let pageRoot: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  pageRoot = createRoot(el);
  await act(async () => { pageRoot!.render(ui); });
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

function pillIn(scope: HTMLElement | ParentNode): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find(
    (b) => (b.textContent || "").includes("tap to confirm")
  ) as HTMLButtonElement | undefined;
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

async function typeAndSubmit(pin = "1234") {
  const input = document.querySelector('input[placeholder="4-digit PIN"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input, pin); });
  await act(async () => { buttonByText("Submit")!.click(); });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  probeRoot = null;
  pageRoot = null;
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

afterEach(async () => {
  if (probeRoot) await act(async () => { probeRoot!.unmount(); });
  if (pageRoot) await act(async () => { pageRoot!.unmount(); });
  probeRoot = null;
  pageRoot = null;
  wallState.wall = false;
});

describe("Tasks page wall chore 2-step confirm (wiring)", () => {
  it("wall on: first tap arms (pill, no dialog, no verify traffic); the pill tap drives the same PIN path a non-wall tap does", async () => {
    wallState.wall = true;
    stubVerifyMember({ name: "Jasmine Rose", fullName: "Jasmine Rose", role: "child" });
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([FEED_JASM]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Feed the dog"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    // First tap: armed only. The PIN entry (setPinTaskId) did NOT open and
    // nothing touched the task or the verify seam.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(pillIn(el)).toBeTruthy();
    expect(storedTasks()[0].completed).toBe(false);
    expect(storedHistory()).toHaveLength(0);
    expect(verifyCalls()).not.toContain("/api/members/verify");

    // Second tap on the pill: the ORIGINAL openPinEntry path — PIN modal.
    const pill = pillIn(el)!;
    await act(async () => { pill.click(); });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('input[inputMode="numeric"]')).not.toBeNull();

    // And that path is the real one end-to-end: a verified PIN lands the
    // done-but-unpaid pending record, exactly like the non-wall flow.
    await typeAndSubmit();
    expect(verifyCalls()).toContain("/api/members/verify");
    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toEqual({ byName: "Jasmine Rose", at: expect.any(String), points: 5 });
    expect(storedHistory()).toHaveLength(0);
    await settle(1800); // flush the success-copy auto-close portal
  });

  it("wall on: the PIN-free kid path waits for the confirm tap too (completesWithoutPin downstream unchanged)", async () => {
    wallState.wall = true;
    stubGuestFetches();
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([FEED_CASP]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Feed the dog"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    // Armed: no instant completion, no dialog, no verify traffic.
    expect(storedTasks()[0].completed).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(pillIn(el)).toBeTruthy();
    expect(verifyCalls()).not.toContain("/api/members/verify");

    // Confirm tap: the original PIN-free branch fires — done-but-unpaid.
    const pill = pillIn(el)!;
    await act(async () => { pill.click(); });
    await settle();
    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toEqual({ byName: "Caspian Garcia", at: expect.any(String), points: 5 });
    expect(storedHistory()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(verifyCalls()).not.toContain("/api/members/verify");
    await settle(1800);
  });

  it("wall on: swipe-right goes through the SAME 2-step seam as tap — first swipe arms (pill, no downstream), second swipe completes", async () => {
    // SwipeableRow uses raw pointer events, so its swipe-right IS reachable on
    // touch — it must route through armOrConfirm like the row tap does.
    wallState.wall = true;
    stubGuestFetches();
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    seed([FEED_CASP]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Feed the dog"]') as HTMLElement;
    expect(row).not.toBeNull();
    // Real PointerEvents bubble from the row div to SwipeableRow's drag
    // wrapper; 60px > the 48px threshold fires onSwipeRight.
    const swipe = () => {
      act(() => {
        row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100 }));
        row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 160 }));
      });
    };

    // First swipe: armed only. No instant completion, no dialog, no verify.
    swipe();
    await settle();
    expect(storedTasks()[0].completed).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(pillIn(el)).toBeTruthy();
    expect(verifyCalls()).not.toContain("/api/members/verify");

    // Second swipe gesture on the armed row: the confirm fires — the same
    // PIN-free downstream a tap would drive (done-but-unpaid).
    swipe();
    await settle();
    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toEqual({ byName: "Caspian Garcia", at: expect.any(String), points: 5 });
    expect(storedHistory()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await settle(1800);
  });

  it("wall off: single tap goes straight to the completion path (regression guard)", async () => {
    wallState.wall = false;
    stubVerifyMember({ name: "Jasmine Rose", fullName: "Jasmine Rose", role: "child" });
    mockAuth.currentUser = { name: "Jasmine", role: "child", age: 10 };
    mockAuth.isLoggedIn = true;
    seed([FEED_JASM]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = el.querySelector('[aria-label="Complete Feed the dog"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    await settle();

    // One tap = the original behavior: PIN modal open, no arming pill ever.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(pillIn(el)).toBeUndefined();

    await typeAndSubmit();
    const saved = storedTasks();
    expect(saved[0].completed).toBe(true);
    expect(saved[0].pendingApproval).toEqual({ byName: "Jasmine Rose", at: expect.any(String), points: 5 });
    await settle(1800);
  });
});
