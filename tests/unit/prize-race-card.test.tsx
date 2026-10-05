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
    levelKnown: true,
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

  it("zero-point week shows the fresh-week line instead of the personal gap line", () => {
    const el = render(
      <PrizeRaceCard
        prizes={PRIZES}
        entries={[entry("Rebecca", 0), entry("Emily", 0)]}
        daysUntilReset={4}
        myName="Rebecca"
      />
    );
    expect(el.textContent).toContain("New race started — prizes reset Monday to Monday.");
    expect(el.textContent).not.toContain("pts from a prize");
    expect(el.textContent).not.toContain("keep it up!");
  });

  it("a zero-point week shows the fresh-week line even when nobody is signed in", () => {
    const el = render(
      <PrizeRaceCard prizes={PRIZES} entries={[entry("Rebecca", 0)]} daysUntilReset={4} />
    );
    expect(el.textContent).toContain("New race started — prizes reset Monday to Monday.");
  });

  it("holder slots carry the member's small Avatar before their name", () => {
    const el = render(
      <PrizeRaceCard prizes={PRIZES} entries={[entry("Rebecca", 10)]} daysUntilReset={4} />
    );
    const gold = prizeRow(el, "Picks the movie")!;
    const avatar = gold.querySelector(".rounded-full.w-7.h-7");
    expect(avatar).not.toBeNull();
    // The avatar chip's row names the holder and leads with the avatar.
    const holderChip = avatar!.closest("span")!;
    expect(holderChip.textContent).toContain("Rebecca");
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

    it("with only two prizes, the off-podium gap targets rank #2's points", () => {
      // Bailey (rank 4, 10 pts) chases the LAST pod spot — rank #2 Emily at 60,
      // so the gap is 50. A rank-3 Caspian (40) target would read 30 instead.
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES.slice(0, 2)}
          entries={[entry("Rebecca", 70), entry("Emily", 60), entry("Caspian", 40), entry("Bailey", 10)]}
          daysUntilReset={4}
          myName="Bailey"
        />
      );
      const line = el.querySelector("[aria-live='polite']");
      expect(line).not.toBeNull();
      expect(line!.textContent).toContain("You're 50 pts from a prize — keep going!");
      expect(line!.textContent).not.toContain("30 pts");
    });

    it("tells a 0-point member holding a prize rank the real distance, not 'join the race'", () => {
      // Bailey is on 0 points with one member ahead of him, so his COMPETITION
      // rank is 2 — a prize rank. `raceGap` used to short-circuit on zero and
      // answer `rank: null`, and this card then said "Earn points to join this
      // week's race!" while the list directly above it handed his rank to nobody
      // ("Up for grabs"): two opposite stories on one screen, and the loser of
      // the two was the kid. Zero points still HOLDS no prize — so he must not
      // be congratulated — but he must be told the truth: the leader's 10 pts
      // are the distance, and the list and the line now agree.
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 10), entry("Bailey", 0)]}
          daysUntilReset={4}
          myName="Bailey"
        />
      );
      const line = el.querySelector("[aria-live='polite']")!.textContent!;
      expect(line).toContain("You're 10 pts from a prize — keep going!");
      // Never a prize he cannot hold, and never the old "you are not in the
      // race" loss-frame for a member the list itself ranks.
      expect(line).not.toContain("prize spot");
      expect(line).not.toContain("You're in the lead");
      expect(line).not.toContain("Earn points to join");
      // …and it agrees with the list: his rank holds nothing yet.
      expect(prizeRow(el, "Chooses dessert")!.textContent).toContain("Up for grabs");
    });

    it("invites a member in only when there is no distance to measure, never inventing one", () => {
      // Two tied leaders leave rank 2 EMPTY (standard competition rank), so no
      // member currently holds the cutoff and there is no threshold to state a
      // distance against. That — and only that — is the invitation's case: the
      // line must not invent "N pts from a prize" the card cannot support.
      const el = render(
        <PrizeRaceCard
          prizes={PRIZES}
          entries={[entry("Rebecca", 50), entry("Emily", 50), entry("Bailey", 0)]}
          daysUntilReset={4}
          myName="Bailey"
        />
      );
      const line = el.querySelector("[aria-live='polite']")!.textContent!;
      expect(line).toContain("Earn points to join this week's race!");
      expect(line).not.toMatch(/\d+ pts from a prize/);
      expect(line).not.toContain("prize spot");
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

  it("the countdown copy covers its real 1..7 range (1 = tomorrow, N = days)", () => {
    // `getDaysUntilWeekReset()` returns 1..7 by construction — a Monday maps to
    // 7, because the race runs Monday 00:00 → Sunday 23:59, so the reset is a
    // full week away and the week never ends at midnight. There is therefore no
    // "tonight" state to render, and the `daysUntilReset <= 0` arm that produced
    // "Resets tonight!" was deleted: it could only ever fire on the one day the
    // race had just begun. Every value the helper can return is checked.
    const one = render(
      <PrizeRaceCard prizes={PRIZES} entries={[entry("Rebecca", 10)]} daysUntilReset={1} />
    );
    expect(one.textContent).toContain("⏳ Resets tomorrow");

    for (const days of [2, 3, 4, 5, 6, 7]) {
      const el = render(
        <PrizeRaceCard prizes={PRIZES} entries={[entry("Rebecca", 10)]} daysUntilReset={days} />
      );
      expect(el.textContent, `daysUntilReset=${days}`).toContain(`⏳ Resets in ${days} days`);
      expect(el.textContent, `daysUntilReset=${days}`).not.toContain("tonight");
    }
  });
});
