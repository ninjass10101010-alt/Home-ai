// @vitest-environment jsdom
// Final PRODUCTION follow-ups on the task-adjacent surfaces (A–E).
//
//   A  KidHome week-reset countdown  — the `daysToReset <= 0` arm is dead
//      (getDaysUntilWeekReset() is 1..7 BY CONSTRUCTION, Monday → 7).
//   B  HomeLeaderboardWidget          — amber token (never a raw hex),
//      standard competition ranking (1,1,3,3,5 — same as the Tasks page and
//      useLeaderboardData), and a crown that only lands on a scoring week.
//   C  mapRewardIdeas                — duplicate titles collapse to ONE card.
//   D  buildAllTimeTotals            — a stored-only member name is unknown
//      (null), never a confident 0.
//   E  task-approval                 — the vestigial PreparedTask.needsLedger.
//
// Harness: createRoot + act (no @testing-library/react in this repo — see
// tests/unit/home-widget-race-line.test.tsx). useLeaderboardData + auth + the
// roster are mocked; task-utils stays REAL except for the countdown stub test
// A needs, so raceGap / resolveMemberName / prize storage run production code
// against jsdom localStorage.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const countdown = vi.hoisted(() => ({ days: 3 }));
vi.mock("@/lib/task-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-utils")>();
  return { ...actual, getDaysUntilWeekReset: () => countdown.days };
});

const lbHook = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/components/leaderboard/hooks/useLeaderboardData", () => ({
  useLeaderboardData: () => ({ data: lbHook.data, mounted: true }),
}));

const authMock = vi.hoisted(() => ({
  currentUser: null as null | { name: string; role: string; age?: number; emoji?: string; color?: string },
  isLoggedIn: false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: authMock.currentUser, isLoggedIn: authMock.isLoggedIn }),
}));

vi.mock("@/db", () => ({
  db: {
    // selectMembers().name is the FIRST name / fullName the FULL name (the
    // ledger keyspace); selectMembersDetailed().name is already the full name
    // (what KidHome's own roster read resolves against).
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

// ── KidHome harness (mirrors tests/unit/kid-home-race-line.test.tsx) ────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});
vi.mock("@/hooks/useWallMode", () => ({
  useWallMode: () => ({ wall: false, mounted: true }),
}));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({
    mode: "kid", isBedtime: false, isWeekend: false,
    currentHour: 12, currentDay: 3, previousMode: null,
  }),
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

import HomeLeaderboardWidget from "@/components/leaderboard/HomeLeaderboardWidget";
import KidHome from "@/modes/kid/KidHome";
import { mapRewardIdeas } from "@/lib/ai-suggestions";
import { buildAllTimeTotals } from "@/lib/all-time-totals";
import { WEEK_DATA_KEY, TASKS_STORAGE_KEY, WEEKLY_PRIZES_KEY } from "@/lib/task-utils";
import { localWeekStartISO } from "@/lib/local-date";

const KID = { name: "Caspian", role: "child", age: 10, emoji: "🧒", color: "green" };

const PRIZES = [
  { id: "p1", rank: 1, emoji: "🥇", text: "Movie pick" },
  { id: "p2", rank: 2, emoji: "🥈", text: "Dessert choice" },
];

function entry(name: string, points: number, rank: number) {
  return { name, points, rank, emoji: "🙂", color: "green", streak: 0 };
}

function seedLeaderboard(entries: ReturnType<typeof entry>[]) {
  lbHook.data = {
    entries,
    weekData: { weekStart: localWeekStartISO(), points: {}, streak: {}, lastActive: {}, history: [] },
    tasks: [],
    daysUntilReset: 3,
    previousRanks: {},
    hall: [],
    allTime: { state: "loading", updatedAt: null },
  };
}

function seedWeek(points: Record<string, number>) {
  localStorage.setItem(
    WEEK_DATA_KEY,
    JSON.stringify({ weekStart: localWeekStartISO(), points, streak: {}, lastActive: {}, history: [] }),
  );
}

let activeRoot: Root | null = null;

async function render(ui: any): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(ui));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  countdown.days = 3;
  authMock.currentUser = null;
  authMock.isLoggedIn = false;
  localStorage.setItem(WEEKLY_PRIZES_KEY, JSON.stringify(PRIZES));
  localStorage.setItem(TASKS_STORAGE_KEY, "[]");
  seedWeek({ "Caspian Garcia": 10, "Emily Garcia": 50, "Bailey Garcia": 30, "Rebecca Garcia": 40 });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

// ── A ────────────────────────────────────────────────────────────────────────
describe("A — KidHome week-reset countdown", () => {
  async function countdownLine(days: number): Promise<string> {
    countdown.days = days;
    authMock.currentUser = KID;
    authMock.isLoggedIn = true;
    const el = await render(KidHome);
    const card = el.querySelector('[data-testid="kid-week-card"]');
    expect(card).not.toBeNull();
    // The countdown is the card's own copy line under the points figure.
    return Array.from(card!.querySelectorAll("p"))
      .map((p) => p.textContent || "")
      .join(" | ");
  }

  it('never renders "Resets tonight!" for any value the countdown can return', async () => {
    // getDaysUntilWeekReset() is 1..7 by construction, so 0 (and anything ≤ 0)
    // has no state to render. Nothing may fabricate one either.
    for (const days of [0, -1, -7, 1, 2, 3, 4, 5, 6, 7, 8, 14]) {
      const line = await countdownLine(days);
      expect(line, `days=${days}`).not.toContain("Resets tonight!");
      expect(line, `days=${days}`).not.toContain("NaN");
    }
  });

  it("renders the honest wording for both ends of the 1..7 range", async () => {
    expect(await countdownLine(1)).toContain("Resets tomorrow");
    expect(await countdownLine(7)).toContain("Resets in 7 days");
    expect(await countdownLine(3)).toContain("Resets in 3 days");
  });
});

// ── B ────────────────────────────────────────────────────────────────────────
describe("B — HomeLeaderboardWidget", () => {
  it("uses the amber TOKEN, never a raw hex tone (a light theme re-tints it)", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/leaderboard/HomeLeaderboardWidget.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/tone="#/);
    expect(source).toContain('tone="var(--color-accent-amber)"');
    // Every tone in the file is a token or an empty string.
    for (const tone of source.match(/tone="[^"]*"/g) || []) {
      expect(tone === 'tone=""' || tone.includes("var(--"), tone).toBe(true);
    }
  });

  it("renders standard competition ranks (1, 1, 3, 3) — the hook's shared convention, not i+1", async () => {
    // 100/100/60/60/10 ranks 1, 1, 3, 3, 5 under the ONE convention the Tasks
    // page and useLeaderboardData share (a tie repeats the previous rank and the
    // next rank is SKIPPED). The widget must display the rank it is handed; it
    // must never re-derive an ordinal from the row index.
    seedLeaderboard([
      entry("Caspian Garcia", 100, 1),
      entry("Emily Garcia", 100, 1),
      entry("Bailey Garcia", 60, 3),
      entry("Rebecca Garcia", 60, 3),
      entry("Jasmine Garcia", 10, 5),
    ]);
    const el = await render(HomeLeaderboardWidget);
    // Row scope only — the prize race line legitimately prints 🥇 🥈 as prize
    // medals, so the placement medals must be read off the board rows. The
    // assertive part is the rounded-border row class, not the exact padding
    // (the wall build tightens row padding to fit the 350px cell).
    const rows = Array.from(el.querySelectorAll("div"))
      .filter((d) => /rounded-2xl border/.test(d.className) && /px-3 py-/.test(d.className) && d.textContent?.includes("pts"))
      .map((d) => (d.textContent || "").replace(/\s+/g, "").trim());
    expect(rows).toHaveLength(4);
    // Two tied leaders → two gold medals; the next tied pair is rank 3.
    expect(rows[0].startsWith("🥇")).toBe(true);
    expect(rows[0]).toContain("Caspian100pts");
    expect(rows[1].startsWith("🥇")).toBe(true);
    expect(rows[1]).toContain("Emily100pts");
    expect(rows[2].startsWith("🥉")).toBe(true);
    expect(rows[2]).toContain("Bailey60pts");
    expect(rows[3].startsWith("#3")).toBe(true);
    expect(rows[3]).toContain("Rebecca60pts");
    expect(rows.join(" ")).not.toMatch(/#2|#4/);
    // The 5th member stays behind the cell's "+N more" footer (no spill).
    const text = (el.textContent || "").replace(/\s+/g, " ");
    expect(text).toContain("+1 more");
    expect(text).not.toContain("Jasmine");
  });

  it("crowns nobody on a zero-point week", async () => {
    seedLeaderboard([
      entry("Caspian Garcia", 0, 1),
      entry("Emily Garcia", 0, 1),
      entry("Bailey Garcia", 0, 1),
    ]);
    const el = await render(HomeLeaderboardWidget);
    // The honest zero state, exactly like the Tasks page's "up for grabs".
    expect(el.textContent).toContain("Be the first!");
    expect(el.textContent).not.toContain("Leading!");
    expect(el.textContent).not.toContain("👑 Leading");
  });

  it("never crowns a rank-1 entry that holds no points", async () => {
    // A rank is only meaningful once somebody scored: a member whose points are
    // missing cannot outrank anybody, so it lands on rank 1 on a week where
    // others did score. That is not a lead, and it must not print one.
    seedLeaderboard([
      { ...entry("Caspian Garcia", 0, 1), points: undefined as unknown as number },
      entry("Emily Garcia", 30, 2),
    ]);
    authMock.currentUser = KID;
    authMock.isLoggedIn = true;
    const el = await render(HomeLeaderboardWidget);
    expect(el.textContent).not.toContain("Leading!");
  });

  it("still crowns the leader's rank-1 row on a week that has points", async () => {
    // Complementary contract to the zero-week case above: the points guard must
    // not over-correct into NEVER crowning. The crown under the current layout is
    // the rank-1 podium row's amber champion styling (the old "👑 Leading!" line
    // was dead once the `You:` banner became rank > 3, and was removed).
    seedLeaderboard([
      entry("Caspian Garcia", 50, 1),
      entry("Emily Garcia", 30, 2),
    ]);
    authMock.currentUser = KID;
    authMock.isLoggedIn = true;
    const el = await render(HomeLeaderboardWidget);
    const rows = Array.from(el.querySelectorAll("div"))
      .filter((d) => /rounded-2xl border/.test(d.className) && d.textContent?.includes("Caspian"));
    expect(rows.length).toBe(1);
    expect(rows[0].className).toContain("bg-[var(--color-accent-amber)]/10");
  });
});

// ── C ────────────────────────────────────────────────────────────────────────
describe("C — AI reward suggestions", () => {
  const DUPLICATE_IDEAS = [
    { type: "reward", title: "Movie night", emoji: "🍿", points: 20 },
    { type: "reward", title: "  movie   NIGHT ", emoji: "🎬", points: 35 },
    { type: "reward", title: "Extra bedtime", emoji: "🌙", points: 15 },
  ];

  it("collapses same-titled ideas to one card, keeping the first suggestion and its id", () => {
    const out = mapRewardIdeas(DUPLICATE_IDEAS);
    expect(out.map((r) => r.name)).toEqual(["Movie night", "Extra bedtime"]);
    expect(out[0].cost).toBe(20);
    expect(out[0].emoji).toBe("🍿");
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  });

  it("adopting one idea removes exactly that one — no silently dropped duplicate", () => {
    // The page's adopt seam: `setAiRewards(prev => prev.filter(rr => rr.name !== r.name))`.
    const out = mapRewardIdeas(DUPLICATE_IDEAS);
    const adopting = out[0];
    const remaining = out.filter((rr) => rr.name !== adopting.name);
    expect(remaining.map((r) => r.name)).toEqual(["Extra bedtime"]);
    expect(remaining).toHaveLength(1);
  });
});

// ── D ────────────────────────────────────────────────────────────────────────
describe("D — all-time totals member seeding", () => {
  const HISTORY = [
    { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
  ];
  const current = (points: Record<string, number>) =>
    ({ weekStart: "2026-09-21", points, streak: {}, lastActive: {}, history: HISTORY }) as any;

  it("a stored-only name (renamed member / phantom) is unknown, never a confident 0", () => {
    const payload = buildAllTimeTotals(current({ "Member A": 5, "Old Name": 12 }), [], ["Member A"]);
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Old Name"]).not.toEqual({ points: 0, completions: 0 });
    expect(payload.totals["Old Name"]?.points).toBeNull();
    expect(payload.totals["Old Name"]?.completions).toBeNull();
    // The real member's arithmetic is untouched.
    expect(payload.totals["Member A"]).toEqual({ points: 5, completions: 1 });
  });

  it("a roster member with no history at all still earns a real zero", () => {
    const payload = buildAllTimeTotals(current({}), [], ["Member A", "Brand New"]);
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals["Brand New"]).toEqual({ points: 0, completions: 0 });
  });
});

// ── E ────────────────────────────────────────────────────────────────────────
describe("E — vestigial PreparedTask.needsLedger", () => {
  it("no needsLedger field, assignment or reader remains in task-approval.ts", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/task-approval.ts"), "utf8");
    expect(source).not.toContain("needsLedger");
    // The dead local that only fed it goes with it.
    expect(source).not.toContain("hasCurrentTransactions");
  });
});