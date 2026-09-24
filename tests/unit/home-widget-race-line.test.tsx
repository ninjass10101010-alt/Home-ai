// @vitest-environment jsdom
// HomeLeaderboardWidget weekly-prize race line (Task 12).
// One compact footer line inside the leaderboard card:
//   zero week   → "New week — prizes up for grabs 🥇🥈🥉"
//   on podium   → "🥇 {prize} — you're holding it!" (prize clipped ~30 chars)
//   off podium  → "{gap} pts to {medal} — {prize}"
//   signed out  → "🥇 🥈 🥉 prizes this week"
// All variants render as ONE text flow: the wrapper <p> carries line-clamp-1;
// no inline child carries a clamp class (line-clamp-* on an inline span forces
// display:-webkit-box and splits the line in real browsers).
// Harness: createRoot + act (no @testing-library/react in this repo — see
// tests/unit/use-leaderboard-data.test.tsx). The leaderboard-data hook and
// auth are mocked; the roster (`@/db`) is mocked; task-utils stays REAL so
// raceGap / resolveMemberName / prize storage run the production code paths
// against jsdom localStorage.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lbHook = vi.hoisted(() => ({
  data: null as any,
}));
vi.mock("@/components/leaderboard/hooks/useLeaderboardData", () => ({
  useLeaderboardData: () => ({ data: lbHook.data, mounted: true }),
}));

const authMock = vi.hoisted(() => ({
  currentUser: null as null | { name: string; role: string },
  isLoggedIn: false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: authMock.currentUser, isLoggedIn: authMock.isLoggedIn }),
}));

vi.mock("@/db", () => ({
  db: {
    // selectMembers() carries `name` = FIRST name and `fullName` = full name —
    // the race line must resolve through this to the full-name ledger key.
    selectMembers: () => [
      { id: 1, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", color: "green" },
      { id: 2, name: "Emily", fullName: "Emily Garcia", role: "child", emoji: "👧", color: "mint" },
      { id: 3, name: "Bailey", fullName: "Bailey Garcia", role: "child", emoji: "👶", color: "cyan" },
      { id: 4, name: "Rebecca", fullName: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" },
    ],
  },
}));

import HomeLeaderboardWidget from "@/components/leaderboard/HomeLeaderboardWidget";
import { WEEKLY_PRIZES_KEY } from "@/lib/task-utils";

const PRIZES = [
  { id: "p1", rank: 1, emoji: "🥇", text: "Movie pick" },
  { id: "p2", rank: 2, emoji: "🥈", text: "Dessert choice" },
  { id: "p3", rank: 3, emoji: "🥉", text: "Two dollars" },
];

function entry(name: string, points: number, rank: number) {
  return { name, points, rank, emoji: "🙂", color: "green", streak: 0 };
}

function seedLeaderboard(entries: ReturnType<typeof entry>[]) {
  lbHook.data = {
    entries,
    weekData: { weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [] },
    tasks: [],
    daysUntilReset: 3,
    previousRanks: {},
    hall: [],
  };
}

function seedPrizes(prizes: typeof PRIZES) {
  localStorage.setItem(WEEKLY_PRIZES_KEY, JSON.stringify(prizes));
}

let activeRoot: Root | null = null;

async function renderWidget(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(HomeLeaderboardWidget));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

function widgetIconSlot(root: HTMLElement): HTMLElement {
  const slot = Array.from(root.querySelectorAll("div")).find(
    (div) => div.className.includes("absolute") && div.className.includes("z-30") && div.className.includes("pointer-events-none")
  );
  if (!slot) throw new Error("widget icon slot not found");
  return slot as HTMLElement;
}

// One shared structural pin for every race-line variant: the clamp lives on
// the wrapper <p> itself; the line is a single text flow with no child
// elements carrying a clamp class (a `line-clamp-1` inline span forces
// display:-webkit-box and breaks the one-line flow in a real browser).
function expectSingleFlowLine(line: Element | null) {
  expect(line).not.toBeNull();
  expect(line!.tagName).toBe("P");
  expect(line!.className).toContain("line-clamp-1");
  expect(line!.querySelector(".line-clamp-1, .truncate")).toBeNull();
  expect(line!.children.length).toBe(0);
}

describe("HomeLeaderboardWidget — weekly prize race line", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    authMock.currentUser = null;
    authMock.isLoggedIn = false;
    seedLeaderboard([
      entry("Emily Garcia", 50, 1),
      entry("Rebecca Garcia", 40, 2),
      entry("Bailey Garcia", 30, 3),
      entry("Caspian Garcia", 10, 4),
    ]);
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("uses the illustrated leaderboard icon while preserving row medals", async () => {
    seedPrizes(PRIZES);
    const el = await renderWidget();
    const slot = widgetIconSlot(el);
    expect(slot.querySelector('svg[data-variant="leaderboard"]')).not.toBeNull();
    expect(slot.textContent).not.toContain("🏆");
    expect(el.textContent).toContain("🥇");
  });

  it("renders no race line at all when no prizes are configured", async () => {
    seedPrizes([]);
    authMock.currentUser = { name: "Caspian", role: "child" };
    authMock.isLoggedIn = true;
    const el = await renderWidget();
    expect(el.textContent).not.toContain("prizes this week");
    expect(el.textContent).not.toContain("holding it!");
    expect(el.textContent).not.toContain("pts to");
  });

  it("zero week: all entries at 0 → 'New week — prizes up for grabs 🥇🥈🥉'", async () => {
    seedPrizes(PRIZES);
    seedLeaderboard([
      entry("Emily Garcia", 0, 1),
      entry("Rebecca Garcia", 0, 2),
      entry("Bailey Garcia", 0, 3),
    ]);
    const el = await renderWidget();
    expect(el.textContent).toContain("New week — prizes up for grabs 🥇🥈🥉");
    expectSingleFlowLine(el.querySelector('[data-testid="prize-race-line"]'));
  });

  it("signed in + on podium (resolved full name): '🥇 Movie pick — you're holding it!'", async () => {
    seedPrizes(PRIZES);
    seedLeaderboard([
      entry("Caspian Garcia", 50, 1),
      entry("Emily Garcia", 30, 2),
      entry("Rebecca Garcia", 10, 3),
    ]);
    // Auth carries the FIRST name; the race line must still find podium rank.
    authMock.currentUser = { name: "Caspian", role: "child" };
    authMock.isLoggedIn = true;
    const el = await renderWidget();
    expect(el.textContent).toContain("🥇 Movie pick — you're holding it!");
  });

  it("signed in + off podium: '{gap} pts to {medal} — {prize}'", async () => {
    seedPrizes(PRIZES);
    authMock.currentUser = { name: "Caspian", role: "child" };
    authMock.isLoggedIn = true;
    // Default board: Caspian 10 at rank 4, podium cut-off is Bailey at 30.
    const el = await renderWidget();
    expect(el.textContent).toContain("20 pts to 🥉 — Two dollars");
    expectSingleFlowLine(el.querySelector('[data-testid="prize-race-line"]'));
  });

  it("signed out: '🥇 🥈 🥉 prizes this week'", async () => {
    seedPrizes(PRIZES);
    authMock.currentUser = null;
    authMock.isLoggedIn = false;
    const el = await renderWidget();
    expect(el.textContent).toContain("🥇 🥈 🥉 prizes this week");
    expectSingleFlowLine(el.querySelector('[data-testid="prize-race-line"]'));
  });

  it("holding a long-named prize clips the text at ~30 chars and renders as one clamped flow line", async () => {
    seedPrizes([
      { id: "p1", rank: 1, emoji: "🥇", text: "Picks the Friday night family movie" }, // 36 chars
      { id: "p2", rank: 2, emoji: "🥈", text: "Dessert choice" },
      { id: "p3", rank: 3, emoji: "🥉", text: "Two dollars" },
    ]);
    seedLeaderboard([
      entry("Caspian Garcia", 50, 1),
      entry("Emily Garcia", 30, 2),
      entry("Rebecca Garcia", 10, 3),
    ]);
    authMock.currentUser = { name: "Caspian", role: "child" };
    authMock.isLoggedIn = true;
    const el = await renderWidget();
    const line = el.querySelector('[data-testid="prize-race-line"]');
    expectSingleFlowLine(line);
    expect(line!.textContent).toContain("you're holding it!");
    expect(line!.textContent).toContain("Picks the Friday night family");
    // Clipped: the tail of the 36-char text never renders.
    expect(line!.textContent).not.toContain("family movie");
  });
});
