// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";
import Podium from "@/components/leaderboard/Podium";
import YourCard from "@/components/leaderboard/YourCard";
import TasksPage from "@/app/tasks/page";
import KidHome from "@/modes/kid/KidHome";
import { getMemberAllTimePoints, HALL_OF_FAME_KEY, WEEK_DATA_KEY } from "@/lib/task-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const allTimeSpy = vi.mocked(getMemberAllTimePoints);

// ─── Module mocks (one consistent harness for Podium/YourCard/page/kid) ─────
// Real task-utils everywhere (localStorage-backed) — only the all-time helper
// is wrapped in a spy so the KidHome test can pin the ledger-keyed name.
vi.mock("@/lib/task-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/task-utils")>("@/lib/task-utils");
  return { ...actual, getMemberAllTimePoints: vi.fn(actual.getMemberAllTimePoints) };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/tasks",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: null as any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const modeMock = vi.hoisted(() => ({ isBedtime: false, isWeekend: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: modeMock.isBedtime, isWeekend: modeMock.isWeekend, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
      { id: 4, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", color: "green", age: 5 },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
      { id: 4, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", color: "green", age: 5 },
    ],
    selectMembersDetailed: () => [
      { id: 1, name: "Rebecca", color: "violet", emoji: "👩", role: "parent" },
      { id: 2, name: "Jasmine", color: "rose", emoji: "👧", role: "child" },
      { id: 3, name: "Emily", color: "mint", emoji: "👧", role: "child" },
      { id: 4, name: "Caspian Garcia", color: "green", emoji: "🧒", role: "child", age: 5 },
    ],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
  },
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => null }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: {}, filterId: "atmos", accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

// ─── Render helpers ─────────────────────────────────────────────────────────
Element.prototype.scrollIntoView = vi.fn() as any;

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

async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function thisMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  allTimeSpy.mockClear();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  modeMock.isBedtime = false;
  modeMock.isWeekend = false;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)));
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
  vi.unstubAllGlobals();
});

// ─── Fixtures ───────────────────────────────────────────────────────────────
function lbEntry(name: string, points: number, rank: number, allTimePoints = points): LeaderboardEntry {
  return {
    name,
    emoji: "🙂",
    color: "green",
    points,
    streak: 0,
    rank,
    level: 1,
    levelTitle: "Rookie",
    levelEmoji: "🌱",
    progressToNext: 0,
    badges: [],
    completedInWeek: 0,
    allTimePoints,
    allTimeCompletions: 0,
  };
}

const MOVIE_PRIZE: WeeklyPrize = { id: "prize-1", rank: 1, emoji: "🥇", text: "Picks the movie" };
const DESSERT_PRIZE: WeeklyPrize = { id: "prize-2", rank: 2, emoji: "🥈", text: "Chooses dessert" };

async function renderPodium(entries: LeaderboardEntry[], prizes: WeeklyPrize[]): Promise<HTMLElement> {
  return renderAsync(
    <Podium
      entries={entries}
      prizes={prizes}
      previousRanks={{}}
      isYou={() => false}
      getMemberColor={() => "green"}
      onOpenSheet={() => {}}
      onAdjust={() => {}}
      isAdmin={false}
    />
  );
}

// ─── Podium prize ribbon + all-time line ────────────────────────────────────
describe("Podium prize ribbon", () => {
  it("shows a compact 🎁 prize pill when the slot's rank has a prize and points > 0", async () => {
    const el = await renderPodium([lbEntry("Rebecca", 30, 1, 130)], [MOVIE_PRIZE]);
    expect(el.textContent).toContain("🎁 Picks the movie");
    // Truncation guard: the full text survives on the pill's title.
    const pill = el.querySelector('[title="Picks the movie"]');
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain("text-text-muted");
  });

  it("shows no prize pill on a zero-point slot, even when the rank has a prize (the zero-state crown owns that moment)", async () => {
    const el = await renderPodium(
      [lbEntry("Emily", 10, 1, 60), lbEntry("Rebecca", 0, 2, 40)],
      [MOVIE_PRIZE, DESSERT_PRIZE]
    );
    // Control: the rank-1 sibling with points DOES get its pill.
    expect(el.querySelector('[aria-label^="Emily:"]')!.textContent).toContain("🎁 Picks the movie");
    // Rebecca's rank has a configured prize, but at 0 pts there is no ribbon.
    const rebecca = el.querySelector('[aria-label^="Rebecca:"]');
    expect(rebecca!.textContent).not.toContain("🎁");
    expect(rebecca!.querySelector('[title="Chooses dessert"]')).toBeNull();
  });

  it("shows no prize pill when the slot's rank has no configured prize", async () => {
    const el = await renderPodium(
      [lbEntry("Rebecca", 30, 1, 130), lbEntry("Emily", 20, 2, 55)],
      [DESSERT_PRIZE]
    );
    // Control: rank 2 has a prize and shows.
    expect(el.querySelector('[aria-label^="Emily:"]')!.textContent).toContain("🎁 Chooses dessert");
    // Rank 1 has no configured prize — no ribbon.
    const rebecca = el.querySelector('[aria-label^="Rebecca:"]');
    expect(rebecca!.textContent).not.toContain("🎁");
  });

  it("two members tied on points (both competition rank 1) both wear the rank-1 prize pill", async () => {
    const el = await renderPodium(
      [lbEntry("Rebecca", 30, 1, 130), lbEntry("Caspian", 30, 1, 130)],
      [MOVIE_PRIZE]
    );
    // Ties share the rank — nobody is demoted to second, so the 🎁 ribbon and
    // the 🥇 medal appear on BOTH slots.
    const rebecca = el.querySelector('[aria-label^="Rebecca:"]');
    const caspian = el.querySelector('[aria-label^="Caspian:"]');
    expect(rebecca!.textContent).toContain("🎁 Picks the movie");
    expect(caspian!.textContent).toContain("🎁 Picks the movie");
    expect(rebecca!.textContent).toContain("🥇");
    expect(caspian!.textContent).toContain("🥇");
  });
});

describe("Podium all-time line", () => {
  it("shows '{allTimePoints} all-time' under the points line when it differs from the week", async () => {
    const el = await renderPodium([lbEntry("Rebecca", 30, 1, 130)], []);
    expect(el.textContent).toContain("130 all-time");
  });

  it("hides the all-time line for a brand-new member (allTimePoints === points reads as clutter)", async () => {
    const el = await renderPodium(
      [lbEntry("Rebecca", 30, 1, 30), lbEntry("Emily", 20, 2, 55)],
      []
    );
    // Control: Emily (20 this week, 55 all-time) DOES show the all-time line.
    expect(el.querySelector('[aria-label^="Emily:"]')!.textContent).toContain("55 all-time");
    // Rebecca is brand new — her slot shows no "all-time" line at all.
    expect(el.querySelector('[aria-label^="Rebecca:"]')!.textContent).not.toContain("all-time");
  });
});

// ─── YourCard ───────────────────────────────────────────────────────────────
describe("YourCard all-time line", () => {
  it("appends '· {allTimePoints} all-time' after the accent weekly points", async () => {
    const el = await renderAsync(
      <YourCard entry={lbEntry("Rebecca", 30, 1, 130)} aheadEntry={undefined} getMemberColor={() => "green"} />
    );
    expect(el.textContent).toContain("30 pts");
    expect(el.textContent).toContain("· 130 all-time");
  });
});

// ─── Tasks page: "Earned this week" StatTile + Podium wiring ────────────────
describe("Tasks page Earned tile", () => {
  function seedWeekAndArchive() {
    localStorage.setItem("consuela-week-data", JSON.stringify({
      weekStart: thisMondayISO(),
      points: { Rebecca: 15, Emily: 5 },
      streak: {}, lastActive: {}, history: [],
    }));
    localStorage.setItem("consuela-week-archive", JSON.stringify({
      "2026-09-07": {
        weekStart: "2026-09-07",
        points: { Rebecca: 100, Emily: 50 },
        streak: {}, lastActive: {}, history: [],
      },
    }));
  }

  it('reads "Earned this week" with the family all-time total as the detail (filter "All")', async () => {
    seedWeekAndArchive();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("Earned this week");
    // Rebecca 15+100, Emily 5+50, Jasmine/Caspian 0 → 170.
    expect(text).toContain("170 pts all-time");
    expect(text).not.toContain("This week's points");
  });

  it("member filter scopes the all-time detail to that member's total", async () => {
    seedWeekAndArchive();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const tile = Array.from(el.querySelectorAll<HTMLElement>(".member-tile")).find((t) =>
      (t.textContent || "").includes("Rebecca")
    );
    expect(tile).toBeTruthy();
    await act(async () => { tile!.click(); });
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("115 pts all-time"); // Rebecca 15 + archived 100
    expect(text).not.toContain("170 pts all-time");
  });

  it("passes the page's weekly prizes into the Podium (rank-1 slot shows the 🎁 pill; zero-point slot shows none)", async () => {
    seedWeekAndArchive();
    localStorage.setItem("consuela-weekly-prizes", JSON.stringify([
      { id: "p1", rank: 1, emoji: "🥇", text: "Ice cream for the winner" },
    ]));
    const el = await renderAsync(<TasksPage />);
    await settle();

    const lb = [...el.querySelectorAll('button, [role="radio"]')].find((b) => (b.textContent || "").trim() === "Leaderboard");
    (lb as HTMLButtonElement).click();
    await settle();

    const text = el.textContent || "";
    // Rebecca (rank 1, 15 pts) gets the pill; Jasmine's 0-point slot does not.
    expect(text).toContain("🎁 Ice cream for the winner");
    // Podium all-time lines: Rebecca 115 / Emily 55; Jasmine (0 === 0) stays clean.
    expect(text).toContain("115 all-time");
    expect(text).toContain("55 all-time");
    expect(text).not.toContain("0 all-time");
  });
});

// ─── Tasks page: weekly champ badge from the Hall of Fame ───────────────────
describe("Tasks page weekly champ badge (hall of fame)", () => {
  function seedChampWeek() {
    localStorage.setItem(WEEK_DATA_KEY, JSON.stringify({
      weekStart: thisMondayISO(),
      points: { Rebecca: 15, Emily: 5 },
      streak: {}, lastActive: {}, history: [],
    }));
  }

  function seedHall(entries: Array<{ member: string; rank: number }>) {
    localStorage.setItem(HALL_OF_FAME_KEY, JSON.stringify(
      entries.map((e) => ({ member: e.member, emoji: "🏅", weekStart: "2026-09-07", points: 40, rank: e.rank }))
    ));
  }

  async function renderLeaderboardTab(): Promise<HTMLElement> {
    const el = await renderAsync(<TasksPage />);
    await settle();
    const lb = [...el.querySelectorAll('button, [role="radio"]')].find(
      (b) => (b.textContent || "").trim() === "Leaderboard"
    );
    (lb as HTMLButtonElement).click();
    await settle();
    return el;
  }

  function badgeSparkles(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll(".animate-badge-sparkle")).map((s) => (s.textContent || "").trim());
  }

  it("a rank-1 hall win puts the 🥇 champ badge in the champion's trophy strip", async () => {
    seedChampWeek();
    seedHall([{ member: "Rebecca", rank: 1 }]);
    const el = await renderLeaderboardTab();

    expect(badgeSparkles(el)).toContain("🥇");
  });

  it("no hall entry → the 🥇 champ badge never appears", async () => {
    seedChampWeek();
    const el = await renderLeaderboardTab();

    expect(badgeSparkles(el)).not.toContain("🥇");
  });

  it("a rank-2 hall entry earns no champ badge (only the winner gets it)", async () => {
    seedChampWeek();
    seedHall([{ member: "Rebecca", rank: 2 }]);
    const el = await renderLeaderboardTab();

    expect(badgeSparkles(el)).not.toContain("🥇");
  });
});

// ─── KidHome hero caption ───────────────────────────────────────────────────
describe("KidHome hero all-time caption", () => {
  it("renders '{allTime} all-time' under the hero points figure, keyed by the ledger-resolved name", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    localStorage.setItem("consuela-week-data", JSON.stringify({
      weekStart: thisMondayISO(),
      points: { "Caspian Garcia": 20 },
      streak: {}, lastActive: {}, history: [],
    }));
    localStorage.setItem("consuela-week-archive", JSON.stringify({
      "2026-09-07": {
        weekStart: "2026-09-07",
        points: { "Caspian Garcia": 100 },
        streak: {}, lastActive: {}, history: [],
      },
    }));

    const el = await renderAsync(<KidHome />);
    await settle();

    // The ledger key for a first-name session is the roster FULL name
    // (ledgerKey: exact key match, else first-word match over week points).
    expect(allTimeSpy).toHaveBeenCalledWith("Caspian Garcia", expect.anything());
    // 2026-09-20 lift: the all-time figure lives in the labeled FOREVER card
    // (was an 11px "{N} all-time" whisper under a weekly-fed level bar).
    const foreverCard = el.querySelector('[data-testid="kid-forever-card"]');
    expect(foreverCard).toBeTruthy();
    expect(foreverCard!.textContent).toContain("120 pts · yours to keep");
  });
});
