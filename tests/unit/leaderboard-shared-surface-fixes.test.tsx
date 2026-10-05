// @vitest-environment jsdom
// Shared-surface fixes for the leaderboard podium / rows / sheet / race card.
// Every case here is a place where the SAME week was described two different
// ways — a positional index printed as a rank, a rank that disagreed with the
// competition rank the Tasks page computes, a zero-point week that still
// crowned a champion, a bar drawn for a value that is genuinely zero, and a
// control whose meaning was carried only by colour or height.
//
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act shim (see leaderboard-all-time-labels).
// task-utils imports @/db at module scope, so the roster/gateway are mocked;
// every leaderboard component under test is real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";
import LeaderboardRow from "@/components/leaderboard/LeaderboardRow";
import Podium from "@/components/leaderboard/Podium";
import YourCard from "@/components/leaderboard/YourCard";
import MemberSheet from "@/components/leaderboard/MemberSheet";
import RankArrow from "@/components/leaderboard/RankArrow";
import PrizeRaceCard from "@/components/leaderboard/PrizeRaceCard";
import { useLeaderboardData } from "@/components/leaderboard/hooks/useLeaderboardData";
import { WEEK_DATA_KEY } from "@/lib/task-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn() as any;

// The roster the hook ranks. Five MEMBERS plus a pet, so rows 4+ exist and the
// pet filter is exercised at the same time.
const MEMBERS = [
  { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Caspian", fullName: "Caspian", role: "child", emoji: "🧒", color: "green" },
  { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
  { id: 4, name: "Bailey", fullName: "Bailey", role: "child", emoji: "🧒", color: "rose" },
  { id: 5, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "cyan" },
  { id: 6, name: "Fido", fullName: "Fido", role: "pet", emoji: "🐶", color: "amber" },
];
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => MEMBERS,
    selectHallOfFame: async () => [],
  },
}));

const PRIZES: WeeklyPrize[] = [
  { id: "prize-1", rank: 1, emoji: "🥇", text: "Picks the movie" },
  { id: "prize-2", rank: 2, emoji: "🥈", text: "Chooses dessert" },
  { id: "prize-3", rank: 3, emoji: "🥉", text: "+$2 allowance" },
];
const AUTHORITATIVE = { state: "authoritative", updatedAt: "2026-09-24T10:00:00.000Z" } as const;

// ─── Render harness ─────────────────────────────────────────────────────────
let activeRoot: Root | null = null;
let host: HTMLElement | null = null;

function render(ui: ReactElement): HTMLElement {
  const container = document.createElement("div");
  host = container;
  document.body.appendChild(container);
  act(() => {
    activeRoot = createRoot(container);
    activeRoot.render(ui);
  });
  return container;
}

function renderHook<T>(use: () => T): { result: { current: T } } {
  const result = { current: undefined as T };
  function Probe() {
    result.current = use();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(Probe));
  });
  return { result };
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
function lbEntry(
  name: string,
  points: number,
  rank: number,
  extra: Partial<LeaderboardEntry> = {},
): LeaderboardEntry {
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
    allTimePoints: points,
    allTimeCompletions: 0,
    ...extra,
  };
}

// A five-member field with two ties: 100 / 100 / 60 / 60 / 10.
// Standard competition ranking → 1, 1, 3, 3, 5 (rank 4 belongs to nobody).
const FIELD = [lbEntry("Rebecca", 100, 1), lbEntry("Caspian", 100, 1), lbEntry("Emily", 60, 3), lbEntry("Bailey", 60, 3), lbEntry("Fido", 10, 5)];

function renderRow(entry: LeaderboardEntry, overrides: Record<string, unknown> = {}, handlers: Record<string, unknown> = {}) {
  return render(
    createElement(LeaderboardRow, {
      entry,
      index: 3,
      previousRank: undefined,
      isYou: false,
      getMemberColor: () => "green",
      onAdjust: () => {},
      onOpenSheet: () => {},
      isAdmin: false,
      ...overrides,
      ...handlers,
    } as any),
  );
}

function renderPodium(entries: LeaderboardEntry[], prizes: WeeklyPrize[] = []) {
  return render(
    createElement(Podium, {
      entries,
      prizes,
      previousRanks: {},
      isYou: () => false,
      getMemberColor: () => "green",
      onOpenSheet: () => {},
      onAdjust: () => {},
      isAdmin: false,
      allTimeRead: AUTHORITATIVE,
    } as any),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as any);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/tasks/all-time")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          weekStart: "2026-09-21",
          totals: {},
          historyComplete: true,
          source: "pocketbase",
          fetchedAt: "2026-09-24T10:00:00.000Z",
        }),
      } as any;
    }
    return { ok: false, status: 401, json: async () => ({}) } as any;
  }) as any);
});

afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
  host = null;
  vi.unstubAllGlobals();
});

// ─── A ──────────────────────────────────────────────────────────────────────
// The visible rank badge. The innermost element whose whole text is `#N` is the
// badge itself; `el.textContent` includes the whole row and cannot be compared
// against a rank alone.
function rankBadge(el: HTMLElement): string {
  const nodes = Array.from(el.querySelectorAll<HTMLElement>("*"))
    .map((n) => (n.textContent || "").trim())
    .filter((t) => /^#\d+$/.test(t))
    .sort((a, b) => a.length - b.length);
  return nodes[0] || "";
}

// ═══ A · the row badge prints entry.rank, never the array index ═════════════
describe("A · a rows-4+ badge prints the competition rank, not its position", () => {
  it("a 4th-positioned member whose competition rank is 3 reads #3 (the index used to say #4)", () => {
    const el = renderRow(FIELD[3]);
    expect(rankBadge(el)).toBe("#3");
    // Rank 4 belongs to nobody in this field — the index invented it.
    expect(el.textContent).not.toContain("#4");
  });

  it("the last member's badge is #5, matching entry.rank", () => {
    const el = renderRow(FIELD[4], { index: 4 });
    expect(rankBadge(el)).toBe("#5");
  });

  it("the row badge and YourCard say the same rank", () => {
    const el = renderRow(FIELD[3]);
    expect(rankBadge(el)).toBe("#3");
    // The row's own control names the same rank for a screen reader.
    expect(el.querySelector('[role="button"]')!.getAttribute("aria-label")).toBe("Bailey: 60 points, rank 3");
    // YourCard already printed #entry.rank — the badge now agrees with it.
    const you = render(
      createElement(YourCard, {
        entry: FIELD[3],
        aheadEntry: FIELD[1],
        getMemberColor: () => "green",
        allTimeRead: AUTHORITATIVE,
      }),
    );
    expect(you.textContent).toContain("#3");
  });

  it("every row of the tied field reads its own competition rank, never its position", () => {
    expect(FIELD.map((e) => e.rank)).toEqual([1, 1, 3, 3, 5]);
    FIELD.slice(3).forEach((entry, row) => {
      const el = renderRow(entry, { index: row + 3 });
      expect(rankBadge(el)).toBe(`#${entry.rank}`);
      act(() => {
        activeRoot?.unmount();
      });
      activeRoot = null;
      document.body.innerHTML = "";
    });
  });
});

// ═══ B · a rows-4+ member sheet is a real, named, keyboard-reachable control ══
describe("B · the member sheet opens from rows 4+ by keyboard", () => {
  it("the row is focusable, exposes role=button and names the member and their rank", () => {
    const el = renderRow(FIELD[3]);
    const control = el.querySelector('[role="button"]') as HTMLElement;
    expect(control).not.toBeNull();
    expect(control.tagName).toBe("DIV");
    expect(control.getAttribute("tabindex")).toBe("0");
    expect(control.getAttribute("aria-label")).toBe("Bailey: 60 points, rank 3");
  });

  it("Enter and Space both open the sheet", () => {
    const opened: string[] = [];
    const onOpenSheet = (name: string) => opened.push(name);
    for (const key of ["Enter", " "]) {
      const el = renderRow(FIELD[3], {}, { onOpenSheet });
      const control = el.querySelector('[role="button"]') as HTMLElement;
      act(() => {
        control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
      act(() => {
        activeRoot?.unmount();
      });
      activeRoot = null;
      document.body.innerHTML = "";
    }
    expect(opened).toEqual(["Bailey", "Bailey"]);
  });

  it("Space does not scroll the page (the default is prevented)", () => {
    const el = renderRow(FIELD[3]);
    const control = el.querySelector('[role="button"]') as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      control.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("the admin adjust button does not ALSO open the sheet (the key event bubbles)", () => {
    const opened: string[] = [];
    const el = renderRow(FIELD[3], { isAdmin: true }, { onOpenSheet: (n: string) => opened.push(n) });
    const adjust = el.querySelector('button[aria-label="Adjust points for Bailey"]') as HTMLElement;
    expect(adjust).not.toBeNull();
    act(() => {
      adjust.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(opened).toEqual([]);
  });
});

// The Avatar is the only element on this surface carrying a `ring-2` class
// (Avatar.tsx), and the only one that renders an inline box-shadow — so it is
// the honest handle for "does this avatar glow?".
function avatarGlow(root: ParentNode): string {
  const avatar = root.querySelector('[class*="ring-2"]') as HTMLElement | null;
  return avatar ? (avatar.getAttribute("style") || "") : "";
}

// ═══ C · a zero-point week crowns nobody ════════════════════════════════════
describe("C · a zero-point week has no champion treatment", () => {
  const ZEROS = [lbEntry("Rebecca", 0, 1), lbEntry("Caspian", 0, 1), lbEntry("Emily", 0, 3)];

  it("no pulsing amber plinth, no gold medal and no avatar glow when nobody has scored", () => {
    const el = renderPodium(ZEROS);
    expect(el.innerHTML).not.toContain("animate-rank-pulse");
    expect(el.textContent).not.toContain("🥇");
    // No slot is tinted as a champion plinth, and nobody's avatar glows.
    const slot = el.querySelector('[aria-label^="Rebecca:"]') as HTMLElement;
    expect(slot.className).not.toContain("--color-accent-amber");
    expect(avatarGlow(slot)).toBe("");
  });

  it("control: a week with points still crowns the leader exactly as before", () => {
    const el = renderPodium(FIELD.slice(0, 3));
    expect(el.innerHTML).toContain("animate-rank-pulse");
    expect(el.textContent).toContain("🥇");
    const first = el.querySelector('[aria-label^="Rebecca:"]') as HTMLElement;
    expect(first.className).toContain("--color-accent-amber");
    expect(avatarGlow(first)).toContain("box-shadow");
  });

  it("the members are still listed (the card is honest, not blank)", () => {
    const el = renderPodium(ZEROS);
    expect(el.textContent).toContain("Rebecca");
    expect(el.textContent).toContain("Caspian");
  });

  it("YourCard never says “You're in the lead” on a zero-point week", () => {
    const el = render(
      createElement(YourCard, {
        entry: lbEntry("Rebecca", 0, 1),
        aheadEntry: undefined,
        getMemberColor: () => "green",
        allTimeRead: AUTHORITATIVE,
      }),
    );
    expect(el.textContent).not.toContain("in the lead");
    expect(el.textContent).not.toContain("👑");
    // The honest line replaces the crown.
    expect(el.textContent).toContain("Complete tasks to climb the board!");
  });

  it("control: a rank-1 member WITH points is still told they're in the lead", () => {
    const el = render(
      createElement(YourCard, {
        entry: lbEntry("Rebecca", 30, 1),
        aheadEntry: undefined,
        getMemberColor: () => "green",
        allTimeRead: AUTHORITATIVE,
      }),
    );
    expect(el.textContent).toContain("👑 You're in the lead!");
  });

  it("the member sheet's avatar glows for a real champion only", () => {
    const glow = (points: number, rank: number) => {
      render(
        createElement(MemberSheet, {
          open: true,
          entry: { name: "Emily", emoji: "👧", streak: 0, rank, points, levelKnown: true, levelEmoji: "🌱", levelTitle: "Rookie", badges: [] },
          allTimePoints: 10,
          allTimeComps: 1,
          weeklyPoints: points,
          pendingTasks: [],
          affordableRewards: [],
          weekGraph: [],
          onClose: () => {},
          getMemberColor: () => "rose",
          allTimeRead: AUTHORITATIVE,
        }),
      );
      // The sheet renders through Modal's portal into document.body.
      const style = avatarGlow(document.body);
      act(() => {
        activeRoot?.unmount();
      });
      activeRoot = null;
      document.body.innerHTML = "";
      return style;
    };
    expect(glow(0, 1)).toBe("");
    expect(glow(30, 1)).toContain("box-shadow");
  });
});

// ═══ D · a known zero is drawn as zero ══════════════════════════════════════
describe("D · a genuinely zero value draws no bar", () => {
  it("a row member sitting exactly on the level threshold shows no progress fill", () => {
    const el = renderRow(lbEntry("Emily", 10, 3, { progressToNext: 0 }));
    expect(el.querySelector(".animate-progress-fill")).toBeNull();
  });

  it("control: real progress still renders the fill at its width", () => {
    const el = renderRow(lbEntry("Emily", 10, 3, { progressToNext: 42 }));
    const fill = el.querySelector(".animate-progress-fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("42%");
  });

  it("an UNKNOWN level still renders no fill (unchanged)", () => {
    const el = renderRow(lbEntry("Emily", 10, 3, { levelKnown: false, progressToNext: 0 }));
    expect(el.querySelector(".animate-progress-fill")).toBeNull();
  });

  it("the sheet's level bar follows the same rule: a known 0% draws no fill", () => {
    const sheetFill = (allTimePoints: number | null) => {
      render(
        createElement(MemberSheet, {
          open: true,
          entry: { name: "Emily", emoji: "👧", streak: 0, rank: 3, points: 20, levelKnown: true, levelEmoji: "🌱", levelTitle: "Rookie", badges: [] },
          allTimePoints,
          allTimeComps: allTimePoints === null ? null : 1,
          weeklyPoints: 20,
          pendingTasks: [],
          affordableRewards: [],
          weekGraph: [],
          onClose: () => {},
          getMemberColor: () => "rose",
          allTimeRead: AUTHORITATIVE,
        }),
      );
      const fills = document.body.querySelectorAll(".animate-progress-fill");
      const width = (fills[0] as HTMLElement | undefined)?.style.width || "";
      act(() => {
        activeRoot?.unmount();
      });
      activeRoot = null;
      document.body.innerHTML = "";
      return width;
    };
    // A brand-new member is exactly on the level floor: 0% progress, no sliver.
    expect(sheetFill(0)).toBe("");
    // So is a member sitting EXACTLY on the next threshold (300 = "Star
    // Performer" floor → 0% of the way to 500).
    expect(sheetFill(300)).toBe("");
    // An unknown total stays unknown (never 0, never a bar).
    expect(sheetFill(null)).toBe("");
    // Real progress still renders.
    expect(sheetFill(400)).toBe("50%");
  });

  it("a zero-point day in the week graph draws no bar; a scored day still does", () => {
    render(
      createElement(MemberSheet, {
        open: true,
        entry: { name: "Emily", emoji: "👧", streak: 0, rank: 3, points: 20, levelKnown: true, levelEmoji: "🌱", levelTitle: "Rookie", badges: [] },
        allTimePoints: 20,
        allTimeComps: 1,
        weeklyPoints: 20,
        pendingTasks: [],
        affordableRewards: [],
        weekGraph: [
          { day: "Mon", points: 0 },
          { day: "Tue", points: 10 },
          { day: "Wed", points: 0 },
        ],
        onClose: () => {},
        getMemberColor: () => "rose",
        allTimeRead: AUTHORITATIVE,
      }),
    );
    const body = document.body;
    const graph = body.querySelector('[role="img"]') as HTMLElement;
    expect(graph.getAttribute("aria-label")).toContain("Mon 0 points");
    const bars = body.querySelectorAll('[data-week-bar="true"]');
    // Only the scored day draws a bar.
    expect(bars).toHaveLength(1);
    expect((bars[0] as HTMLElement).getAttribute("data-week-day")).toBe("Tue");
    // The day labels survive for every day (the graph keeps its axis).
    expect(graph.textContent).toContain("Mon");
    expect(graph.textContent).toContain("Tue");
    expect(graph.textContent).toContain("Wed");
  });
});

// ═══ E · the rank arrow and the week graph carry their values ════════════════
describe("E · rank arrows and the week graph have accessible names", () => {
  it("an upward arrow names the number of places gained (plural)", () => {
    const el = render(createElement(RankArrow, { currentRank: 3, previousRank: 5 }));
    const arrow = el.querySelector('[role="img"]') as HTMLElement;
    expect(arrow.getAttribute("aria-label")).toBe("Up 2 places since last week");
  });

  it("a single place is singular", () => {
    const el = render(createElement(RankArrow, { currentRank: 4, previousRank: 5 }));
    expect(el.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Up 1 place since last week");
  });

  it("a downward arrow names the number of places lost", () => {
    const el = render(createElement(RankArrow, { currentRank: 5, previousRank: 3 }));
    expect(el.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Down 2 places since last week");
  });

  it("no previous rank is an honest “new this week”, never a bare dash", () => {
    const el = render(createElement(RankArrow, { currentRank: 2, previousRank: undefined }));
    const arrow = el.querySelector('[role="img"]') as HTMLElement;
    expect(arrow.getAttribute("aria-label")).toBe("No rank last week");
  });

  it("an unchanged rank says so", () => {
    const el = render(createElement(RankArrow, { currentRank: 2, previousRank: 2 }));
    expect(el.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Rank unchanged since last week");
  });

  it("the week graph enumerates every day/point pair in its accessible name", () => {
    render(
      createElement(MemberSheet, {
        open: true,
        entry: { name: "Emily", emoji: "👧", streak: 0, rank: 3, points: 20, levelKnown: true, levelEmoji: "🌱", levelTitle: "Rookie", badges: [] },
        allTimePoints: 20,
        allTimeComps: 1,
        weeklyPoints: 20,
        pendingTasks: [],
        affordableRewards: [],
        weekGraph: [
          { day: "Mon", points: 0 },
          { day: "Tue", points: 10 },
          { day: "Wed", points: 5 },
        ],
        onClose: () => {},
        getMemberColor: () => "rose",
        allTimeRead: AUTHORITATIVE,
      }),
    );
    const graph = document.body.querySelector('[role="img"]') as HTMLElement;
    const label = graph.getAttribute("aria-label") || "";
    expect(label).toContain("Mon 0 points");
    expect(label).toContain("Tue 10 points");
    expect(label).toContain("Wed 5 points");
  });
});

// ═══ F · a zero-point member holding a prize rank is told the truth ══════════
describe("F · a 0-point member who holds a prize rank is not told to join the race", () => {
  // The finding's scenario, extended so a rank-3 threshold EXISTS: two members
  // tied on 100 both hold rank 1, a third holds rank 2, and the 0-point member's
  // competition rank is 1 + 3 = 4. With 3 prizes their rank is a prize rank and
  // the rank-3 holder's 60 pts is a real distance to the last prize.
  const PRIZE_RANK_ZERO = [
    lbEntry("Rebecca", 100, 1),
    lbEntry("Caspian", 100, 1),
    lbEntry("Emily", 60, 2),
    lbEntry("Bailey", 0, 4),
  ];

  it("the personal line is the honest gap, never “Earn points to join this week's race!”", () => {
    const el = render(
      createElement(PrizeRaceCard, {
        prizes: PRIZES,
        entries: PRIZE_RANK_ZERO,
        daysUntilReset: 4,
        myName: "Bailey",
      }),
    );
    const line = el.querySelector("[aria-live='polite']") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).not.toContain("join this week's race");
    expect(line.textContent).toContain("60 pts from a prize");
  });

  it("a 0-point member is never promised a prize spot they hold nothing of", () => {
    // A 2-way tie at the top leaves the rank-2 prize with no holder, so Bailey
    // (0 pts, rank 3) has no measurable threshold — the card must not invent
    // one, and must not call them a prize-spot holder either.
    const el = render(
      createElement(PrizeRaceCard, {
        prizes: PRIZES,
        entries: [lbEntry("Rebecca", 100, 1), lbEntry("Caspian", 100, 1), lbEntry("Bailey", 0, 3)],
        daysUntilReset: 4,
        myName: "Bailey",
      }),
    );
    expect(el.textContent).not.toContain("You're in a prize spot");
    expect(el.textContent).not.toContain("You're in the lead");
    const rows = Array.from(el.querySelectorAll("li"));
    expect(rows).toHaveLength(3);
    // Rank 1 is genuinely held; ranks 2 and 3 are unheld — and 0 pts holds none.
    expect(rows[0].textContent).toContain("Rebecca");
    expect(rows[1].textContent).toContain("Up for grabs");
    expect(rows[2].textContent).toContain("Up for grabs");
    for (const row of rows) expect(row.textContent).not.toContain("Bailey");
  });

  it("the card's own list calls an unheld prize slot “Up for grabs” (0 pts holds nothing)", () => {
    const el = render(
      createElement(PrizeRaceCard, {
        prizes: PRIZES,
        entries: PRIZE_RANK_ZERO,
        daysUntilReset: 4,
        myName: "Bailey",
      }),
    );
    const rows = Array.from(el.querySelectorAll("li"));
    // 100/100/60/0 → ranks 1, 1, 3, 4: the top tie SKIPS rank 2 entirely, so
    // the 🥈 prize has no holder at all while the 🥉 one does (Emily).
    expect(rows.find((li) => (li.textContent || "").includes("Picks the movie"))!.textContent).toContain("Rebecca");
    expect(rows.find((li) => (li.textContent || "").includes("Chooses dessert"))!.textContent).toContain("Up for grabs");
    expect(rows.find((li) => (li.textContent || "").includes("+$2 allowance"))!.textContent).toContain("Emily");
    // Bailey scored nothing, so Bailey holds nothing.
    for (const row of rows) expect(row.textContent).not.toContain("Bailey");
  });

  it("control: a 0-point member outside every prize rank is told the same honest thing", () => {
    const el = render(
      createElement(PrizeRaceCard, {
        prizes: PRIZES,
        entries: [lbEntry("Rebecca", 30, 1), lbEntry("Emily", 20, 2), lbEntry("Caspian", 10, 3), lbEntry("Bailey", 0, 4)],
        daysUntilReset: 4,
        myName: "Bailey",
      }),
    );
    const line = el.querySelector("[aria-live='polite']") as HTMLElement;
    expect(line.textContent).toContain("10 pts from a prize");
    expect(line.textContent).not.toContain("join this week's race");
  });
});

// ═══ G · the countdown never claims the reset is tonight ════════════════════
describe("G · the reset countdown has no dead “tonight” arm", () => {
  it("no value of daysUntilReset renders “Resets tonight!”", () => {
    for (let days = 0; days <= 7; days++) {
      const el = render(
        createElement(PrizeRaceCard, { prizes: PRIZES, entries: [lbEntry("Rebecca", 10, 1)], daysUntilReset: days }),
      );
      expect(el.textContent).not.toContain("Resets tonight!");
      act(() => {
        activeRoot?.unmount();
      });
      activeRoot = null;
      document.body.innerHTML = "";
    }
  });

  it("the helper's 1..7 range renders tomorrow / N days", () => {
    const one = render(createElement(PrizeRaceCard, { prizes: PRIZES, entries: [lbEntry("Rebecca", 10, 1)], daysUntilReset: 1 }));
    expect(one.textContent).toContain("⏳ Resets tomorrow");
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";

    const four = render(createElement(PrizeRaceCard, { prizes: PRIZES, entries: [lbEntry("Rebecca", 10, 1)], daysUntilReset: 4 }));
    expect(four.textContent).toContain("⏳ Resets in 4 days");
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";

    const seven = render(createElement(PrizeRaceCard, { prizes: PRIZES, entries: [lbEntry("Rebecca", 10, 1)], daysUntilReset: 7 }));
    expect(seven.textContent).toContain("⏳ Resets in 7 days");
  });
});

// ═══ K · the hook ranks like the Tasks page ═════════════════════════════════
describe("K · useLeaderboardData assigns standard competition ranks", () => {
  function thisMondayISO(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function seedWeek(points: Record<string, number>) {
    localStorage.setItem(
      WEEK_DATA_KEY,
      JSON.stringify({ weekStart: thisMondayISO(), points, streak: {}, lastActive: {}, history: [] }),
    );
  }

  it("a 100/100/60/60/10 field ranks 1, 1, 3, 3, 5 — never ordinal 1..5", async () => {
    seedWeek({ Rebecca: 100, Caspian: 100, Emily: 60, Bailey: 60, Jasmine: 10 });
    const { result } = renderHook(() => useLeaderboardData());
    const ranks = Object.fromEntries(result.current.data.entries.map((e) => [e.name, e.rank]));

    expect(ranks).toEqual({ Caspian: 1, Rebecca: 1, Bailey: 3, Emily: 3, Jasmine: 5 });

    await settle();
  });

  it("matches the Tasks page's documented convention exactly (src/app/tasks/page.tsx)", async () => {
    seedWeek({ Rebecca: 100, Caspian: 100, Emily: 60, Bailey: 60, Jasmine: 10 });
    const { result } = renderHook(() => useLeaderboardData());
    const entries = result.current.data.entries;

    // The page's own rule, applied over the same sorted rows: a tie shares the
    // previous rank, and any new group takes its position + 1 (page.tsx:2120-2124).
    // NOTE: the page's literal expression reads the previous row's `rank` off
    // the array it is mapping — the `rank: 0` placeholder — so a tied row there
    // prints "#0". The reference below carries the rank instead, which is what
    // the page's own comment describes.
    const byPointsDesc = [...entries].sort((a, b) => b.points - a.points);
    let lastPoints: number | null = null;
    let lastRank = 0;
    const pageRanks = new Map(
      byPointsDesc.map((e, i) => {
        const rank = lastPoints !== null && e.points === lastPoints ? lastRank : i + 1;
        lastPoints = e.points;
        lastRank = rank;
        return [e.name, rank];
      }),
    );

    for (const entry of entries) {
      expect(entry.rank).toBe(pageRanks.get(entry.name));
    }

    await settle();
  });

  it("every rank is the count of strictly-better members plus one (never a position)", async () => {
    seedWeek({ Rebecca: 100, Caspian: 100, Emily: 60, Bailey: 60, Jasmine: 10 });
    const { result } = renderHook(() => useLeaderboardData());
    const entries = result.current.data.entries;

    for (const entry of entries) {
      const strictlyBetter = entries.filter((o) => o.points > entry.points).length;
      expect(entry.rank).toBe(1 + strictlyBetter);
    }
    // Nobody is ever ranked 4 here: two members hold rank 3, so 4 is skipped.
    expect(entries.map((e) => e.rank)).not.toContain(4);

    await settle();
  });
});