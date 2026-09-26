// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";
import Podium from "@/components/leaderboard/Podium";
import YourCard from "@/components/leaderboard/YourCard";
import MemberSheet from "@/components/leaderboard/MemberSheet";
import TasksPage from "@/app/tasks/page";
import KidHome from "@/modes/kid/KidHome";
import { ALL_TIME_CACHE_KEY } from "@/hooks/useAllTimeTotals";
import { HALL_OF_FAME_KEY, WEEK_DATA_KEY } from "@/lib/task-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Module mocks (one consistent harness for Podium/YourCard/page/kid) ─────
// Real task-utils everywhere (localStorage-backed). The all-time numbers come
// from the PB-backed service, so the harness answers /api/tasks/all-time.
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

// ─── The PB all-time service, answered per test ──────────────────────────────
const ALL_TIME_FETCHED_AT = "2026-09-24T10:00:00.000Z";
const allTime = vi.hoisted(() => ({
  respond: null as null | (() => unknown),
}));

function payloadWith(totals: Record<string, { points: number | null; completions: number | null }>, historyComplete = true) {
  return {
    weekStart: "2026-09-21",
    totals,
    historyComplete,
    source: "pocketbase",
    fetchedAt: ALL_TIME_FETCHED_AT,
  };
}

function serveAllTime(totals: Record<string, { points: number | null; completions: number | null }>, historyComplete = true) {
  allTime.respond = () => payloadWith(totals, historyComplete);
}

function serveAllTimeFailure(status = 503) {
  allTime.respond = () => ({ __httpError: status });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  modeMock.isBedtime = false;
  modeMock.isWeekend = false;
  // Default: the family the fixtures describe — Rebecca 115, Emily 55, the two
  // other members present with 0 (so the family total is knowable).
  serveAllTime({
    Rebecca: { points: 115, completions: 9 },
    Emily: { points: 55, completions: 5 },
    Jasmine: { points: 0, completions: 0 },
    "Caspian Garcia": { points: 0, completions: 0 },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/tasks/all-time")) {
      const body = allTime.respond ? allTime.respond() : payloadWith({});
      if (body && typeof body === "object" && "__httpError" in body) {
        return { ok: false, status: (body as any).__httpError, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  }));
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
function lbEntry(name: string, points: number, rank: number, allTimePoints: number | null = points): LeaderboardEntry {
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
    levelKnown: true,
    progressToNext: 0,
    badges: [],
    completedInWeek: 0,
    allTimePoints,
    allTimeCompletions: 0,
  };
}

const AUTHORITATIVE = { state: "authoritative", updatedAt: ALL_TIME_FETCHED_AT } as const;

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
      allTimeRead={AUTHORITATIVE}
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

  it("an unknown all-time total says unavailable instead of printing a figure", async () => {
    const el = await renderAsync(
      <Podium
        entries={[lbEntry("Rebecca", 30, 1, null)]}
        prizes={[]}
        previousRanks={{}}
        isYou={() => false}
        getMemberColor={() => "green"}
        onOpenSheet={() => {}}
        onAdjust={() => {}}
        isAdmin={false}
        allTimeRead={AUTHORITATIVE}
      />
    );
    const slot = el.querySelector('[aria-label^="Rebecca:"]')!;
    expect(slot.textContent).toContain("All-time unavailable");
    expect(slot.textContent).not.toContain("null all-time");
  });

  it("a loading read never shows a number", async () => {
    const el = await renderAsync(
      <Podium
        entries={[lbEntry("Rebecca", 30, 1, 130)]}
        prizes={[]}
        previousRanks={{}}
        isYou={() => false}
        getMemberColor={() => "green"}
        onOpenSheet={() => {}}
        onAdjust={() => {}}
        isAdmin={false}
        allTimeRead={{ state: "loading", updatedAt: null }}
      />
    );
    const slot = el.querySelector('[aria-label^="Rebecca:"]')!;
    expect(slot.textContent).toContain("Loading all-time");
    expect(slot.textContent).not.toContain("130 all-time");
  });

  it("an offline-cached figure says so and carries the cache timestamp", async () => {
    const el = await renderAsync(
      <Podium
        entries={[lbEntry("Rebecca", 30, 1, 130)]}
        prizes={[]}
        previousRanks={{}}
        isYou={() => false}
        getMemberColor={() => "green"}
        onOpenSheet={() => {}}
        onAdjust={() => {}}
        isAdmin={false}
        allTimeRead={{ state: "offline_cache", updatedAt: ALL_TIME_FETCHED_AT }}
      />
    );
    const slot = el.querySelector('[aria-label^="Rebecca:"]')!;
    expect(slot.textContent).toContain("130 all-time");
    expect(slot.textContent).toContain("offline cache");
    expect(slot.querySelector("time")!.getAttribute("datetime")).toBe(ALL_TIME_FETCHED_AT);
  });
});

// ─── YourCard ───────────────────────────────────────────────────────────────
describe("YourCard all-time line", () => {
  it("appends '· {allTimePoints} all-time' after the accent weekly points", async () => {
    const el = await renderAsync(
      <YourCard entry={lbEntry("Rebecca", 30, 1, 130)} aheadEntry={undefined} getMemberColor={() => "green"} allTimeRead={AUTHORITATIVE} />
    );
    expect(el.textContent).toContain("30 pts");
    expect(el.textContent).toContain("· 130 all-time");
  });

  it("an unknown all-time total never prints a figure or a level", async () => {
    const entry = { ...lbEntry("Rebecca", 30, 1, null), levelKnown: false, level: 0, levelTitle: "", levelEmoji: "" };
    const el = await renderAsync(
      <YourCard entry={entry} aheadEntry={undefined} getMemberColor={() => "green"} allTimeRead={AUTHORITATIVE} />
    );
    expect(el.textContent).toContain("30 pts");
    expect(el.textContent).toContain("All-time unavailable");
    expect(el.textContent).not.toContain("Rookie");
    expect(el.textContent).toContain("Level unavailable");
  });
});

// ─── MemberSheet ────────────────────────────────────────────────────────────
describe("MemberSheet all-time line", () => {
  async function renderSheet(allTimePoints: number | null, allTimeComps: number | null) {
    return renderAsync(
      <MemberSheet
        open
        entry={{ name: "Emily", emoji: "👧", streak: 2, rank: 1, levelEmoji: "⭐", levelTitle: "Champ", levelKnown: true, badges: [] }}
        allTimePoints={allTimePoints}
        allTimeComps={allTimeComps}
        weeklyPoints={40}
        pendingTasks={[]}
        affordableRewards={[]}
        weekGraph={[]}
        onClose={() => {}}
        getMemberColor={() => "rose"}
        allTimeRead={AUTHORITATIVE}
      />
    );
  }

  it("shows both figures when both are known", async () => {
    await renderSheet(120, 30);
    const text = document.body.textContent || "";
    expect(text).toContain("120 all-time");
    expect(text).toContain("30 tasks completed");
  });

  it("a null completion count says the completion count is unavailable (never 0)", async () => {
    await renderSheet(120, null);
    const text = document.body.textContent || "";
    expect(text).toContain("120 all-time");
    expect(text).toContain("completion count unavailable");
    expect(text).not.toContain("0 tasks completed");
  });

  it("a null total makes the whole figure unavailable and awards no completion badge", async () => {
    await renderSheet(null, null);
    const text = document.body.textContent || "";
    expect(text).toContain("All-time unavailable");
    expect(text).not.toContain("🎯");
    expect(text).toContain("Level unavailable");
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
    // Rebecca 115, Emily 55, Jasmine 0, Caspian 0 → 170 from the PB service.
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
    expect(text).toContain("115 pts all-time");
    expect(text).not.toContain("170 pts all-time");
  });

  it("the stored archive is NOT the source: a lying local points map cannot move the number", async () => {
    localStorage.setItem("consuela-week-data", JSON.stringify({
      weekStart: thisMondayISO(),
      points: { Rebecca: 15 },
      streak: {}, lastActive: {}, history: [],
    }));
    localStorage.setItem("consuela-week-archive", JSON.stringify({
      "2026-09-07": {
        weekStart: "2026-09-07",
        points: { Rebecca: 9999, Emily: 9999, Jasmine: 9999, "Caspian Garcia": 9999 },
        streak: {}, lastActive: {}, history: [],
      },
    }));

    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("170 pts all-time");
    expect(text).not.toContain("9999");
  });

  it("the family total is unavailable when ANY member total is unknown", async () => {
    seedWeekAndArchive();
    serveAllTime({
      Rebecca: { points: 115, completions: 9 },
      Emily: { points: 55, completions: 5 },
      Jasmine: { points: null, completions: null },
      "Caspian Garcia": { points: 0, completions: 0 },
    });

    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("Earned this week");
    expect(text).toContain("All-time unavailable");
    expect(text).not.toContain("pts all-time");
  });

  it("incomplete history shows unavailable and never the stored figure", async () => {
    seedWeekAndArchive();
    serveAllTime({
      Rebecca: { points: null, completions: null },
      Emily: { points: null, completions: null },
      Jasmine: { points: null, completions: null },
      "Caspian Garcia": { points: null, completions: null },
    }, false);

    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("All-time unavailable");
    expect(text).not.toContain("pts all-time");
    expect(text).not.toContain("170");
  });

  it("a failed read with no cache shows the unavailable sentence (never a zero)", async () => {
    seedWeekAndArchive();
    serveAllTimeFailure(503);

    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("All-time unavailable");
    expect(text).not.toContain("0 pts all-time");
  });

  it("an offline-cached family total is labelled as a cache", async () => {
    seedWeekAndArchive();
    localStorage.setItem(ALL_TIME_CACHE_KEY, JSON.stringify({
      weekStart: "2026-09-21",
      totals: {
        Rebecca: { points: 115, completions: 9 },
        Emily: { points: 55, completions: 5 },
        Jasmine: { points: 0, completions: 0 },
        "Caspian Garcia": { points: 0, completions: 0 },
      },
      historyComplete: true,
      source: "pocketbase",
      fetchedAt: ALL_TIME_FETCHED_AT,
    }));
    serveAllTimeFailure(503);

    const el = await renderAsync(<TasksPage />);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("170 pts all-time");
    expect(text).toContain("offline cache");
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
  it("renders the PB all-time total in the labeled FOREVER card, keyed by the ledger-resolved name", async () => {
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
    serveAllTime({
      Rebecca: { points: 115, completions: 9 },
      Emily: { points: 55, completions: 5 },
      Jasmine: { points: 0, completions: 0 },
      "Caspian Garcia": { points: 120, completions: 8 },
    });

    const el = await renderAsync(<KidHome />);
    await settle();

    // This case pins the LEDGER KEY, not the source: the retired local helper
    // would also have produced 120 from the stored map. The source is proven by
    // the two divergent-number cases above (a 9999 archive that must not win,
    // and an unknown total that must render unavailable).
    const foreverCard = el.querySelector('[data-testid="kid-forever-card"]');
    expect(foreverCard).toBeTruthy();
    expect(foreverCard!.textContent).toContain("120 pts · yours to keep");
  });

  it("an unknown all-time total says unavailable and shows no level bar", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
    mockAuth.isLoggedIn = true;
    localStorage.setItem("consuela-week-data", JSON.stringify({
      weekStart: thisMondayISO(),
      points: { "Caspian Garcia": 20 },
      streak: {}, lastActive: {}, history: [],
    }));
    serveAllTime({ "Caspian Garcia": { points: null, completions: null } }, false);

    const el = await renderAsync(<KidHome />);
    await settle();

    const foreverCard = el.querySelector('[data-testid="kid-forever-card"]')!;
    expect(foreverCard.textContent).toContain("All-time unavailable");
    expect(foreverCard.textContent).not.toContain("Level 1");
    expect(foreverCard.textContent).not.toContain("yours to keep");
  });
});
