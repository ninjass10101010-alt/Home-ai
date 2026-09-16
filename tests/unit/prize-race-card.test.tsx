// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";
import PrizeRaceCard from "@/components/leaderboard/PrizeRaceCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// task-utils (raceGap) imports @/db at module scope — the card only uses the
// pure race-gap math, so the db module is stubbed out entirely.
vi.mock("@/db", () => ({ db: {} }));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function entry(name: string, points: number): LeaderboardEntry {
  return {
    name,
    emoji: "🙂",
    color: "green",
    points,
    streak: 0,
    // Deliberately wrong on-purpose rank: the card must recompute competition
    // rank from points and never trust entry.rank.
    rank: 0,
    level: 1,
    levelTitle: "Rookie",
    levelEmoji: "🌱",
    progressToNext: 0,
    badges: [],
    completedInWeek: 0,
    allTimePoints: points,
    allTimeCompletions: 0,
  };
}

const PRIZES: WeeklyPrize[] = [
  { id: "prize-1", rank: 1, emoji: "🥇", text: "Picks the movie" },
  { id: "prize-2", rank: 2, emoji: "🥈", text: "Chooses dessert" },
  { id: "prize-3", rank: 3, emoji: "🥉", text: "+$2 allowance" },
];

function prizeRow(el: HTMLElement, text: string): HTMLElement | null {
  return (
    Array.from(el.querySelectorAll("li")).find((li) =>
      (li.textContent || "").includes(text)
    ) || null
  );
}

describe("PrizeRaceCard", () => {
  it("renders nothing when there are no prizes configured", () => {
    const el = render(
      <PrizeRaceCard prizes={[]} entries={[entry("Rebecca", 10)]} daysUntilReset={3} myName="Rebecca" />
    );
    expect(el.innerHTML).toBe("");
  });

  it("renders a prize row per configured prize with the current holder by competition rank", () => {
    const el = render(
      <PrizeRaceCard
        prizes={PRIZES}
        entries={[entry("Rebecca", 10), entry("Caspian", 10), entry("Emily", 5), entry("Bailey", 0)]}
        daysUntilReset={4}
      />
    );
    // Card shell
    expect(el.textContent).toContain("Weekly prizes");
    // Tied leaders share rank 1 — the #1 prize row lists both of them.
    const gold = prizeRow(el, "Picks the movie")!;
    expect(gold.textContent).toContain("Rebecca");
    expect(gold.textContent).toContain("Caspian");
    // Under a 2-way rank-1 tie nobody holds rank 2 — standard competition rank.
    expect(prizeRow(el, "Chooses dessert")!.textContent).toContain("Up for grabs");
    // Rank 3 belongs to Emily (two members hold strictly more points).
    expect(prizeRow(el, "+$2 allowance")!.textContent).toContain("Emily");
    expect(prizeRow(el, "+$2 allowance")!.textContent).not.toContain("Bailey");
  });

  it("shows every prize as up for grabs on a zero-point week and hides the personal line", () => {
    const el = render(
      <PrizeRaceCard
        prizes={PRIZES}
        entries={[entry("Rebecca", 0), entry("Emily", 0)]}
        daysUntilReset={4}
        myName="Rebecca"
      />
    );
    const rows = Array.from(el.querySelectorAll("li"));
    expect(rows).toHaveLength(3);
    rows.forEach((row) => expect(row.textContent).toContain("Up for grabs"));
    expect(el.querySelector("[aria-live]")).toBeNull();
  });

  describe("personal gap line", () => {
    it("celebrates the week leader", () => {
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 20), entry("Emily", 5)]}
          daysUntilReset={4}
          myName="Rebecca"
        />
      );
      const line = el.querySelector("[aria-live='polite']");
      expect(line).not.toBeNull();
      expect(line!.textContent).toContain("🏆 You're in the lead — keep it up!");
    });

    it("encourages a member holding rank 2 or 3", () => {
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 20), entry("Emily", 5)]}
          daysUntilReset={4}
          myName="Emily"
        />
      );
      expect(el.querySelector("[aria-live='polite']")!.textContent).toContain(
        "👏 You're in a prize spot — keep it up!"
      );
    });

    it("shows the points gap for a member just off the podium", () => {
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 20), entry("Emily", 15), entry("Caspian", 10), entry("Bailey", 3)]}
          daysUntilReset={4}
          myName="Bailey"
        />
      );
      // Rank 3 holder is Caspian at 10 pts; Bailey has 3 → 7 away.
      expect(el.querySelector("[aria-live='polite']")!.textContent).toContain(
        "You're 7 pts from a prize — keep going!"
      );
    });

    it("invites a zero-point member into the race when others have points", () => {
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 10), entry("Bailey", 0)]}
          daysUntilReset={4}
          myName="Bailey"
        />
      );
      expect(el.querySelector("[aria-live='polite']")!.textContent).toContain(
        "Earn points to join this week's race!"
      );
    });

    it("renders no personal line when myName is not provided", () => {
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 10)]}
          daysUntilReset={4}
        />
      );
      expect(el.querySelector("[aria-live]")).toBeNull();
    });
  });

  it("pluralizes the reset countdown", () => {
    const one = render(
      <PrizeRaceCard prizes={PRIZES} entries={[entry("Rebecca", 10)]} daysUntilReset={1} />
    );
    expect(one.textContent).toContain("Resets in 1 day");
    expect(one.textContent).not.toContain("Resets in 1 days");

    const many = render(
      <PrizeRaceCard prizes={PRIZES} entries={[entry("Rebecca", 10)]} daysUntilReset={4} />
    );
    expect(many.textContent).toContain("⏳ Resets in 4 days");
  });
});
