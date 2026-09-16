// @vitest-environment jsdom
// WeeklyWinModal — the Monday ceremony. Opens once for a member with an
// uncelebrated top-3 prize win, both buttons claim (single-fire), reduced
// motion skips the confetti, and the Home page's wall gate keeps the family
// wall view ceremony-free.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// task-utils pulls @/db at module scope — the modal needs the pure local
// helpers plus the (controllable) PB hall read for the merged downlink.
// `pbHall.rows === null` mimics an unreachable PB (merged = local only).
const pbHall = vi.hoisted(() => ({ rows: null as any[] | null }));
vi.mock("@/db", () => ({
  db: {
    selectHallOfFame: () => {
      if (pbHall.rows === null) return Promise.reject(new Error("pb unreachable"));
      return Promise.resolve(pbHall.rows);
    },
  },
}));

// The wall gate lives at the Home-page mount site (page.tsx renders
// `{!wall && <WeeklyWinModal …/>}`); the wrapper below mirrors that mount
// contract and this mock controls it.
const wallState = vi.hoisted(() => ({ wall: false }));
vi.mock("@/hooks/useWallMode", () => ({
  useWallMode: () => ({ wall: wallState.wall, mounted: true }),
}));

// matchMedia is absent in jsdom — the modal mirrors the tasks page's
// triggerConfetti guard, so this stub controls prefers-reduced-motion.
const motionState = vi.hoisted(() => ({ reduced: false }));
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: motionState.reduced && query.includes("prefers-reduced-motion"),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

const fetchMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
);
vi.stubGlobal("fetch", fetchMock);

import { useWallMode } from "@/hooks/useWallMode";
import WeeklyWinModal from "@/components/leaderboard/WeeklyWinModal";
import { loadHallOfFame, saveHallOfFame } from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

const MEMBER = "Caspian G";
const WEEK = "2026-09-07";

function winEntry(overrides: Partial<HallOfFameEntry> = {}): HallOfFameEntry {
  return {
    member: MEMBER,
    emoji: "🦊",
    weekStart: WEEK,
    points: 42,
    rank: 1,
    prize: "Picks the movie",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLElement;

async function mount(ui: ReactElement) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(ui);
  });
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// Modal is portaled to <body> — never query the mount container for it.
function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

function buttonByText(text: string): HTMLElement | null {
  return (
    Array.from(document.body.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes(text)
    ) || null
  );
}

function confettiCount(): number {
  return document.querySelectorAll(".animate-confetti-fall").length;
}

// The shared Modal plays a 150ms exit animation (real timers here, motion not
// reduced) before unmounting — a claim is "dialog closing", then gone.
async function waitForClose() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 220));
  });
}

/** Mirrors the Home-page mount contract: the wall display's family view
 *  skips the ceremony entirely (only kid mode mounts it there). */
function HomeStyleMount({ memberName }: { memberName: string | null }) {
  const { wall } = useWallMode();
  if (wall) return null;
  return <WeeklyWinModal memberName={memberName} />;
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
  wallState.wall = false;
  motionState.reduced = false;
  pbHall.rows = null;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("WeeklyWinModal", () => {
  it("renders nothing for guests (no memberName)", async () => {
    saveHallOfFame([winEntry()]);
    await mount(<WeeklyWinModal memberName={null} />);
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no uncelebrated prize win", async () => {
    saveHallOfFame([
      winEntry({ weekStart: "2026-08-31", celebrated: true }), // already claimed
      winEntry({ rank: 4 }), // off the podium
      winEntry({ weekStart: WEEK, prize: "" }), // no prize attached
    ]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens for an uncelebrated prize win with medal, rank, and prize text", async () => {
    saveHallOfFame([winEntry()]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d!.textContent).toContain("Weekly Winner!");
    expect(d!.textContent).toContain("🏆");
    expect(d!.textContent).toContain("You finished #1 last week");
    expect(d!.textContent).toContain("You won: Picks the movie");
    // Non-reduced motion fires the confetti burst on open.
    expect(confettiCount()).toBeGreaterThan(0);
  });

  it("uses the rank's medal (🥈 for a rank-2 win)", async () => {
    saveHallOfFame([winEntry({ rank: 2, prize: "Chooses dessert" })]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);
    const d = dialog();
    expect(d!.textContent).toContain("🥈");
    expect(d!.textContent).toContain("You finished #2 last week");
    expect(d!.textContent).toContain("You won: Chooses dessert");
  });

  it("claim marks the win celebrated locally AND posts to the celebrate route", async () => {
    saveHallOfFame([winEntry()]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);

    await click(buttonByText("Tell my family! 🎉"));

    // Local flag is the primary single-fire record.
    expect(loadHallOfFame()[0].celebrated).toBe(true);
    // Best-effort server claim carries the member + week.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/hall-of-fame/celebrate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ memberName: MEMBER, weekStart: WEEK });
    // ...and the ceremony is dismissed.
    await waitForClose();
    expect(dialog()).toBeNull();
  });

  it("the secondary Close button also claims (single-fire over label semantics)", async () => {
    saveHallOfFame([winEntry()]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);

    await click(buttonByText("Close"));

    expect(loadHallOfFame()[0].celebrated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reopen after a claim", async () => {
    saveHallOfFame([winEntry()]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);
    await click(buttonByText("Tell my family! 🎉"));
    await waitForClose();
    expect(dialog()).toBeNull();

    // Unmount + remount (a fresh page visit) sees the celebrated flag.
    await act(async () => {
      root?.unmount();
    });
    root = null;
    fetchMock.mockClear();
    await mount(<WeeklyWinModal memberName={MEMBER} />);
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the confetti burst under prefers-reduced-motion (dialog still opens)", async () => {
    motionState.reduced = true;
    saveHallOfFame([winEntry()]);
    await mount(<WeeklyWinModal memberName={MEMBER} />);
    expect(dialog()).not.toBeNull();
    expect(confettiCount()).toBe(0);
  });

  it("a PB-celebrated flag suppresses a locally un-celebrated win (cross-device single-fire)", async () => {
    // The kid claimed the ceremony on the tablet; this phone's local hall copy
    // never got the flag. The merged downlink must hide the modal here.
    saveHallOfFame([winEntry()]);
    pbHall.rows = [{ ...winEntry(), id: "pb-1", celebrated: true }];

    await mount(<WeeklyWinModal memberName={MEMBER} />);
    // Give the merged downlink a beat to resolve before asserting it closed.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(dialog()).toBeNull();
    // The merged flag persisted locally, so a remount stays quiet too.
    expect(loadHallOfFame()[0].celebrated).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not mounted on the wall display's family view (Home-page gate)", async () => {
    saveHallOfFame([winEntry()]);
    wallState.wall = true;
    await mount(<HomeStyleMount memberName={MEMBER} />);
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // Control: with wall off the same mount opens the ceremony.
    wallState.wall = false;
    await mount(<HomeStyleMount memberName={MEMBER} />);
    expect(dialog()).not.toBeNull();
  });
});
