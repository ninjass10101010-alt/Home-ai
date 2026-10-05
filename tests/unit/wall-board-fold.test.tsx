// @vitest-environment jsdom
/**
 * The landscape wall board (1920×1080) — composition contracts.
 *
 * Everything below was MEASURED on the rendered page at 1920×1080, and each
 * assertion pins one of those measurements. They are deliberately a mix of
 * pure-function, rendered-class and source-string checks: the pure ones pin the
 * arithmetic, the rendered ones catch a class that was dropped, and the source
 * ones catch the traps that no DOM assertion can see — a stylesheet rule that
 * lost the cascade, a breakpoint that disagrees with itself, a Tailwind variant
 * that is emitted in the wrong order.
 *
 * The bug this suite exists for, in one sentence: on a 1920 panel the layout was
 * correct and half empty — `/rewards` stranded one 1300×320 card with 760px of
 * nothing under it, `/tasks` left its left column empty for 700px, `/ha` capped
 * out at 650px with 1250px unused, `/chat` was a 500px ribbon whose composer sat
 * 6px behind the dock, and Home ran 2162px tall so the dock painted over the
 * middle of its third row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import PageShell from "@/components/ui/PageShell";
import {
  ALL_WIDGETS,
  BOARD_MEASURE_CLASS,
  DEFAULT_LAYOUT,
  READ_MEASURE_CLASS,
  WALL_BOARD_HIDDEN_WIDGETS,
  WALL_BOARD_MAX_HEIGHT,
  WALL_BOARD_MIN_WIDTH,
  WALL_GRID_CLASS,
  WIDGET_TIERS,
  computeWallBoard,
  getVisibleWidgets,
  visibleOnWallBoard,
  wallBoardSpanClass,
  type WidgetId,
} from "@/lib/layout-config";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: mockUseAuth }));

const read = (rel: string) => readFileSync(resolve(__dirname, "../../", rel), "utf8");
const globals = read("src/app/globals.css");
const home = read("src/app/page.tsx");
const chat = read("src/app/chat/page.tsx");
const tasks = read("src/app/tasks/page.tsx");

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The board is a breakpoint, and it is one breakpoint.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("computeWallBoard", () => {
  it("claims the rotated panel the portrait profile cannot see", () => {
    // 1920×1080 is the same physical wall as 1080×1920. A rotated panel reports
    // landscape, so `computeWallMode`'s portrait gate never fires and
    // `data-wall` is never set — which is why the board needs its own answer.
    expect(computeWallBoard(1920, 1080)).toBe(true);
  });

  it("leaves the portrait wall to the portrait profile", () => {
    expect(computeWallBoard(1080, 1920)).toBe(false);
  });

  it("is a wide-AND-short canvas, not just a wide one", () => {
    expect(computeWallBoard(2560, 1440)).toBe(false);
    expect(computeWallBoard(1440, 900)).toBe(false);
  });

  it("has documented, non-overlapping edges", () => {
    expect(WALL_BOARD_MIN_WIDTH).toBe(1600);
    expect(WALL_BOARD_MAX_HEIGHT).toBe(1300);
    expect(computeWallBoard(WALL_BOARD_MIN_WIDTH, WALL_BOARD_MAX_HEIGHT)).toBe(true);
    expect(computeWallBoard(WALL_BOARD_MIN_WIDTH - 1, WALL_BOARD_MAX_HEIGHT)).toBe(false);
    expect(computeWallBoard(WALL_BOARD_MIN_WIDTH, WALL_BOARD_MAX_HEIGHT + 1)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Twelve cells: the number that makes three rows of four.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("the board's twelve cells", () => {
  const visible = visibleOnWallBoard(getVisibleWidgets(DEFAULT_LAYOUT.desktop));

  /** Cells a widget occupies on the board. */
  function cellsOf(id: WidgetId): number {
    return wallBoardSpanClass(id).includes("row-span-2") ? 2 : 1;
  }

  it("fills exactly four columns of three rows", () => {
    const cells = visible.reduce((n, w) => n + cellsOf(w.id), 0);
    expect(cells, "12 cells = 4 columns × 3 rows, the shape that clears the dock").toBe(12);
  });

  it("drops the same four ambient widgets the portrait wall drops", () => {
    expect([...WALL_BOARD_HIDDEN_WIDGETS].sort()).toEqual(
      ["consuelaSuggestions", "financeLedger", "music", "schedule"].sort(),
    );
    for (const id of WALL_BOARD_HIDDEN_WIDGETS) {
      expect(visible.map((w) => w.id), `${id} must be off on the board`).not.toContain(id);
    }
  });

  it("hides rather than deletes — every widget is still switchable in Home settings", () => {
    // The filter is over the SAVED layout, not the registry: no widget is ever
    // removed from ALL_WIDGETS, so Home settings can still switch it back on.
    expect(ALL_WIDGETS.length).toBe(15);
    for (const id of WALL_BOARD_HIDDEN_WIDGETS) {
      expect(ALL_WIDGETS.map((w) => w.id)).toContain(id);
    }
  });

  it("keeps the portrait wall's default set intact", () => {
    expect([...DEFAULT_LAYOUT.tablet.hidden].sort()).toEqual([...WALL_BOARD_HIDDEN_WIDGETS].sort());
  });

  it("filters exactly the four ids and nothing else", () => {
    const all = getVisibleWidgets(DEFAULT_LAYOUT.desktop);
    expect(all).toHaveLength(15);
    expect(visibleOnWallBoard(all)).toHaveLength(11);
    expect(all.filter((w) => visible.includes(w))).toHaveLength(11);
  });
});

describe("board widget spans", () => {
  it("gives Weather the portrait cell it was drawn for", () => {
    // Measured at the board's flat 463×170 the poster spilled 169px — the hour
    // strip and the metric row fell out of the card entirely.
    expect(wallBoardSpanClass("weather")).toBe("row-span-2");
  });

  it("gives the 2-cell photo tile its cell back, which is what keeps the count at 12", () => {
    expect(wallBoardSpanClass("photos")).toBe("col-span-1");
    expect(
      WIDGET_TIERS.photos?.desktop,
      "the portrait wall still gets its 2-cell hero — the board did not take it away",
    ).toBe("row-span-2");
  });

  it("leaves every other widget 1×1", () => {
    for (const w of ALL_WIDGETS) {
      if (w.id === "weather") continue;
      expect(wallBoardSpanClass(w.id), w.id).toBe("col-span-1");
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The measure is a property of the route, and it is centred either way.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("measure tiers", () => {
  it("the board measure keeps the old steps, so no unlisted route narrows", () => {
    // The pre-existing cap was `lg:max-w-5xl xl:max-w-7xl` on every route. The
    // board tier has to start from there or every page I did not touch silently
    // loses width.
    expect(BOARD_MEASURE_CLASS).toContain("lg:max-w-5xl");
    expect(BOARD_MEASURE_CLASS).toContain("xl:max-w-7xl");
  });

  it("both measures centre their column", () => {
    for (const cls of [READ_MEASURE_CLASS, BOARD_MEASURE_CLASS]) {
      expect(cls, cls).toContain("mx-auto");
      expect(cls, cls).toContain("w-full");
    }
  });

  it("the read measure is narrower than the board's floor — prose is not a grid", () => {
    expect(READ_MEASURE_CLASS).toContain("xl:max-w-4xl");
    expect(READ_MEASURE_CLASS).not.toContain("max-w-7xl");
  });

  it("the board step is a STYLESHEET class, not a `min-[…]` variant", () => {
    // The trap this pins: Tailwind emits arbitrary min-width variants BEFORE the
    // named breakpoints, so `min-[1600px]:max-w-[104rem]` loses to
    // `xl:max-w-7xl` in the same class string and silently does nothing.
    // An unlayered class always out-ranks `@layer utilities`, so it cannot.
    expect(BOARD_MEASURE_CLASS).toContain("wall-board-measure");
    expect(BOARD_MEASURE_CLASS).not.toMatch(/min-\[/);
    expect(READ_MEASURE_CLASS).not.toMatch(/min-\[/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. PageShell: `board` is the default, `read` is opt-in, the caller wins.
 * ──────────────────────────────────────────────────────────────────────────── */
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

describe("PageShell measure", () => {
  beforeEach(() => mockUseAuth.mockReturnValue({ hydrated: true, currentUser: { role: "parent" } }));
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  function mainOf(el: HTMLElement): HTMLElement {
    return el.querySelector("main") as HTMLElement;
  }

  it("defaults to the board measure, so a route that never heard of it is unchanged", () => {
    const main = mainOf(render(<PageShell><p>p</p></PageShell>));
    expect(main.className).toContain("wall-board-measure");
    expect(main.className).toContain("xl:max-w-7xl");
  });

  it("applies the read measure when the route declares prose", () => {
    const main = mainOf(render(<PageShell measure="read"><p>p</p></PageShell>));
    expect(main.className).toContain("xl:max-w-4xl");
    expect(main.className).not.toContain("wall-board-measure");
  });

  it("gives a page that brings its own column NEITHER measure", () => {
    // One width per column, always: two competing `max-w-*` on one element is
    // how the cap could collide with a caller's own layout.
    const main = mainOf(render(<PageShell contentClassName="max-w-lg mx-auto"><p>p</p></PageShell>));
    expect(main.className).not.toContain("wall-board-measure");
    expect(main.className).not.toContain("max-w-4xl");
    expect(main.className).not.toContain("max-w-7xl");
  });

  it("reserves enough dock clearance under every measured route", () => {
    // The dock's own measured height is 94px on a 1920 canvas and 110px under
    // the wall profile. `pb-32` is 128px, so the last row of content can never
    // end up painted over.
    const main = mainOf(render(<PageShell measure="board"><p>p</p></PageShell>));
    expect(main.className).toContain("pb-32");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. The stylesheet: the fit no longer depends on `data-wall`.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("globals.css — the canvas fit", () => {
  it("is NOT scoped to the wall attribute, because a rotated panel never sets it", () => {
    // Measured: with `html[data-wall="true"] main.wall-home-fit`, Home rendered
    // 2162px on a 1920×1080 canvas and the fixed dock painted over the middle of
    // the third row. The class is the seam, not the attribute.
    expect(globals).toMatch(/\nmain\.wall-home-fit \{/);
    expect(globals).not.toMatch(/html\[data-wall="true"\] main\.wall-home-fit/);
  });

  it("still reserves the dock clearance it always did", () => {
    const rule = globals.slice(globals.indexOf("main.wall-home-fit {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("padding-bottom: 7rem");
  });

  it("grows the bento's own wrapper, not the last child", () => {
    // `> div:last-child` used to make the week strip and the action row share
    // the grid's area. Measured: a 692px area, a 337px grid, 360px of board
    // clipped away because a 220px row floor out-ranks `flex`.
    expect(globals).toMatch(/main\.wall-home-fit > \.wall-home-grid-area \{/);
    expect(globals).not.toMatch(/main\.wall-home-fit > div:last-child/);
    expect(globals).toMatch(/main\.wall-home-fit \.wall-widget-grid \{/);
  });

  it("gives the grid area a zero flex-basis so `1fr` has a definite height", () => {
    // With `flex: 1 1 auto` the basis is the grid's intrinsic height and
    // Chromium does not re-resolve `1fr` rows against the shrunken size — which
    // is how a 150px floor ended up clipping 33px off the last row.
    const block = globals.slice(globals.indexOf("main.wall-home-fit > .wall-home-grid-area {"));
    expect(block.slice(0, block.indexOf("}"))).toContain("flex: 1 1 0%");
  });

  it("makes the board four columns with a row floor the leftover height can satisfy", () => {
    const block = globals.slice(globals.indexOf(".wall-board-grid {"));
    expect(block.slice(0, block.indexOf("}"))).toContain("repeat(4, minmax(0, 1fr))");
    expect(block.slice(0, block.indexOf("}"))).toContain("minmax(150px, 1fr)");
  });

  it("puts the board measure in the SAME media query the JS breakpoint uses", () => {
    expect(globals).toMatch(
      /@media \(min-width: 1600px\) and \(max-height: 1300px\) \{\s*\.wall-board-measure \{\s*max-width: 104rem;/,
    );
    expect(WALL_BOARD_MIN_WIDTH).toBe(1600);
    expect(WALL_BOARD_MAX_HEIGHT).toBe(1300);
  });

  it("caps chat below the board's ceiling — a bubble is already 82% of the column", () => {
    expect(globals).toMatch(/\.wall-board-chat \{\s*max-width: 80rem;/);
  });

  it("compacts the widget empty states from the class, not the attribute", () => {
    expect(globals).toMatch(/\n\.wall-widget-grid \[data-empty-state\] \{/);
    expect(globals).not.toMatch(/html\[data-wall="true"\] \.wall-widget-grid/);
  });

  it("keeps the wall empty-state rules free of any font-size below the 12px floor", () => {
    const block = globals.slice(globals.indexOf(".wall-widget-grid [data-empty-state]"));
    for (const size of block.slice(0, 1200).matchAll(/font-size:\s*([\d.]+)px/g)) {
      expect(Number(size[1]), "the wall type floor").toBeGreaterThanOrEqual(12);
    }
  });

  it("does not put a colour literal in the board block", () => {
    const start = globals.indexOf("/* ─── The landscape wall board");
    const block = globals.slice(start, globals.indexOf("/* ─── Wall empty states", start));
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Home: the board is four columns, three rows, and nothing under the dock.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("Home on the board", () => {
  it("puts the bento in its own wrapper and the chrome in a sibling tail", () => {
    expect(home).toContain("wall-home-grid-area");
    expect(home).toContain("wall-home-tail");
  });

  it("withdraws the tail at the board — the dock already carries those destinations", () => {
    // With the tail in the flex column the bento got 184px rows and "Home
    // Security" printed its footer over its own sensor chips. Withdrawing it
    // gave three rows of 249px — the portrait wall's row height.
    expect(home).toMatch(/\{!boardFit && \(\s*<div className="wall-home-tail/);
  });

  it("keeps the wall profile's own gate — wall-composition.test.ts pins this shape", () => {
    expect(home).toMatch(/wallMounted && wall\s*\n\s*\? WALL_GRID_CLASS/);
  });

  it("adds the board grid classes to whichever class it inherited", () => {
    expect(home).toMatch(/boardFit \? `\$\{baseGridClass\} wall-widget-grid wall-board-grid` : baseGridClass/);
  });

  it("takes the board's widget tiers, not the desktop ones", () => {
    expect(home).toContain("wallBoardSpanClass(id)");
    expect(home).toMatch(/boardFit\s*\?\s*wallBoardSpanClass\(id\)/);
  });

  it("keeps the greeting on one line where it has the width for it", () => {
    expect(home).toContain('Good {timeOfDay},{boardFit ? " " : <br />}');
    expect(globals).toMatch(/\.wall-board-greeting br \{\s*display: none;/);
  });

  it("shortens Quick ask's chip row rather than let it spill out of the card", () => {
    // Measured: three chips wrapped to a third line at 463px and pushed the last
    // one 19px past the card edge.
    expect(home).toContain("boardFit ? QUICK_PROMPTS.slice(0, 2) : QUICK_PROMPTS");
  });

  it("keeps the family roster — the wall rail's self-label truncates at board type", () => {
    expect(home).toMatch(/\{!wall && \(\s*<FamilyStrip/);
    expect(home).not.toMatch(/\{wall \|\| boardFit \? \(\s*<WallMemberRail/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. /tasks — the rail is one cell, and it holds the roster it filters.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("/tasks on the board", () => {
  it("puts stats, view switch and roster in ONE grid cell", () => {
    // Grid auto-placement is row-major: as three cells the switch landed in
    // row 2 column 1 and the roster was pushed into the panel's column; as a
    // separate row it fell below the panel's 390px row and opened a 300px hole.
    expect(tasks).toContain("wall-board-rail");
    expect(tasks).toMatch(/wall-board-rail[^"]*"[\s\S]{0,600}?<TasksStats/);
    expect(tasks.indexOf("wall-board-rail")).toBeLessThan(tasks.indexOf("<TasksStats"));
    expect(tasks.indexOf("<TasksStats")).toBeLessThan(tasks.indexOf('className="member-strip member-strip-tiles wall-board-member-strip'));
  });

  it("claims column 2 explicitly for everything the panel owns", () => {
    // Below 1536px the panel spans the full width (md:col-span-2 — a distinct
    // column would leave a dead half beside it); at 2xl the span MUST be reset
    // to 1 or start-2+span-2 would overflow the two-track grid into an implicit
    // third column.
    expect(tasks).toMatch(/className="panel-swap space-y-6 md:col-span-2 2xl:col-span-1 2xl:col-start-2"/);
    expect(tasks).toMatch(/data-testid="task-command-queue"[\s\S]{0,120}?md:col-span-2 2xl:col-span-1 2xl:col-start-2/);
  });

  it("is unchanged below the rail breakpoint — the stat band still spans the page", () => {
    expect(tasks).toMatch(/wall-board-rail space-y-4 md:col-span-2 2xl:col-span-1/);
    expect(tasks).toMatch(/2xl:grid-cols-\[minmax\(0,26rem\)_minmax\(0,1fr\)\]/);
  });

  it("reflows the roster from a sideways scroller into the rail's shape", () => {
    expect(globals).toMatch(/@media \(min-width: 1536px\) \{\s*\.wall-board-member-strip \{/);
    expect(globals).toMatch(/\.wall-board-member-strip \{\s*display: grid;/);
    // …and the "there is more, scroll" mask goes away, because nothing is hidden.
    expect(globals).toMatch(/mask-image: none;/);
  });

  it("stacks the rail's stat tiles, which were 545px wide bands", () => {
    expect(globals).toMatch(/\.wall-board-rail \.grid-cols-3 \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8. /chat — the composer must clear the dock it sits under.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("/chat dock clearance", () => {
  it("reserves 7rem, because the dock is 94px tall and 5.5rem is 88", () => {
    // Measured: the composer's tip line sat 6px BEHIND the dock's top edge.
    expect(chat).toContain("calc(env(safe-area-inset-bottom) + 7rem)");
    expect(chat).not.toContain("calc(env(safe-area-inset-bottom) + 5.5rem)");
  });

  it("widens the thread at xl and on the board, and owns its own ceiling", () => {
    expect(chat).toContain("xl:max-w-3xl");
    expect(chat).toContain("wall-board-chat");
  });

  it("uses the wider measure for the SURROUNDINGS, not for longer lines of text", () => {
    expect(chat).toContain("2xl:grid-cols-[22rem_minmax(0,1fr)]");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 9. Every dense route declares the board measure; the one prose route
 *    declares the read one.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("routes declare their own measure", () => {
  const board: Array<[string, string]> = [
    ["src/app/tasks/page.tsx", "<PageShell measure=\"board\">"],
    ["src/app/analytics/page.tsx", "measure=\"board\""],
    ["src/app/suggestions/page.tsx", "<PageShell measure=\"board\">"],
    ["src/app/ha/page.tsx", "<PageShell measure=\"board\">"],
    ["src/app/ledger/page.tsx", "<PageShell measure=\"board\">"],
  ];
  for (const [file, needle] of board) {
    it(`${file} is a board`, () => expect(read(file), file).toContain(needle));
  }

  it("src/app/rewards/page.tsx is the read route", () => {
    const src = read("src/app/rewards/page.tsx");
    expect(src).toContain('<PageShell measure="read">');
    // Rewards is KID_ROLES and hidden from the wall, so the grown-up half is a
    // short page — it must be centred and capped, not stretched.
    expect(src).toContain("grid min-h-[70svh] place-items-center");
  });

  it("captains the suggestion cards two-up at board width, and caps the empty state", () => {
    const src = read("src/app/suggestions/page.tsx");
    expect(src).toContain("2xl:grid-cols-2");
    expect(src).toMatch(/<div className="mx-auto w-full max-w-2xl">/);
  });

  it("gives the house-controls room grid a third column at board width", () => {
    const src = read("src/app/ha/page.tsx");
    expect(src).toContain("2xl:grid-cols-3");
  });

  it("says HA-offline at the width of the page, not in a corner chip", () => {
    const src = read("src/app/ha/page.tsx");
    expect(src).toContain("Home Assistant is offline");
    expect(src).not.toMatch(/<Chip tone="warning" className="w-fit">Home Assistant offline/);
  });

  it("stops a date input from stretching to 780px across the board", () => {
    const src = read("src/app/analytics/page.tsx");
    expect(src.match(/xl:max-w-xs/g)?.length).toBe(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 10. The trap that is easy to fall back into.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("no board rule overrides a named breakpoint with an arbitrary variant", () => {
  it("finds no `min-[…]:` variant in any board-owned file", () => {
    // Tailwind emits arbitrary min-width variants BEFORE the named breakpoints,
    // so `min-[1600px]:grid-cols-4` is overridden by a plain `sm:grid-cols-2`
    // in the same class string and does nothing at all. Board rules use either
    // a named `2xl:` (which sorts last) or an unlayered stylesheet class.
    const owned = [
      "src/app/page.tsx",
      "src/app/tasks/page.tsx",
      "src/app/ha/page.tsx",
      "src/app/suggestions/page.tsx",
      "src/app/chat/page.tsx",
      "src/app/analytics/page.tsx",
      "src/app/rewards/page.tsx",
      "src/components/ui/PageShell.tsx",
      "src/lib/layout-config.ts",
    ];
    /** Comments are allowed to NAME the trap; class strings are not. */
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const file of owned) {
      expect(stripComments(read(file)), `${file} uses a min-[…]: variant`).not.toMatch(/["'`]\s*min-\[/);
    }
    const boardBlock = globals.slice(globals.indexOf("/* ─── The landscape wall board"));
    expect(boardBlock.slice(0, 6000)).not.toMatch(/@media \(min-width: \d+px\)[^}]*2xl/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 11. What did NOT change — the regressions this work must not cause.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("no regression to the things that were already right", () => {
  it("the portrait wall's grid class is byte-identical", () => {
    // wall-mode.test.ts pins this exact string; if the board had been folded
    // into it, the portrait wall would have inherited four columns.
    expect(WALL_GRID_CLASS).toBe(
      "wall-widget-grid grid grid-cols-3 gap-4 grid-flow-dense auto-rows-[minmax(220px,1fr)]",
    );
  });

  it("still reserves 7rem of dock clearance under Home's board", () => {
    // 7rem = 112px against a 110px wall dock: the figure that fixed the "Open
    // Tasks" row sitting 6px under the dock on the portrait wall.
    const fitRule = globals.slice(globals.indexOf("main.wall-home-fit {"));
    expect(fitRule.slice(0, fitRule.indexOf("}"))).toContain("padding-bottom: 7rem");
  });

  it("keeps the wall's own type floor and 44px target rules scoped to data-wall", () => {
    // The board deliberately does NOT re-scope these: raising the wall type scale
    // is a distance-viewing decision, and the attribute is the honest seam for
    // it. This suite records that as a choice, not an oversight.
    expect(globals).toMatch(/html\[data-wall="true"\] \.text-sm \{\s*font-size: 16px;/);
    expect(globals).toMatch(/html\[data-wall="true"\] \.hit-44::before/);
  });

  it("keeps the wall's single nav surface — this work adds no nav", () => {
    expect(read("src/components/ui/PageShell.tsx")).toContain('import CapsuleNav from "./CapsuleNav"');
    expect(tasks).not.toContain("<CapsuleNav");
    expect(home).not.toContain("<CapsuleNav");
  });
});