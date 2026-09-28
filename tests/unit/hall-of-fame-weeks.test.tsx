// @vitest-environment jsdom
// Hall of Fame week entries (final-review I3, spec §4.3): beneath the
// per-member aggregate strip, recent WEEK entries render latest-first with
// the week start date ("Week of Sep 7"), the rank's medal, the member's first
// name, points, and the FROZEN prize text when the entry carries one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// task-utils imports @/db at module scope — this component only reads the
// local hall, so the db import is stubbed out (prize-race-card pattern).
const pbHall = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/db", () => ({ db: { selectHallOfFame: async () => pbHall.rows } }));

import HallOfFame from "@/components/leaderboard/HallOfFame";
import { saveHallOfFame } from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

let activeRoot: Root | null = null;
let host: HTMLElement | null = null;

function render(): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    activeRoot = createRoot(host!);
    activeRoot.render(<HallOfFame />);
  });
  return host;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function weekRows(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll("li"));
}

function entry(overrides: Partial<HallOfFameEntry>): HallOfFameEntry {
  return {
    member: "Rebecca",
    emoji: "👩",
    weekStart: "2026-09-07",
    points: 40,
    rank: 1,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  pbHall.rows = [];
});

afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  host = null;
  document.body.innerHTML = "";
});

describe("HallOfFame — recent week entries", () => {
  it("renders a prized entry with week label, medal, first name, points, and frozen prize text", async () => {
    saveHallOfFame([
      entry({ member: "Rebecca G", points: 42, rank: 1, prize: "Picks Friday's family movie" }),
    ]);
    const el = render();
    await settle();

    const rows = weekRows(el);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((li) => li.textContent!.includes("Rebecca"))!;
    expect(row.textContent).toContain("Week of Sep 7");
    expect(row.textContent).toContain("🥇");
    expect(row.textContent).toContain("Rebecca"); // first name (member is "Rebecca G")
    expect(row.textContent).toContain("42");
    expect(row.textContent).toContain("Picks Friday's family movie");
  });

  it("an entry WITHOUT a prize renders no prize text (no 🎁 chip on its row)", async () => {
    saveHallOfFame([
      entry({ member: "Rebecca G", rank: 1, prize: "Movie night" }),
      entry({ member: "Caspian G", rank: 2, emoji: "🧒", points: 20 }), // no prize key
    ]);
    const el = render();
    await settle();

    const rows = weekRows(el);
    const prized = rows.find((li) => li.textContent!.includes("Rebecca"))!;
    const plain = rows.find((li) => li.textContent!.includes("Caspian"))!;
    expect(prized.textContent).toContain("Movie night");
    expect(plain.textContent).not.toContain("🎁");
    expect(plain.textContent).toContain("🥈");
    expect(plain.textContent).toContain("20");
  });

  it("orders week entries newest-first (recent week on top)", async () => {
    saveHallOfFame([
      entry({ member: "Old Week", weekStart: "2026-08-31", points: 10, rank: 1 }),
      entry({ member: "New Week", weekStart: "2026-09-07", points: 20, rank: 1 }),
    ]);
    const el = render();
    await settle();

    const text = el.textContent!;
    expect(text.indexOf("Week of Sep 7")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Week of Aug 31")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Week of Sep 7")).toBeLessThan(text.indexOf("Week of Aug 31"));
  });

  it("keeps the existing per-member aggregate strip", async () => {
    saveHallOfFame([entry({ member: "Rebecca G" })]);
    const el = render();
    await settle();

    // Aggregate header is unchanged.
    expect(el.textContent).toContain("Hall of Fame");
  });

  it("renders server Hall of Fame rows on a fresh device", async () => {
    pbHall.rows = [{
      member: "Alex",
      emoji: "🦊",
      weekStart: "2026-09-21",
      points: 15,
      rank: 1,
      prize: "Server prize",
    }];
    const el = render();
    await settle();

    expect(el.textContent).toContain("Alex");
    expect(el.textContent).toContain("15");
    expect(el.textContent).toContain("Server prize");
  });
});
