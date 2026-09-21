// @vitest-environment jsdom
// Two named point systems for kids: the WEEKLY race (resets Monday) and the
// FOREVER journey (all-time, never resets) — labeled side by side in the hero,
// with the level bar fed ALL-TIME points so the kid's level matches the Tasks
// leaderboard instead of resetting every Monday.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({
  currentUser: { name: "Aurora", role: "child", age: 7, emoji: "🌈", color: "mint" } as any,
  isLoggedIn: true,
  logout: vi.fn(),
  sessionWarning: false,
  sessionRemainingMs: 0,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const modeMock = vi.hoisted(() => ({ isBedtime: false, isWeekend: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: modeMock.isBedtime, isWeekend: modeMock.isWeekend, currentHour: 12, currentDay: 3, previousMode: null }),
}));

const weeklyPrizesMock = vi.hoisted(() => ({ prizes: [] as any[] }));
vi.mock("@/components/leaderboard/hooks/useWeeklyPrizes", () => ({
  useWeeklyPrizes: () => weeklyPrizesMock.prizes,
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", color: "violet", emoji: "👩" },
      { name: "Aurora", fullName: "Aurora", role: "child", color: "mint", emoji: "🌈" },
      { name: "Caspian", fullName: "Caspian", role: "child", color: "cyan", emoji: "🧒" },
    ],
    selectMembersDetailed: () => [
      { name: "Aurora", role: "child", emoji: "🌈", color: "mint", avatarSize: "md", glow: false, age: 7 },
      { name: "Caspian", role: "child", emoji: "🧒", color: "cyan", avatarSize: "md", glow: false, age: 5 },
      { name: "Emily", role: "child", emoji: "👧", color: "rose", avatarSize: "md", glow: false, age: 14 },
      { name: "Jasmine", role: "child", emoji: "👧", color: "amber", avatarSize: "md", glow: false, age: 10 },
    ],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
  },
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => <div data-testid="emergency-button" /> }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/components/leaderboard/WeeklyWinModal", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({ theme: {}, filterId: "atmos", accentRgb: "0,0,0", colors: { glow: "", gradientStop: "", accentColor: "" } }),
}));

import KidHome from "@/modes/kid/KidHome";
import { loadWeekData, saveWeekData, WEEK_DATA_KEY, getArchivedWeeks, saveHallOfFame, mondayOf } from "@/lib/task-utils";
import { kidRaceLine } from "@/modes/kid/quest-labels";

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
async function settle(ms = 150) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function seedWeek(points: Record<string, number>) {
  localStorage.setItem(WEEK_DATA_KEY, JSON.stringify({
    weekStart: mondayOf(new Date()).toISOString().split("T")[0],
    points, streak: {}, lastActive: {},
    history: Object.entries(points).flatMap(([member, pts]) =>
      Array.from({ length: Math.ceil((pts as number) / 5) }, (_, i) => ({
        id: i + Math.random(), timestamp: new Date().toISOString(), member,
        type: "earn", amount: 5, description: "quest", taskId: 900 + i,
      }))),
  }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  // Two archived weeks: 60 pts forever for Aurora outside this week's 10.
  const past = mondayOf(new Date());
  past.setDate(past.getDate() - 14);
  const pastISO = past.toISOString().split("T")[0];
  localStorage.setItem("consuela-week-archive", JSON.stringify({
    [pastISO]: { weekStart: pastISO, points: { Aurora: 60 }, streak: {}, lastActive: {}, history: [] },
  }));
  weeklyPrizesMock.prizes = [];
  modeMock.isBedtime = false;
  modeMock.isWeekend = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
});

describe("KidHome hero — two named point systems", () => {
  it("shows a THIS WEEK card with the weekly points and a reset line, and a FOREVER card with the all-time total", async () => {
    seedWeek({ Aurora: 10, Caspian: 25 });
    const el = await renderAsync(<KidHome />);
    await settle(300);

    const weekCard = el.querySelector('[data-testid="kid-week-card"]');
    const foreverCard = el.querySelector('[data-testid="kid-forever-card"]');
    expect(weekCard).toBeTruthy();
    expect(foreverCard).toBeTruthy();

    // Week card: labeled + the WEEKLY number (10, not the all-time 70).
    expect(weekCard!.textContent).toContain("This Week");
    expect(weekCard!.textContent).toContain("10");
    expect(weekCard!.textContent.toLowerCase()).toMatch(/resets?/);

    // Forever card: labeled + the ALL-TIME total (10 this week + 60 archived).
    expect(foreverCard!.textContent).toContain("Forever");
    expect(foreverCard!.textContent).toContain("70");
    expect(foreverCard!.textContent).toContain("yours to keep");
  });

  it("the level derives from ALL-TIME points (parity with the Tasks leaderboard), not the weekly number", async () => {
    seedWeek({ Aurora: 10 }); // weekly 10 → naive level 1; all-time 70 → level 2
    const el = await renderAsync(<KidHome />);
    await settle(300);

    const foreverCard = el.querySelector('[data-testid="kid-forever-card"]');
    expect(foreverCard!.textContent).toMatch(/Level 2/);
    expect(foreverCard!.textContent).not.toMatch(/Level 1\b/);
  });

  it("the hero week card carries the prize-race line when prizes are configured", async () => {
    seedWeek({ Aurora: 10, Caspian: 30, Emily: 25, Jasmine: 20 });
    weeklyPrizesMock.prizes = [
      { id: "p1", rank: 1, emoji: "🥇", text: "Picks Friday's family movie" },
      { id: "p2", rank: 2, emoji: "🥈", text: "Chooses the dessert night" },
      { id: "p3", rank: 3, emoji: "🥉", text: "+$2 allowance" },
    ];
    const el = await renderAsync(<KidHome />);
    await settle(300);

    const weekCard = el.querySelector('[data-testid="kid-week-card"]');
    // Aurora (10) sits below three competitors → off podium → gap copy names
    // the LAST prize, positive framing.
    expect(weekCard!.textContent).toContain("more points to win +$2 allowance");
  });

  it("the leaderboard card keeps its race line from the SAME helper (no drift)", async () => {
    seedWeek({ Aurora: 10, Caspian: 25 });
    weeklyPrizesMock.prizes = [{ id: "p1", rank: 1, emoji: "🥇", text: "Picks Friday's family movie" }];
    const el = await renderAsync(<KidHome />);
    await settle(300);

    const boardLine = el.querySelector('[data-testid="kid-prize-race-line"]');
    expect(boardLine).toBeTruthy();
    const weekCard = el.querySelector('[data-testid="kid-week-card"]');
    expect(weekCard!.textContent).toContain(boardLine!.textContent);
  });
});

describe("kidRaceLine (pure)", () => {
  const prizes = [
    { rank: 1, text: "Picks Friday's family movie" },
    { rank: 2, text: "Chooses the dessert night" },
    { rank: 3, text: "+$2 allowance" },
  ];
  it("no prizes → null", () => {
    expect(kidRaceLine("Aurora", { Aurora: 10 }, [])).toBeNull();
  });
  it("on podium → winning copy", () => {
    expect(kidRaceLine("Aurora", { Aurora: 30, Caspian: 10 }, prizes)).toContain("You're winning Picks Friday's family movie");
  });
  it("off podium → positive gap copy naming the NEAREST prize (rank 3, the easiest win)", () => {
    const line = kidRaceLine("Aurora", { Aurora: 5, Caspian: 20, Emily: 15, Jasmine: 10 }, prizes);
    expect(line).toContain("5 more points to win +$2 allowance");
    expect(line).not.toContain("losing");
  });
  it("zero points → earn copy", () => {
    expect(kidRaceLine("Aurora", { Aurora: 0 }, prizes)).toContain("Earn points");
  });
});
