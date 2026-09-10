// @vitest-environment jsdom
// KidHome on the wall (spec §6 amendment, "Kid mode on the wall"):
//  - 10+ kids' quest PIN moves from the shared typed-input Modal to the
//    WallPinPad keypad via the onVerify seam (the pad never signs in).
//  - Under-10 kids stay PIN-free on the wall (one tap → pending approval).
//  - A wall-only "Switch member" control signs out to the family rail.
// Harness: createRoot + act pattern (no @testing-library/react), mirrors
// tests/unit/kid-home-quest-pin-safety.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({
  currentUser: { name: "Caspian", role: "child", age: 10 } as any,
  logout: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const wallMock = vi.hoisted(() => ({ wall: false }));
vi.mock("@/hooks/useWallMode", () => ({
  useWallMode: () => ({ wall: wallMock.wall, mounted: true }),
}));

const modeMock = vi.hoisted(() => ({ isBedtime: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: modeMock.isBedtime, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [{ id: 1, name: "Caspian", fullName: "Caspian Garcia", color: "green", emoji: "🧒", role: "child" }],
    selectMembersDetailed: () => [{ name: "Caspian", color: "green", emoji: "🧒" }],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
  },
}));

const store = vi.hoisted(() => ({
  tasks: [] as any[],
  week: { weekStart: "2026-09-01", points: {} as Record<string, number>, streak: {}, lastActive: {}, history: [] as any[] },
  saveTasks: vi.fn(async (_tasks: any[]) => {}),
  saveWeekData: vi.fn(async (_week: any) => {}),
  syncTasksToPB: vi.fn(async (_tasks: any[]) => {}),
  syncWeekDataToPB: vi.fn(async (_week: any) => {}),
}));

vi.mock("@/lib/task-utils", () => ({
  loadTasks: () => store.tasks.map((t) => ({ ...t })),
  saveTasks: store.saveTasks,
  loadWeekData: () => ({ ...store.week, points: { ...store.week.points }, history: [...store.week.history] }),
  saveWeekData: store.saveWeekData,
  addTransaction: (week: any, type: string, amount: number, description: string, member: string, taskId?: number) => ({
    ...week,
    history: [...week.history, { id: 1, timestamp: "2026-09-04T12:00:00.000Z", type, amount, description, member, taskId }],
  }),
  weekKey: () => store.week.weekStart,
  getThisWeeksCompletedTasks: (tasks: any[]) => tasks.filter((t) => t.completed),
  getThisWeeksCompletedDates: () => [],
  calculateRealStreak: () => 0,
  syncTasksToPB: store.syncTasksToPB,
  syncWeekDataToPB: store.syncWeekDataToPB,
  // The REAL age predicates (mirrored from the safety-test harness):
  completesWithoutPin: (role: string | undefined, age: number | undefined, task: any) =>
    role === "child" &&
    typeof age === "number" &&
    Number.isFinite(age) &&
    age > 0 &&
    age < 10 &&
    !task.completed &&
    !task.universal &&
    !(task.stealable && !!task.due && task.due < "2026-09-04"),
  completesWithPendingApproval: (role: string | undefined, task: any) =>
    role === "child" && !task.completed,
  isSnatchable: (task: any, today: string = "2026-09-04") =>
    !!task.stealable && !task.completed && !!task.due && task.due < today,
  resolveMemberName: (members: any[], rawName?: string | null) => {
    const raw = (rawName || "").trim();
    if (!raw) return rawName || "";
    const pool = (members || []).filter((m) => m.role !== "pet");
    const first = (v?: string) => (v || "").trim().split(" ")[0].toLowerCase();
    const exact = pool.find((m) => m.fullName === raw || m.name === raw);
    if (exact) return exact.fullName || exact.name || raw;
    const target = first(raw);
    const mine = pool.find((m) => first(m.fullName) === target || first(m.name) === target);
    return mine ? (mine.fullName || mine.name || raw) : raw;
  },
  tapCompletePending: (task: any, byName: string, nowISO: string, week: string) => ({
    ...task,
    completed: true,
    completedBy: byName,
    completedAt: nowISO,
    completedInWeek: week,
    pendingApproval: { byName, at: nowISO, points: task.points },
  }),
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => <div data-testid="emergency-button" /> }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: {}, filterId: "atmos", accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

import KidHome from "@/modes/kid/KidHome";

const QUEST = { id: 7, title: "Feed the dog", points: 10, assignee: "Caspian", completed: false };

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

async function settle(ms = 60) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

async function tapQuest(el: HTMLElement, title: string) {
  const card = el.querySelector(`[aria-label^="Complete quest: ${title}"]`) as HTMLElement;
  expect(card).not.toBeNull();
  await act(async () => { card.click(); });
  await settle();
}

function padDialog(): HTMLElement | null {
  return document.querySelector('div[role="dialog"][aria-modal="true"][aria-label^="Sign in as"]');
}

async function tapPadDigits(...digits: string[]) {
  for (const d of digits) {
    const btn = document.querySelector(`button[aria-label="${d}"]`) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => { btn!.click(); });
    await settle();
  }
}

function verifyFetch(ok: boolean) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/members/verify")) {
      return ok
        ? { ok: true, json: async () => ({ member: { name: "Caspian", role: "child" } }) }
        : { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe("KidHome on the wall (spec §6 amendment)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    modeMock.isBedtime = false;
    wallMock.wall = false;
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 10 };
    mockAuth.logout.mockReset();
    store.tasks = [{ ...QUEST }];
    store.week = { weekStart: "2026-09-01", points: { Caspian: 20 }, streak: {}, lastActive: {}, history: [] };
    store.saveTasks.mockReset();
    store.saveWeekData.mockReset();
    store.syncTasksToPB.mockClear();
    store.syncWeekDataToPB.mockClear();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
    vi.stubGlobal("fetch", verifyFetch(true));
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("wall + 10+ kid: a quest tap opens the WallPinPad keypad, NOT the typed-input Modal", async () => {
    wallMock.wall = true;
    const el = await renderAsync(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");

    // Pad: wall-scale dialog with the keypad.
    expect(padDialog()).not.toBeNull();
    expect(document.querySelector('button[aria-label="1"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Backspace"]')).not.toBeNull();
    // The shared typed-input Modal must NOT be on the wall.
    expect(document.body.textContent || "").not.toContain("Confirm it's you");
    expect(document.querySelector('input[aria-label="Your 4-digit PIN"]')).toBeNull();
  });

  it("wall + 10+ kid: onVerify success completes the quest through the existing flow (pending + celebration)", async () => {
    wallMock.wall = true;
    const el = await renderAsync(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");
    await tapPadDigits("1", "2", "3", "4");

    // The existing pending-approval contract lands: done-but-unpaid row.
    expect(store.saveTasks).toHaveBeenCalled();
    const saved = store.saveTasks.mock.calls.at(-1)![0];
    const row = saved.find((t: any) => t.id === 7);
    expect(row.completed).toBe(true);
    expect(row.completedBy).toBe("Caspian Garcia");
    expect(row.completedInWeek).toBe("2026-09-01");
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 10 });
    // No points move locally: week store untouched.
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
    expect(store.week.points.Caspian).toBe(20);
    expect(store.syncTasksToPB).toHaveBeenCalled();

    // Celebration fires with the honest "on the way" copy, and the pad closes.
    const burst = document.querySelector('[aria-label^="Congratulations"]');
    expect(burst).not.toBeNull();
    expect(burst!.getAttribute("aria-label")).toContain("on the way");
    expect(padDialog()).toBeNull();
    // The pad never signs the member in — no login-style session fetches.
    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  it("wall + 10+ kid: a wrong PIN surfaces the error inside the pad and completes nothing", async () => {
    wallMock.wall = true;
    vi.stubGlobal("fetch", verifyFetch(false));
    const el = await renderAsync(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");
    await tapPadDigits("9", "9", "9", "9");

    expect(store.saveTasks).not.toHaveBeenCalled();
    // The caller's error string flows verbatim into the pad's alert.
    const dialog = padDialog();
    expect(dialog).not.toBeNull();
    const alert = dialog!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Wrong PIN. Try again.");
    // Dots cleared for the retry.
    expect(dialog!.querySelector('[aria-label="0 of 4 digits entered"]')).not.toBeNull();
  });

  it("wall + under-10 kid: a quest tap completes PIN-free (no pad, no modal) — completesWithoutPin untouched", async () => {
    wallMock.wall = true;
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    const el = await renderAsync(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");

    // No PIN pad, no typed modal — the tap IS the whole gate on the wall too.
    expect(padDialog()).toBeNull();
    expect(document.body.textContent || "").not.toContain("Confirm it's you");
    expect(document.querySelector('input[aria-label="Your 4-digit PIN"]')).toBeNull();

    // Pending contract lands exactly as off-wall.
    expect(store.saveTasks).toHaveBeenCalled();
    const row = store.saveTasks.mock.calls[0][0].find((t: any) => t.id === 7);
    expect(row.completed).toBe(true);
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 10 });
    expect(store.week.points.Caspian).toBe(20);
    const burst = document.querySelector('[aria-label^="Congratulations"]');
    expect(burst!.getAttribute("aria-label")).toContain("on the way");
  });

  it("wall: the Switch-member control renders on the hero and signs out on tap", async () => {
    wallMock.wall = true;
    const el = await renderAsync(<KidHome />);
    await settle();

    const btn = el.querySelector('button[aria-label="Switch member"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(el.textContent).toContain("Switch member");
    await act(async () => { btn!.click(); });
    await settle();
    expect(mockAuth.logout).toHaveBeenCalledTimes(1);
  });

  it("bedtime on the wall keeps its calm surface: no Switch-member control", async () => {
    wallMock.wall = true;
    modeMock.isBedtime = true;
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).toContain("Sweet dreams");
    expect(el.querySelector('button[aria-label="Switch member"]')).toBeNull();
  });

  it("non-wall regression: a 10+ kid's quest tap opens the typed-input Modal exactly as today (no pad, no switcher)", async () => {
    wallMock.wall = false;
    const el = await renderAsync(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");

    expect(document.body.textContent || "").toContain("Confirm it's you");
    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(padDialog()).toBeNull();
    expect(el.querySelector('button[aria-label="Switch member"]')).toBeNull();
  });
});

describe("KidHome hero avatar → KidProfileSheet (kid-profile-sheet Task 3 wiring)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    modeMock.isBedtime = false;
    wallMock.wall = false;
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 10 };
    mockAuth.logout.mockReset();
    store.tasks = [];
    store.week = { weekStart: "2026-09-01", points: { Caspian: 20 }, streak: {}, lastActive: {}, history: [] };
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
    vi.stubGlobal("fetch", verifyFetch(true));
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function heroAvatar(el: HTMLElement): HTMLButtonElement {
    const btn = el.querySelector('button[aria-label="Open your profile"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('hero avatar is not a button[aria-label="Open your profile"]');
    return btn;
  }

  function sheetDialog(): HTMLElement | null {
    return document.body.querySelector('[role="dialog"]');
  }

  it("the hero avatar is a button with aria-label 'Open your profile'", async () => {
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(heroAvatar(el)).toBeTruthy();
  });

  it("tapping the hero avatar opens the sheet (dialog with the kid's first name in document.body)", async () => {
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(sheetDialog()).toBeNull();
    await act(async () => { heroAvatar(el).click(); });
    await settle();
    const dialog = sheetDialog();
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Caspian");
  });

  it("the stale hint 'Tap the ⚙️ in settings to switch profiles' appears NOWHERE in any KidHome render", async () => {
    for (const cfg of [
      { wall: false, bedtime: false },
      { wall: true, bedtime: false },
      { wall: false, bedtime: true },
    ]) {
      wallMock.wall = cfg.wall;
      modeMock.isBedtime = cfg.bedtime;
      const el = await renderAsync(<KidHome />);
      await settle();
      expect(el.textContent).not.toContain("settings to switch profiles");
      expect(document.body.textContent).not.toContain("settings to switch profiles");
      await act(async () => { activeRoot?.unmount(); });
      document.body.innerHTML = "";
      activeRoot = null;
    }
  });

  it("non-wall non-bedtime renders the new hint 'Tap your picture to make it yours'", async () => {
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).toContain("Tap your picture to make it yours");
  });

  it("wall mode: 'Switch member' still renders AND the avatar tap opens the sheet", async () => {
    wallMock.wall = true;
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.querySelector('button[aria-label="Switch member"]')).not.toBeNull();
    await act(async () => { heroAvatar(el).click(); });
    await settle();
    expect(sheetDialog()).not.toBeNull();
    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  it("bedtime mode: the hero avatar tap still opens the sheet", async () => {
    modeMock.isBedtime = true;
    const el = await renderAsync(<KidHome />);
    await settle();
    await act(async () => { heroAvatar(el).click(); });
    await settle();
    expect(sheetDialog()).not.toBeNull();
  });
});

describe("kid-mode wall CSS contract (modes.css, spec §6 amendment)", () => {
  const { readFileSync } = require("node:fs");
  const { resolve } = require("node:path");
  const css = readFileSync(resolve(__dirname, "../../src/modes/modes.css"), "utf8");

  it("scales the kid hero avatar, pins the ≥64px quest floor, raises the kid text floor, and sizes the switcher — all scoped to the wall", () => {
    expect(css).toMatch(/html\[data-wall="true"\] \[data-mode="kid"\] \.avatar-hero/);
    expect(css).toContain("width: 140px");
    expect(css).toMatch(/html\[data-wall="true"\] \[data-mode="kid"\] \.quest-card/);
    expect(css).toContain("min-height: 72px");
    expect(css).toMatch(/html\[data-wall="true"\] \[data-mode="kid"\] \.text-\\\[10px\\\]/);
    expect(css).toMatch(/html\[data-wall="true"\] \[data-mode="kid"\] \.text-\\\[11px\\\]/);
    expect(css).toMatch(/html\[data-wall="true"\] \[data-mode="kid"\] button\[aria-label="Switch member"\]/);
    expect(css).toContain("min-height: 56px");
  });

  it("adds no new keyframes (size/layout only — the reduced-motion contract holds)", () => {
    const wallBlock = css.slice(css.indexOf("KID MODE ON THE WALL"));
    expect(wallBlock).not.toMatch(/@keyframes/);
  });
});
