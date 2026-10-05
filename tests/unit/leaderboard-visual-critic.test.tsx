// @vitest-environment jsdom
// Visual-critic findings for the leaderboard surfaces (round 1–4 audit).
//
// Every case here is a defect that was MEASURED on the running app, not a
// style opinion:
//
//  1. A member on ZERO points wore a silver medal. `rankOf(0)` is
//     `1 + (members with points > 0)`, so a family where exactly one member
//     scored gave every 0-point member rank 2 — the podium said 🥈 while the row
//     badge two inches below and the prize card's "Up for grabs" said nothing
//     was held.
//  2. Two members TIED at the same rank were drawn on two different plinth
//     heights (keyed to the array index), so the staircase itself claimed a
//     placing the badge says does not exist.
//  3. The plinth heights were FIXED heights on the wrapper column, so every card
//     overflowed its own plinth (measured 208/224/208px cards inside 170/200/
//     150px columns) and the three bottoms landed 24–58px apart.
//  4. The "You" chip used the roster colour — a CSS keyword like `green` — as
//     its TEXT colour: `color: green` measured 1.87:1 in dark and 3.48:1 in
//     light, both under AA, and `${color}25` is not a valid colour so the chip
//     had no fill at all.
//  5. The row concatenated the level name and its percentage, which wrapped and
//     orphaned "46%" onto a line of its own under the bar.
//  6. The sheet said "100% to next" at the top level, where `next` is null and
//     there is no next level to be 100% of the way to.
//  7. The sheet's redeem chips were focusable no-ops (Chip defaults to
//     `as="button"`), and the shared dialog-a11y hook focuses the FIRST
//     focusable in the panel — so opening the sheet scrolled its own header and
//     week graph out of view (measured scrollTop 312).
//  8. The rank arrows and the streak/crown text used the RAW accents, which
//     measured 3.49–3.54:1 at 12px; the `-ink-` accents are the readable form.
//  9. Home resolved the signed-in member with a PREFIX match (the exact bug the
//     Tasks page documents for "Alex Garcia" / "Alexandra Garcia") and read the
//     member ahead as `entries[rank - 2]`, which is the wrong index under
//     competition ranking.
//
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act shim (see leaderboard-shared-surface-
// fixes). task-utils imports @/db at module scope, so the roster is mocked.
import { describe, it, expect, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";
import Podium from "@/components/leaderboard/Podium";
import LeaderboardRow from "@/components/leaderboard/LeaderboardRow";
import MemberSheet from "@/components/leaderboard/MemberSheet";
import RankArrow from "@/components/leaderboard/RankArrow";
import PrizeRaceCard from "@/components/leaderboard/PrizeRaceCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn() as any;

const MEMBERS = [
  { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Caspian", fullName: "Caspian", role: "child", emoji: "🧒", color: "green" },
  { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
  { id: 4, name: "Bailey", fullName: "Bailey", role: "child", emoji: "🧒", color: "rose" },
  { id: 5, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "cyan" },
];
vi.mock("@/db", () => ({
  db: { selectMembers: () => MEMBERS, selectHallOfFame: async () => [] },
}));

const PRIZES: WeeklyPrize[] = [
  { id: "prize-1", rank: 1, emoji: "🥇", text: "Picks the movie" },
  { id: "prize-2", rank: 2, emoji: "🥈", text: "Chooses dessert" },
  { id: "prize-3", rank: 3, emoji: "🥉", text: "+$2 allowance" },
];
const AUTHORITATIVE = { state: "authoritative", updatedAt: "2026-09-24T10:00:00.000Z" } as const;

let activeRoot: Root | null = null;

function renderBody(ui: ReactElement): HTMLElement {
  render(ui);
  return document.body;
}

function render(ui: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    activeRoot = createRoot(container);
    activeRoot.render(ui);
  });
  return container;
}

function lbEntry(name: string, points: number, rank: number, extra: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
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
    allTimePoints: points + 40,
    allTimeCompletions: 3,
    ...extra,
  } as LeaderboardEntry;
}

function renderPodium(entries: LeaderboardEntry[], prizes: WeeklyPrize[] = PRIZES) {
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
      allTimeRead: AUTHORITATIVE as any,
    } as any),
  );
}

const cards = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role="button"][aria-label*="points, rank"]'));

describe("leaderboard visual critic — podium honesty", () => {
  it("gives a member on ZERO points no medal, even though their competition rank is 2", () => {
    // Emily alone has scored, so both trailing members rank 2 by competition
    // ranking. A medal there is a placing they did not earn.
    const host = renderPodium([
      lbEntry("Emily", 34, 1),
      lbEntry("Rebecca", 0, 2),
      lbEntry("Caspian", 0, 2),
    ]);
    const byLabel = new Map(cards(host).map((c) => [c.getAttribute("aria-label") || "", c.textContent || ""]));
    expect(byLabel.get("Emily: 34 points, rank 1")).toContain("🥇");
    expect(byLabel.get("Rebecca: 0 points, rank 2") || "").not.toContain("🥈");
    expect(byLabel.get("Caspian: 0 points, rank 2") || "").not.toContain("🥈");
  });

  it("puts members who SHARE a rank on the same plinth height", () => {
    const host = renderPodium([
      lbEntry("Emily", 50, 1),
      lbEntry("Rebecca", 50, 1),
      lbEntry("Caspian", 50, 1),
    ]);
    // A three-way tie for first: all three are rank 1, so none may be drawn a
    // step above or below another.
    const mins = cards(host).map((c) => {
      const cls = c.className.match(/min-h-\[\d+px\]/)?.[0] || "";
      return cls;
    });
    expect(mins).toHaveLength(3);
    expect(new Set(mins).size).toBe(1);
  });

  it("keeps a DIFFERENT plinth height for different ranks", () => {
    const host = renderPodium([
      lbEntry("Emily", 60, 1),
      lbEntry("Rebecca", 40, 2),
      lbEntry("Caspian", 20, 3),
    ]);
    const mins = cards(host).map((c) => c.className.match(/min-h-\[\d+px\]/)?.[0] || "");
    expect(new Set(mins).size).toBe(3);
  });

  it("carries the plinth height as a MINIMUM on the card, never a fixed height on a wrapper", () => {
    const host = renderPodium([lbEntry("Emily", 60, 1), lbEntry("Rebecca", 40, 2), lbEntry("Caspian", 20, 3)]);
    // A fixed `h-[…]` on the column is what let a 224px card sit in a 200px
    // column. The step must be `min-h-` and must be ON the card.
    // `\bh-` also matches inside `min-h-`, so the fixed-height probe excludes it.
    expect(host.innerHTML).not.toMatch(/(?<!min-)\bh-\[\d+px\]/);
    for (const card of cards(host)) {
      expect(card.className).toMatch(/min-h-\[\d+px\]/);
    }
  });

  it("crowns nobody on a zero-point week", () => {
    const host = renderPodium([
      lbEntry("Emily", 0, 1),
      lbEntry("Rebecca", 0, 1),
      lbEntry("Caspian", 0, 1),
    ]);
    for (const card of cards(host)) {
      expect(card.textContent || "").not.toMatch(/[🥇🥈🥉]/);
    }
    expect(host.innerHTML).not.toContain("animate-rank-pulse");
  });

  it("keeps the medal out of the avatar's box", () => {
    const host = renderPodium([lbEntry("Emily", 60, 1), lbEntry("Rebecca", 40, 2)]);
    // The medal was `absolute -top-3`, which measured a 24×12px overlap with the
    // avatar. It now lives inside a reserved `pt-8` band at the top.
    const medal = host.querySelector(".animate-crown-glow");
    const card = medal?.closest('[role="button"]') as HTMLElement | null;
    expect(medal).toBeTruthy();
    expect(card).toBeTruthy();
    expect(card?.className).toMatch(/pt-8/);
    expect((medal as HTMLElement).className).toMatch(/top-0/);
    expect((medal as HTMLElement).className).not.toMatch(/-top-/);
  });
});

describe("leaderboard visual critic — row legibility", () => {
  const renderRow = (entry: LeaderboardEntry, overrides: Record<string, unknown> = {}) =>
    render(
      createElement(LeaderboardRow, {
        entry,
        previousRank: undefined,
        isYou: false,
        getMemberColor: () => "green",
        onAdjust: () => {},
        onOpenSheet: () => {},
        isAdmin: false,
        ...overrides,
      } as any),
    );

  it("never uses the roster colour as TEXT colour for the You chip", () => {
    const host = renderRow(lbEntry("Emily", 24, 4), { isYou: true });
    const chip = Array.from(host.querySelectorAll("span")).find((s) => (s.textContent || "").trim() === "You");
    expect(chip).toBeTruthy();
    const style = chip?.getAttribute("style") || "";
    // `color: green` measured 1.87:1 dark / 3.48:1 light.
    expect(style).not.toMatch(/(^|;)\s*color\s*:/);
    expect(chip?.className).toMatch(/text-text-primary/);
    expect(style).toMatch(/background/);
  });

  it("puts the level percentage beside the bar instead of in the level sentence", () => {
    const host = renderRow(lbEntry("Emily", 24, 4, { progressToNext: 46, levelTitle: "Task Scout", levelEmoji: "⭐" }));
    // `Task Scout → 46%` was one string in a ~140px column: it wrapped and left
    // "46%" alone on its own line.
    expect(host.textContent).not.toContain("→");
    expect(host.textContent).toContain("Task Scout");
    expect(host.textContent).toContain("46%");
    const pct = Array.from(host.querySelectorAll("span")).find((s) => (s.textContent || "").trim() === "46%");
    expect(pct).toBeTruthy();
  });

  it("says the progress is unavailable rather than drawing a zero bar", () => {
    const host = renderRow(lbEntry("Emily", 24, 4, { levelKnown: false, progressToNext: 0 }));
    expect(host.textContent).toContain("level progress unavailable");
    expect(host.textContent).not.toMatch(/\b0%/);
  });

  it("reads the badge as the shared rank, not a position", () => {
    const host = renderRow(lbEntry("Emily", 60, 3));
    expect(host.textContent).toContain("#3");
    const row = host.querySelector('[role="button"]');
    expect(row?.getAttribute("aria-label")).toBe("Emily: 60 points, rank 3");
  });
});

describe("leaderboard visual critic — sheet honesty", () => {
  // Modal portals to document.body and the harness keeps every root mounted,
  // so each assertion reads the LAST dialog.
  const lastSheet = (): HTMLElement =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).pop() as HTMLElement;
  const renderSheet = (entry: LeaderboardEntry, allTimePoints: number | null) =>
    renderBody(
      createElement(MemberSheet, {
        open: true,
        entry,
        allTimePoints,
        allTimeComps: allTimePoints == null ? null : 9,
        weeklyPoints: entry.points,
        pendingTasks: [],
        affordableRewards: [{ id: "r1", name: "Ice cream", emoji: "🍦", cost: 20 }],
        weekGraph: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({ day, points: i === 2 ? 9 : 0 })),
        onClose: () => {},
        getMemberColor: () => "green",
        allTimeRead: AUTHORITATIVE as any,
      } as any),
    );

  it("does not claim '100% to next' at the top level", () => {
    // 10_000 is past the last threshold, so `next` is null.
    renderSheet(lbEntry("Emily", 62, 1), 10_000);
    const host = lastSheet();
    expect(host.textContent).not.toContain("100% to next");
    expect(host.textContent).toContain("Top level");
  });

  it("keeps a real 'to next' while a next level exists", () => {
    renderSheet(lbEntry("Emily", 62, 1), 700);
    expect(lastSheet().textContent).toMatch(/% to next/);
  });

  it("renders the redeem list as text, not as focusable no-op buttons", () => {
    renderSheet(lbEntry("Emily", 62, 1), 700);
    const host = lastSheet();
    const chip = Array.from(host.querySelectorAll<HTMLElement>("*")).find(
      (n) => (n.textContent || "").trim() === "🍦 Ice cream (20pts)",
    );
    expect(chip).toBeTruthy();
    // A focusable button here made the shared dialog-a11y hook scroll the sheet
    // past its own header on open (measured scrollTop 312), and announced a
    // control that does nothing.
    expect(chip?.tagName).not.toBe("BUTTON");
    expect(chip?.querySelector("button")).toBeNull();
  });

  it("gives the week graph a baseline so the bars read as a chart", () => {
    renderSheet(lbEntry("Emily", 62, 1), 700);
    const host = lastSheet();
    const graph = host.querySelector('[role="img"][aria-label^="Points by day"]');
    expect(graph).toBeTruthy();
    expect((graph as HTMLElement).className).toMatch(/border-b/);
    // One bar for the one day with points; a known zero draws nothing.
    expect(host.querySelectorAll("[data-week-bar]")).toHaveLength(1);
  });
});

describe("leaderboard visual critic — race card + arrows", () => {
  const renderRace = (entries: LeaderboardEntry[], prizes: WeeklyPrize[] = PRIZES) =>
    render(
      createElement(PrizeRaceCard, { prizes, entries, daysUntilReset: 7, myName: "Emily" } as any),
    );

  it("lists EVERY holder of a shared rank", () => {
    const host = renderRace([
      lbEntry("Emily", 50, 1),
      lbEntry("Rebecca", 50, 1),
      lbEntry("Caspian", 30, 3),
      lbEntry("Bailey", 30, 3),
      lbEntry("Jasmine", 5, 5),
    ]);
    const rows = Array.from(host.querySelectorAll("li")).map((li) => li.textContent || "");
    expect(rows[0]).toContain("Emily");
    expect(rows[0]).toContain("Rebecca");
    // Rank 2 belongs to nobody, so it must read "Up for grabs".
    expect(rows[1]).toContain("Up for grabs");
    expect(rows[2]).toContain("Caspian");
    expect(rows[2]).toContain("Bailey");
  });

  it("holds nothing for a member on zero points", () => {
    const host = renderRace([
      lbEntry("Emily", 50, 1),
      lbEntry("Rebecca", 50, 1),
      lbEntry("Caspian", 0, 3),
    ]);
    const rows = Array.from(host.querySelectorAll("li")).map((li) => li.textContent || "");
    expect(rows[0]).not.toContain("Caspian");
    expect(rows[1]).toContain("Up for grabs");
    expect(rows[2]).toContain("Up for grabs");
  });

  it("renders no card at all when no prizes are configured", () => {
    expect(renderRace([lbEntry("Emily", 50, 1)], []).innerHTML.trim()).toBe("");
  });

  it("never says the reset is tonight (the real range is 1..7)", () => {
    const host = render(
      createElement(PrizeRaceCard, { prizes: PRIZES, entries: [lbEntry("Emily", 50, 1)], daysUntilReset: 7, myName: "Emily" } as any),
    );
    expect(host.textContent).toContain("Resets in 7 days");
    expect(host.textContent).not.toMatch(/tonight/i);
  });

  it("uses the readable -ink- accents for the trend arrows", () => {
    const host = render(createElement(RankArrow, { currentRank: 1, previousRank: 4 } as any));
    expect(host.textContent).toBe("↑");
    expect(host.innerHTML).toContain("--color-accent-ink-mint");
    const down = render(createElement(RankArrow, { currentRank: 4, previousRank: 1 } as any));
    expect(down.textContent).toBe("↓");
    expect(down.innerHTML).toContain("--color-accent-ink-rose");
  });
});