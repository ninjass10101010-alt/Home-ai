// @vitest-environment jsdom
// KidHome leaderboard weekly-prize race line (Task 12).
// One positive line under the kid leaderboard's reinforcement block:
//   holding a podium spot → "🎉 You're winning {prize}!"
//   chasing with a gap    → "{gap} more points to win {prize}!"
//   zero points anywhere  → "Earn points to win this week's prize!"
// Kid copy stays positive — never "losing".
// Harness mirrors tests/unit/kid-wall.test.tsx: createRoot + act. task-utils
// stays REAL (localStorage-seeded week/prizes) so raceGap + loadWeeklyPrizes
// run the production paths; only the roster, auth, mode, and heavy siblings
// are mocked.
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
  currentUser: { name: "Caspian", role: "child", age: 10, emoji: "🧒", color: "green" } as any,
  logout: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/hooks/useWallMode", () => ({
  useWallMode: () => ({ wall: false, mounted: true }),
}));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    // KidHome's leaderboard roster: selectMembersDetailed().name is the FULL
    // name (the same keyspace weekData.points uses).
    selectMembers: () => [
      { id: 1, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", color: "green" },
      { id: 2, name: "Emily", fullName: "Emily Garcia", role: "child", emoji: "👧", color: "mint" },
      { id: 3, name: "Bailey", fullName: "Bailey Garcia", role: "child", emoji: "👶", color: "cyan" },
      { id: 4, name: "Rebecca", fullName: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" },
    ],
    selectMembersDetailed: () => [
      { name: "Caspian Garcia", color: "green", emoji: "🧒" },
      { name: "Emily Garcia", color: "mint", emoji: "👧" },
      { name: "Bailey Garcia", color: "cyan", emoji: "👶" },
      { name: "Rebecca Garcia", color: "violet", emoji: "👩" },
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
  useAtmosphericTheme: () => ({
    theme: {}, filterId: "atmos", accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

import KidHome from "@/modes/kid/KidHome";
import { WEEKLY_PRIZES_KEY, WEEK_DATA_KEY, TASKS_STORAGE_KEY, todayMondayISO } from "@/lib/task-utils";

const PRIZES = [
  { id: "p1", rank: 1, emoji: "🥇", text: "Movie pick" },
  { id: "p2", rank: 2, emoji: "🥈", text: "Dessert choice" },
  { id: "p3", rank: 3, emoji: "🥉", text: "Two dollars" },
];

function seedWeek(points: Record<string, number>) {
  localStorage.setItem(
    WEEK_DATA_KEY,
    JSON.stringify({ weekStart: todayMondayISO(), points, streak: {}, lastActive: {}, history: [] })
  );
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

async function settle(ms = 60) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("KidHome leaderboard — weekly prize race line", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 10, emoji: "🧒", color: "green" };
    localStorage.setItem(WEEKLY_PRIZES_KEY, JSON.stringify(PRIZES));
    localStorage.setItem(TASKS_STORAGE_KEY, "[]");
    seedWeek({ "Caspian Garcia": 10, "Emily Garcia": 50, "Bailey Garcia": 30, "Rebecca Garcia": 40 });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("holding a podium spot: \"🎉 You're winning {prize}!\" with the prize at the kid's rank", async () => {
    seedWeek({ "Caspian Garcia": 50, "Emily Garcia": 30, "Bailey Garcia": 20, "Rebecca Garcia": 10 });
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).toContain("🎉 You're winning Movie pick!");
  });

  it("chasing with a positive gap: \"{gap} more points to win {prize}!\" names the next podium prize", async () => {
    // Caspian 10 at rank 4; the podium cut-off is Bailey at 30 → gap 20,
    // and the prize he's chasing is the 3rd one ("Two dollars").
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).toContain("20 more points to win Two dollars!");
  });

  it("zero points week: \"Earn points to win this week's prize!\"", async () => {
    seedWeek({});
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).toContain("Earn points to win this week's prize!");
  });

  it("no prizes configured → no race line at all", async () => {
    localStorage.setItem(WEEKLY_PRIZES_KEY, "[]");
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).not.toContain("more points to win");
    expect(el.textContent).not.toContain("You're winning");
    expect(el.textContent).not.toContain("Earn points to win this week's prize!");
  });
});
