// @vitest-environment jsdom
//
// Visual-critic regression pins for the Tasks page, 2026-10-05 wave.
//
// Every assertion here corresponds to a defect MEASURED in a real browser
// (Chromium, both themes) and then fixed in the source — not a guess:
//
//  1. ROW TINT / CONTRAST. The row wash was `color-mix(… 40% → 20%)` on all
//     four accents. Measured against the painted backdrop, every row's own
//     `text-text-secondary` metadata line landed at 2.89–4.16:1 (AA floor for
//     12px body is 4.5:1), and the points chip on it at 4.03–4.16:1. The tint
//     is now 10%→4% with a 22%→10% chip fill, which measures at or above the
//     floor for every accent in both themes.
//
//  2. ROW DENSITY. The board is the Operate surface: a title that truncates to
//     "Wipe down the bathroo…" and a meta line that truncates to "Emily · was
//     due Oct 3 · Ch…" make two different chores indistinguishable. Both now
//     clamp to two lines instead of one ellipsis.
//
//  3. LAYOUT. Below `2xl` the rail is one `md:col-span-2` cell and the active
//     panel is another. The panel had only `2xl:col-start-2`, so at 768 and 1280
//     it auto-placed into column 1 alone and column 2 stayed empty — half the
//     tablet and the whole right side of the laptop dead, with every row
//     truncating for it.
//
//  4. HEADINGS. `CrewTasksCard` / `Rewards` / `Penalties` are PEER cards of the
//     page's `h2` sections but were left on SectionCard's default `h3`.
//
//  5. INK. Raw `--color-accent-*` at 12px measured 3.07:1 (amber) and 3.63:1
//     (mint) on light glass — hard AA failures. These pin the project's own
//     `--color-accent-ink-*` pairing instead.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// The U3-0 gate imports scripts/visual-review/harness.mjs, which imports the
// probe-env map. probe-env resolves a file URL from `import.meta.url`, which
// vitest rewrites to a non-file URL — mock the map so the contract pins can
// import the gate without touching a browser or a real font path.
vi.mock("../../scripts/consuela/probe-env.mjs", () => ({
  NEXT_FONT_MOCK_PATH: "/tmp/next-font-mock.json",
  PROBE_RUNTIME_KEYS: [],
  SAFE_PROBE_ENV: {},
  buildProbeEnv: () => ({}),
}));

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

const LONG = "Wipe down the bathroom counters and scrub the sink";

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-rewards", "[]");
  localStorage.setItem("consuela-penalties", "[]");
  localStorage.setItem("consuela-week-data", JSON.stringify({
    weekStart: "2026-10-05", points: {}, history: [], streak: {}, lastActive: {},
  }));
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
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

describe("Tasks row material + contrast (visual critic 2026-10-05)", () => {
  it("the row wash is at most 10% accent, so the metadata line can clear AA", async () => {
    seed([{ id: 1, title: LONG, assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 12, recurring: null, category: "Chores", completed: false, priority: "high" }]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const row = root.querySelector('[role="button"][aria-label^="Complete"]') as HTMLElement;
    expect(row, "the pending row renders").toBeTruthy();
    const paint = row.style.backgroundImage;

    // No accent may be mixed in above 10%. The old 40%/20% flood is the defect
    // this pins: it is what dropped `text-text-secondary` to 2.89:1.
    const mixes = [...paint.matchAll(/color-mix\(in srgb, var\(--color-accent-[a-z]+\) (\d+)%/g)].map((m) => Number(m[1]));
    expect(mixes.length, "the row paints an accent wash").toBeGreaterThan(0);
    for (const pct of mixes) expect(pct).toBeLessThanOrEqual(10);
    // And the wash must still be a wash — 0% would delete the priority signal's
    // supporting material rather than fix its contrast.
    expect(Math.max(...mixes)).toBeGreaterThan(0);
  });

  it("the points chip fill is at most 22%, so `text-primary` on it clears AA", async () => {
    seed([{ id: 1, title: "Sweep the floor", assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 25, recurring: null, category: "Chores", completed: false, priority: "high" }]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const row = root.querySelector('[role="button"][aria-label^="Complete"]') as HTMLElement;
    const chip = [...row.querySelectorAll("span")].find((s) => s.textContent?.trim() === "+25pts") as HTMLElement;
    expect(chip, "the points chip renders").toBeTruthy();
    const mixes = [...chip.style.background.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    expect(mixes.length).toBeGreaterThan(0);
    for (const pct of mixes) expect(pct).toBeLessThanOrEqual(22);
  });

  it("a long title keeps two lines instead of collapsing to one ellipsis", async () => {
    seed([{ id: 1, title: LONG, assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 12, recurring: null, category: "Chores", completed: false, priority: "medium" }]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const row = root.querySelector('[role="button"][aria-label^="Complete"]') as HTMLElement;
    const title = [...row.querySelectorAll("div")].find((d) => d.textContent === LONG) as HTMLElement;
    expect(title, "the row renders the title").toBeTruthy();
    expect(title.className).toContain("line-clamp-2");
    // `truncate` is the defect: one line, ellipsis, two chores look alike.
    expect(title.className).not.toMatch(/\btruncate\b/);
    // The full string stays in the DOM either way; the attribute is what a
    // desktop hover reads for the full title.
    expect(title.getAttribute("title")).toBe(LONG);
  });

  it("the metadata line is not truncated mid-word", async () => {
    seed([{ id: 1, title: "Sweep the floor", assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 12, recurring: null, category: "Chores", completed: false, priority: "medium" }]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const row = root.querySelector('[role="button"][aria-label^="Complete"]') as HTMLElement;
    const meta = [...row.querySelectorAll("div")].find((d) => /^Jasmine ·/.test(d.textContent || "")) as HTMLElement;
    expect(meta, "the meta line renders").toBeTruthy();
    expect(meta.className).not.toMatch(/\btruncate\b/);
    // The category must survive — it was the token the ellipsis ate.
    expect(meta.textContent).toContain("Chores");
  });
});

describe("Tasks layout below 2xl (visual critic 2026-10-05)", () => {
  it("the active panel spans both md columns, so no half-width dead column", async () => {
    seed([{ id: 1, title: "Sweep the floor", assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 12, recurring: null, category: "Chores", completed: false, priority: "medium" }]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const panel = root.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel, "the chore board panel renders").toBeTruthy();
    // Without this the panel auto-placed into column 1 of `md:grid-cols-2`
    // and column 2 rendered nothing at all.
    expect(panel.className).toContain("md:col-span-2");
    expect(panel.className).toContain("2xl:col-start-2");
  });

  it("the rail and the panel are both full-width cells below 2xl", async () => {
    seed([]);
    const root = await renderAsync(<TasksPage />);
    await settle();
    const rail = root.querySelector(".wall-board-rail") as HTMLElement;
    expect(rail.className).toContain("md:col-span-2");
    expect(rail.className).toContain("2xl:col-span-1");
  });
});

describe("Tasks heading outline (visual critic 2026-10-05)", () => {
  it("the page keeps exactly one h1 and no skipped level", async () => {
    seed([{ id: 1, title: "Sweep the floor", assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 12, recurring: null, category: "Chores", completed: false, priority: "medium" }]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const levels = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1).length, "one h1").toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], `h${levels[i - 1]} → h${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });

  it("Crew tasks is a peer of the h2 sections, so it is an h2 too", async () => {
    mockAuth.currentUser = { name: "Rebecca Garcia", role: "parent", emoji: "👩", color: "violet" };
    mockAuth.isLoggedIn = true;
    seed([
      { id: 1, title: "Deep clean the garage", assignee: "All", assigneeEmoji: "🤝", due: "2026-10-06", points: 20, recurring: null, category: "Chores", completed: false, priority: "medium", universal: true, crewSize: 3, crew: { members: [{ name: "Jasmine Garcia", emoji: "👧", joinedAt: "2026-10-05T00:00:00.000Z" }] }, crewCloseMode: "strict" },
      { id: 2, title: "Sweep the floor", assignee: "Jasmine Garcia", assigneeEmoji: "👧", due: "2026-10-05", points: 12, recurring: null, category: "Chores", completed: false, priority: "medium" },
    ]);
    const root = await renderAsync(<TasksPage />);
    await settle();

    const crew = [...root.querySelectorAll("h2, h3")].find((h) => (h.textContent || "").includes("Crew tasks")) as HTMLElement;
    expect(crew, "the crew card renders for a parent").toBeTruthy();
    expect(crew.tagName, "a peer card of the h2 sections must not drop to h3").toBe("H2");
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });
});

describe("Tasks accent ink (visual critic 2026-10-05)", () => {
  it("a >100-pt reward's 'needs parent' note uses the ink token, not a raw 12px accent", async () => {
    // Raw `--color-accent-amber` at 12px on light glass measured 3.07:1 — a hard
    // AA failure. The project's own `--color-accent-ink-amber` is the documented
    // pairing for exactly this case and measures 6.66:1 there.
    const { default: TasksRewardsPanel } = await import("@/components/tasks/TasksRewardsPanel");
    const root = await renderAsync(
      <TasksRewardsPanel
        canManage
        rewards={[{ id: 1, name: "Trip to the water park", cost: 150, emoji: "🎢", claimed: false } as any]}
        aiRewards={[]}
        aiRewardSuggesting={false}
        onGenerateAi={() => {}}
        onAdd={() => {}}
        onAdopt={() => {}}
        onRedeem={() => {}}
        onEdit={() => {}}
        penalties={[]}
        onAddPenalty={() => {}}
        onApplyPenalty={() => {}}
        onEditPenalty={() => {}}
      />,
    );
    await settle();

    const note = [...root.querySelectorAll("span")].find((s) => (s.textContent || "").includes("needs parent")) as HTMLElement;
    expect(note, "the >100pt reward says a parent is needed").toBeTruthy();
    expect(note.className).toContain("--color-accent-ink-amber");
    // The old defect was an inline `style={{ color: "var(--color-accent-amber)" }}`.
    expect(note.getAttribute("style") ?? "").not.toMatch(/--color-accent-(amber|mint|rose|cyan|nori|violet)\b/);
  });

  it("the crew card's '✓ done' chip and the quarantine notice use ink tokens", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    // These three shipped raw 12px accents: mint 3.63:1 and amber 3.07:1 on
    // light glass, rose 3.99:1 on the notice's own amber plate.
    for (const file of [
      "src/components/tasks/CrewTasksCard.tsx",
      "src/components/tasks/TaskLedgerQuarantineNotice.tsx",
    ]) {
      const raw = read(file).match(/text-\[var\(--color-accent-(?!ink-)(amber|mint|rose|cyan|nori|violet)\)\]/g) ?? [];
      expect(raw, `${file} has no raw accent used as 12px ink`).toEqual([]);
    }
  });
});

// ─── U3-0: the machine gate's JSON contract ─────────────────────────────────
// These pins keep `scripts/visual-review/tasks-review.mjs` itself under test:
// the key surfaces a critic reads must not drift, the defaults must stay the
// plan's flag surface, and the measurement method strings must stay in the
// source (a critic never hand-writes a driver or a ratio table — §B).

describe("the visual gate's JSON contract (U3-0)", () => {
  const loadGate = async () => await import("../../scripts/visual-review/tasks-review.mjs");

  it("pins the entry key surface and the gate keys", async () => {
    const gate: any = await loadGate();
    expect([...gate.GATE_KEYS]).toEqual([
      "fixtureRendered",
      "contrast",
      "typeFloor",
      "tap",
      "overflow320",
      "clipped",
      "clsTwoWay",
      "focusRing",
      "baselineDrift",
      "keyboard",
    ]);
    const skeleton = gate.buildEntrySkeleton({ role: "parent", viewport: "320x568", theme: "dark" });
    expect(Object.keys(skeleton).sort()).toEqual([...gate.ENTRY_KEYS].sort());
    expect(Object.keys(skeleton.gates).sort()).toEqual([...gate.GATE_KEYS].sort());
    expect(skeleton.exitCode).toBe(1);
    expect(skeleton.redirected).toBe(false);
    expect(skeleton.cls).toEqual({});
    expect(skeleton.fixture).toEqual({});
    expect(skeleton.motion).toEqual({});
  });

  it("pins the run key surface", async () => {
    const gate: any = await loadGate();
    expect([...gate.RUN_KEYS]).toEqual([
      "schema",
      "generatedAt",
      "route",
      "state",
      "wall",
      "matrix",
      "fixture",
      "entries",
      "states",
      "summary",
      "problems",
      "problemsBySeverity",
      "consoleErrors",
      "pageErrors",
      "failedRequests",
      "unstubbed",
      "gates",
      "exitCode",
    ]);
  });

  it("phoneSmall is required in every pass and wide1536 is a real register", async () => {
    const gate: any = await loadGate();
    expect(gate.resolveViewportNames("all")).toContain("phoneSmall");
    expect(gate.resolveViewportNames("all")).toContain("wide1536");
    expect(gate.resolveViewportNames("desktop")).toContain("phoneSmall");
    expect(gate.VIEWPORT_REGISTER.wide1536).toEqual({ width: 1536, height: 900, label: expect.any(String) });
  });

  it("defaults match the plan's flag surface", async () => {
    const gate: any = await loadGate();
    const args = gate.parseArgs([]);
    expect(args.route).toBe("/tasks");
    expect(args.role).toBe("parent,child,guest");
    expect(args.theme).toBe("dark,light");
    expect(args.viewport).toBe("all");
    expect(args.state).toBe("populated");
    expect(args.updateBaselines).toBe(false);
  });

  it("requires the live-DOM fixture counts for the parent persona only", async () => {
    const gate: any = await loadGate();
    const counts = { pending: 5, solo: 3, crew: 2, bonus: 1, settled: 11, weeks: 4 };
    expect(gate.requiredCountsFor("populated", "parent", counts)).toEqual({
      renderedCompletedRows: 11,
      renderedWeekGroups: 4,
      renderedApprovalRows: 5,
    });
    expect(gate.requiredCountsFor("populated", "guest", counts)).toEqual({});
    expect(gate.requiredCountsFor("sync-failed", "parent", counts)).toEqual({});
  });

  it("classifies the fixture's pending rows without touching the DOM", async () => {
    const gate: any = await loadGate();
    const classified = gate.classifyFixtureTasks([
      { id: 1, points: 5, pendingApproval: { points: 5 } },
      { id: 2, points: 6, pendingApproval: { points: 9 } },
      { id: 3, points: 4, pendingApproval: { points: 4, crew: ["A", "B"] } },
      { id: 4, completed: true },
      { id: 5, completed: true, completedInWeek: "2026-10-05" },
    ]);
    expect(classified.counts).toEqual({ pending: 3, solo: 2, crew: 1, bonus: 1, settled: 2, weeks: 1 });
  });

  it("keeps the frame's measurement methods in the source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/visual-review/tasks-review.mjs"), "utf8");
    for (const token of [
      "hidden-glyph-recapture",
      "p05Luminance",
      "hadRecentInput",
      "forcedLayoutDisclosure",
      "forcedLayoutResize",
      "reducedMotionMaxTransitionMs",
      "baselineDiffPx",
      "renderedQueueOrder",
      "renderedTitlesEllipsised",
      "computeFocusRing",
      "clsForcedSummary",
      "getImageData",
      "createImageBitmap",
      "motion-baseline.json",
      "keyboard.json",
    ]) {
      expect(src, token).toContain(token);
    }
  });
});

// ─── U2: the Completed card's disclosure is CSS-only, on the motion tokens ──
// The browser gate measures the rendered result; these pins hold the source
// contracts the gate cannot read: no keyframes, the CapsuleNav 0fr→1fr
// precedent on --motion-base, and the declared 64px wall floors (§E-1).

describe("U2 — the Completed card's disclosure contracts", () => {
  it("pins the 0fr→1fr expansion and the wall floors in globals.css", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".tasks-disclosure-panel");
    expect(css).toMatch(/grid-template-rows:\s*0fr/);
    expect(css).toMatch(/transition:\s*grid-template-rows var\(--motion-base\) var\(--ease-standard\)/);
    expect(css).toContain('.tasks-disclosure[aria-expanded="true"] .tasks-disclosure-chevron');
    expect(css).toContain('html[data-wall="true"] .tasks-disclosure');
    expect(css).toContain('html[data-wall="true"] .tasks-week-group-header');
  });
});

