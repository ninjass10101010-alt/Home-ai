// @vitest-environment jsdom
// MemberSheet Weekly Champ 🥇 seam (final-review I2): the sheet computes its
// badges purely from BADGES conditions, but week_champ's condition is
// dead (`false`) — the badge is earned out-of-band from a rank-1 hall entry.
// The sheet takes a `hasWeeklyChamp` prop (the page computes it from the
// hall): true → the badge renders EARNED (🥇); false/absent → LOCKED (❓).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import MemberSheet from "@/components/leaderboard/MemberSheet";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

async function settle(ms = 250) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function sheetProps(hasWeeklyChamp?: boolean) {
  return {
    open: true,
    // Rich stats so only the four dead-condition badges stay locked — the
    // Locked grid caps at 8 tiles, and week_champ must be visible inside it.
    entry: { name: "Rebecca", emoji: "👩", streak: 8, rank: 1, levelEmoji: "⭐", levelTitle: "Champ" },
    allTimePoints: 1200,
    allTimeComps: 60,
    weeklyPoints: 40,
    pendingTasks: [],
    affordableRewards: [],
    weekGraph: [{ day: "M", points: 10 }],
    onClose: () => {},
    getMemberColor: () => "violet",
    ...(hasWeeklyChamp === undefined ? {} : { hasWeeklyChamp }),
  };
}

// The Modal portals to document.body — badge tiles are a span pair
// (emoji + name) inside a grid cell; locate by the badge name text.
function champTile(): HTMLElement | null {
  const name = Array.from(document.body.querySelectorAll("span")).find(
    (s) => s.textContent === "Weekly Champ"
  );
  return (name?.closest("div") as HTMLElement) ?? null;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
});

describe("MemberSheet — Weekly Champ badge seam", () => {
  it("hasWeeklyChamp=true renders the 🥇 badge as EARNED (not in the locked grid)", async () => {
    render(<MemberSheet {...sheetProps(true)} />);
    await settle();

    const tile = champTile();
    expect(tile).not.toBeNull();
    // Earned tiles carry the real badge emoji; locked tiles show ❓ instead.
    expect(tile!.textContent).toContain("🥇");
    expect(tile!.textContent).not.toContain("❓");
  });

  it("without the prop the champ badge stays LOCKED (❓)", async () => {
    render(<MemberSheet {...sheetProps()} />);
    await settle();

    const tile = champTile();
    expect(tile).not.toBeNull();
    expect(tile!.textContent).toContain("❓");
    expect(tile!.textContent).not.toContain("🥇");
  });

  it("hasWeeklyChamp=false keeps the badge locked", async () => {
    render(<MemberSheet {...sheetProps(false)} />);
    await settle();

    const tile = champTile();
    expect(tile!.textContent).toContain("❓");
  });
});
