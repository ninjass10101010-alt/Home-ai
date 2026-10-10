// @vitest-environment jsdom
//
// U3 — the page-wide sweep's contracts (Task 6 §G/U3, the frame's §F-3 rubric).
//
// The browser gate owns pixels; this suite owns the source-level contracts a
// byte-match cannot read: the declared 24/16/8/12 rhythm and each number's
// literal rule, the member tile's five fixes, the stat row's 8px step, the Open
// board's shared row anatomy + its glyph-seat move, the champion Surface's
// internal rhythm, and the three pre-existing sums the frame carves out (each
// with its source-naming comment, and no fourth).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => {
  const roster = [
    { id: 1, name: "Rebecca", fullName: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" },
    { id: 2, name: "Jasmine", fullName: "Jasmine Garcia", role: "child", emoji: "👧", color: "rose" },
  ];
  return {
    db: {
      refreshMembersCache: vi.fn(async () => true),
      selectMembers: () => roster,
      selectMembersFallback: () => roster,
    },
  };
});

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const PAGE = read("src/app/tasks/page.tsx");
const CSS = read("src/app/globals.css");
const STATS = read("src/components/tasks/TasksStats.tsx");
const SEGMENTED = read("src/components/ui/SegmentedControl.tsx");

const OPEN_CHORE = {
  id: 31, title: "Sweep the porch", assignee: "All", assigneeEmoji: "🤝",
  due: "2026-10-08", points: 4, recurring: null, category: "Chores",
  completed: false, priority: "medium", universal: true, speedBonus: 2,
};

function seed(tasks: unknown[], points: Record<string, number> = {}) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-rewards", "[]");
  localStorage.setItem("consuela-penalties", "[]");
  localStorage.setItem("consuela-week-data", JSON.stringify({
    weekStart: "2026-10-05", points, history: [], streak: {}, lastActive: {},
  }));
}

async function renderAsync(ui: any): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
});

describe("U3 — one rhythm, declared at the page shell", () => {
  it("names 24/16/8/12, each traceable to a literal class rule", () => {
    const marker = "ONE RHYTHM";
    const at = PAGE.indexOf(marker);
    expect(at, "the shell carries the rhythm comment").toBeGreaterThan(0);
    const comment = PAGE.slice(at - 80, at + 600);
    for (const bit of ["24", "16", "8", "12", "space-y-6", "space-y-4", "space-y-2", "px-3 py-3"]) {
      expect(comment, `the rhythm comment names ${bit}`).toContain(bit);
    }
  });

  it("the stat row's gap is the rail's 8px step; the view switch sits on the grid too", () => {
    expect(STATS).toContain("grid grid-cols-3 gap-2");
    expect(STATS).not.toContain("grid-cols-3 gap-3");
    // The switch's option row is measured inside the rail scope; 6px read
    // off-grid there (the U2 review handed it to U3's sweep).
    expect(SEGMENTED).toContain('"gap-2 rounded-xl px-3 py-2 text-xs"');
  });
});

describe("U3 — the member strip's five fixes", () => {
  it("one transition per element: .tap-sm owns it, .member-tile declares none", () => {
    const start = CSS.indexOf(".member-tile {");
    const block = CSS.slice(start, CSS.indexOf("}", start));
    expect(block).not.toContain("transition");
  });

  it("a token radius, declared 44px (and 64px wall) floors, and its own focus ring", () => {
    const start = CSS.indexOf(".member-tile {");
    const block = CSS.slice(start, CSS.indexOf("}", start));
    expect(block).toContain("border-radius: var(--radius-lg)");
    expect(block).not.toContain("1.1rem");
    expect(block).toContain("min-height: 44px");
    expect(CSS).toContain(".member-tile:focus-visible");
    expect(CSS).toMatch(/html\[data-wall="true"\] \.member-tile\s*\{[^}]*min-height: 64px/);
  });
});

describe("U3 — the Open board adopts the Pending row anatomy", () => {
  it("carries the glyph in the icon seat, not the title", async () => {
    mockAuth.currentUser = { name: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" };
    mockAuth.isLoggedIn = true;
    seed([OPEN_CHORE]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const headings = [...root.querySelectorAll("h2")].map((h) => (h.textContent || "").trim());
    expect(headings, "the card title is the word alone").toContain("Open");
    expect(headings, "the old double glyph is gone").not.toContain("🫳 Open");
    const card = [...root.querySelectorAll(".widget-card")].find((c) => (c.querySelector("h2")?.textContent || "").trim() === "Open");
    expect(card, "the Open card renders").toBeTruthy();
    expect(card!.textContent || "", "the card's icon seat carries the glyph").toContain("🫳");
  });

  it("rows wear the rail + px-3 py-3 + the 3-line clamp, and the claim control is class-marked", async () => {
    mockAuth.currentUser = { name: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" };
    mockAuth.isLoggedIn = true;
    seed([OPEN_CHORE]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const claim = root.querySelector('[aria-label^="Claim "]') as HTMLButtonElement | null;
    expect(claim, "the claim control renders").toBeTruthy();
    expect(claim!.className).toContain("tasks-open-claim");
    expect(claim!.className).toContain("min-h-[44px]");
    const row = claim!.closest(".schedule-row") as HTMLElement;
    expect(row, "the claim control lives in a schedule row").toBeTruthy();
    expect(row.className).toContain("px-3 py-3");
    const rail = [...row.querySelectorAll("div")].find((d) => d.className.includes("h-8 w-0.5")) as HTMLElement | undefined;
    expect(rail, "the Pending row's 2px rail").toBeTruthy();
    expect(rail!.getAttribute("style") || "").toContain("--color-accent-cyan");
    const title = [...row.querySelectorAll("div")].find((d) => d.textContent === OPEN_CHORE.title) as HTMLElement;
    expect(title.className).toContain("line-clamp-3");
    expect(title.getAttribute("title")).toBe(OPEN_CHORE.title);
  });

  it("the claim control takes the declared 64px wall floor (§E-1)", () => {
    expect(CSS).toMatch(/html\[data-wall="true"\] \.tasks-open-claim\s*\{[^}]*min-height: 64px/);
  });
});

describe("U3 — the leaderboard champion Surface", () => {
  it("wears the SectionCard rhythm (p-5 body, space-y-3 blocks) and exactly one hairline", async () => {
    mockAuth.currentUser = { name: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" };
    mockAuth.isLoggedIn = true;
    seed([], { "Rebecca Garcia": 12 });
    const root = await renderAsync(<TasksPage />);
    await settle();

    const tab = [...root.querySelectorAll('button[role="radio"]')]
      .find((b) => (b.textContent || "").includes("Leaderboard")) as HTMLButtonElement;
    expect(tab, "the view switch renders").toBeTruthy();
    await act(async () => { tab.click(); });
    await settle();

    const champion = root.querySelector(".warm-glass-card") as HTMLElement | null;
    expect(champion, "the champion surface renders for a nonzero week").toBeTruthy();
    expect(champion!.className).toContain("p-5");
    expect(champion!.className).not.toContain("p-6");
    const rules = champion!.querySelectorAll(".border-b.border-border");
    expect(rules.length, "one hairline, the SectionCard rule").toBe(1);
    expect(champion!.querySelector(".space-y-3"), "blocks on the SectionCard step").toBeTruthy();
  });

  it("creates no skipped heading level on the leaderboard tab", async () => {
    mockAuth.currentUser = { name: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" };
    mockAuth.isLoggedIn = true;
    seed([], { "Rebecca Garcia": 12 });
    const root = await renderAsync(<TasksPage />);
    await settle();
    const tab = [...root.querySelectorAll('button[role="radio"]')]
      .find((b) => (b.textContent || "").includes("Leaderboard")) as HTMLButtonElement;
    await act(async () => { tab.click(); });
    await settle();

    const levels = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1).length, "one h1").toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], `h${levels[i - 1]} -> h${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("U3 — the three carved-out sums", () => {
  it("keeps exactly the three pre-existing sums, each commented with its source", () => {
    const reduces = PAGE.match(/\.reduce\(/g) ?? [];
    expect(reduces.length, "no fourth sum").toBe(3);

    const family = PAGE.indexOf("const familyTotal = dynamicLeaderboard.reduce");
    expect(family).toBeGreaterThan(0);
    const familyCtx = PAGE.slice(family - 500, family);
    expect(familyCtx).toMatch(/pre-existing/i);
    expect(familyCtx).toContain("dynamicLeaderboard");

    const weekly = PAGE.indexOf("const weeklyEarned = Object.values(weekData.points).reduce");
    expect(weekly).toBeGreaterThan(0);
    const weeklyCtx = PAGE.slice(weekly - 500, weekly);
    expect(weeklyCtx).toMatch(/pre-existing/i);
    expect(weeklyCtx).toContain("weekData.points");

    const graph = PAGE.indexOf("weekData.history");
    expect(graph).toBeGreaterThan(0);
    const graphCtx = PAGE.slice(graph - 500, graph + 80);
    expect(graphCtx).toMatch(/pre-existing/i);
    expect(graphCtx).toContain("weekData.history");
  });
});
