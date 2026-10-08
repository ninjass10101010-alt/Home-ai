// @vitest-environment jsdom
// The final Tasks-page follow-ups from the production wave:
//
//   A  every TIED leaderboard row printed `#0` — the tie branch read the rank
//      placeholder off the array being mapped instead of the rank the previous
//      iteration had computed, so 100/100/60/60/10 rendered 1/0/3/0/5.
//   B  `dynamicLeaderboard[myEntry.rank - 2]` assumed ORDINAL ranks, so under
//      competition ranking the neighbour it picked was the wrong row (or itself).
//   C  the deprecated, ignored `index` prop was still being passed to
//      LeaderboardRow with an unused map parameter.
//   D  the view switch was a `radiogroup` with no id and no `aria-controls`, and
//      the two panels it swaps were unlabelled regions.
//   E  `SoftButton variant="secondary"` painted `--color-accent-button` on
//      `--color-surface-2` at 1.88–3.42:1 in dark.
//
// The harness (roster, fetch stub, seed/render/settle helpers) is deliberately
// shaped like tests/unit/tasks-page-integrity-fixes.test.tsx, the house style
// for driving this page: nothing here asserts a class name, and the colour case
// COMPUTES its contrast from the real token values in the live stylesheet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { localWeekStartISO, localTodayISO } from "@/lib/local-date";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import TasksPage from "@/app/tasks/page";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SoftButton from "@/components/ui/SoftButton";
import { TASKS_VIEW_SWITCH_ID, TASKS_PANEL_IDS } from "@/components/tasks/TasksStats";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Five members in ALPHABETICAL order, so a stable `points` sort and the hook's
// `points || name` sort agree on ORDER — which is what lets the page's ranks be
// compared member-by-member against useLeaderboardData's.
const ROSTER = [
  { id: 1, name: "Ann", fullName: "Ann", role: "parent", emoji: "🧑", color: "nori" },
  { id: 2, name: "Ben", fullName: "Ben", role: "child", age: 12, emoji: "🧒", color: "cyan" },
  { id: 3, name: "Cleo", fullName: "Cleo", role: "child", age: 9, emoji: "👧", color: "rose" },
  { id: 4, name: "Dana", fullName: "Dana", role: "child", age: 7, emoji: "👧", color: "amber" },
  { id: 5, name: "Eli", fullName: "Eli", role: "child", age: 5, emoji: "👦", color: "mint" },
];

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// Deterministic all-time totals: the page and useLeaderboardData both read this
// hook, and its network read would otherwise race the render assertions.
vi.mock("@/hooks/useAllTimeTotals", () => ({
  ALL_TIME_CACHE_KEY: "consuela-all-time-cache-v1",
  ALL_TIME_ROUTE: "/api/tasks/all-time",
  parseAllTimePayload: () => null,
  useAllTimeTotals: () => ({
    totals: {},
    state: "authoritative",
    source: "pocketbase",
    updatedAt: null,
    error: null,
  }),
}));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => ROSTER,
    selectMembersFallback: () => ROSTER,
  },
}));

const MONDAY = localWeekStartISO();

const server = vi.hoisted(() => ({
  verifyOkFor: "" as string,
  verifyStatus: 200,
  ledgerStatus: 200,
  ledgerBody: null as null | any,
  manageStatus: 200,
  manageBody: null as null | any,
  syncStatus: 200,
  syncThrows: false,
  syncSnapshot: null as null | any,
  requests: [] as any[],
}));

function seed(tasks: any[], extra?: { points?: Record<string, number>; rewards?: any[]; penalties?: any[] }) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({
    weekStart: MONDAY,
    points: extra?.points ?? {},
    streak: {},
    lastActive: {},
    history: [],
  }));
  if (extra?.rewards) localStorage.setItem("consuela-rewards", JSON.stringify(extra.rewards));
  if (extra?.penalties) localStorage.setItem("consuela-penalties", JSON.stringify(extra.penalties));
}

function safeParse(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? safeParse(String(init.body)) : null;
    if (url.includes("/api/members/verify")) {
      const asked = String(body?.memberName ?? "");
      const ok = server.verifyStatus === 200 && server.verifyOkFor.split("|").includes(asked);
      if (!ok) return { ok: false, status: server.verifyStatus === 200 ? 401 : server.verifyStatus, json: async () => ({ error: "unauthorized" }) };
      const member = ROSTER.find((m) => m.fullName === asked)!;
      return { ok: true, status: 200, json: async () => ({ member: { name: member.name, fullName: member.fullName, role: member.role } }) };
    }
    if (url === "/api/tasks/sync") {
      if (server.syncThrows) throw new TypeError("network unavailable");
      if (server.syncStatus !== 200) return { ok: false, status: server.syncStatus, json: async () => ({ error: "unavailable" }) };
      return { ok: true, status: 200, json: async () => ({ snapshot: server.syncSnapshot, reconciled: true }) };
    }
    if (url === "/api/tasks/ledger") {
      server.requests.push({ route: url, body });
      return {
        ok: server.ledgerStatus < 400,
        status: server.ledgerStatus,
        json: async () => server.ledgerBody ?? { success: true, reconciled: true, weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] } },
      };
    }
    if (url === "/api/tasks/manage") {
      server.requests.push({ route: url, body });
      return { ok: server.manageStatus < 400, status: server.manageStatus, json: async () => server.manageBody ?? { success: true } };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function requestsFor(route: string) {
  return server.requests.filter((entry) => entry.route.includes(route));
}

let root: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { root = createRoot(el); root.render(ui); });
  return el;
}

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

async function unmount() {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  document.body.innerHTML = "";
}

function text(): string { return document.body.textContent || ""; }

function buttonByText(label: string, scope?: ParentNode): HTMLButtonElement {
  const host = scope ?? document.querySelector('[role="dialog"]') ?? document;
  const found = Array.from(host.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === label || (b.textContent || "").trim().includes(label),
  ) as HTMLButtonElement | undefined;
  expect(found, `button "${label}"`).toBeTruthy();
  return found!;
}

async function clickByAriaLabel(label: string) {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  expect(el, `aria-label="${label}"`).not.toBeNull();
  await act(async () => { el.click(); });
  await settle();
}

async function typePin(placeholder: string, pin: string) {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input, `field "${placeholder}"`).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, pin);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function setSelectValue(value: string) {
  const select = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
  expect(select, "dialog select").not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function submitDialog(label: string) {
  await act(async () => { buttonByText(label).click(); });
  await settle(160);
}

async function toLeaderboard() {
  await act(async () => { buttonByText("Leaderboard", document).click(); });
  await settle(140);
}

async function signInAs(name: string, role = "child", age = 12) {
  mockAuth.currentUser = { name, role, age, emoji: "🧒" };
  mockAuth.isLoggedIn = true;
}

const CHORE = {
  id: 71, title: "Water the plants", assignee: "Dana", assigneeEmoji: "🧒",
  due: localTodayISO(), points: 5, recurring: null, category: "Chores",
  completed: false, priority: "low", universal: false, stealable: false,
};

const CREW_TASK = {
  id: 70, title: "Clean the garage", assignee: "Crew", assigneeEmoji: "🤝",
  due: localTodayISO(), points: 10, recurring: null, category: "Chores",
  completed: false, priority: "medium", universal: false, stealable: false,
  crewSize: 3, crew: { members: [] }, crewCloseMode: "strict",
};

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  server.verifyOkFor = "";
  server.verifyStatus = 200;
  server.ledgerStatus = 200;
  server.ledgerBody = null;
  server.manageStatus = 200;
  server.manageBody = null;
  server.syncStatus = 200;
  server.syncThrows = false;
  server.syncSnapshot = null;
  server.requests = [];
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
  installFetch();
});

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// A — the tied leaderboard rows printed #0
// ─────────────────────────────────────────────────────────────────────────────

describe("A a tied row shares the rank it ties on, and never prints #0", () => {
  /** name → rank, read off the accessible name every leaderboard row carries. */
  function ranksFromLabels(scope: ParentNode): Record<string, number> {
    const out: Record<string, number> = {};
    for (const node of scope.querySelectorAll('[role="button"][aria-label*="rank "]')) {
      const label = node.getAttribute("aria-label") || "";
      const match = label.match(/^([^:]+): (\d+) points, rank (\d+)$/);
      if (match) out[match[1]] = Number(match[3]);
    }
    return out;
  }

  it("100/100/60/60/10 renders 1, 1, 3, 3, 5", async () => {
    await signInAs("Ann", "parent");
    seed([], { points: { Ann: 100, Ben: 100, Cleo: 60, Dana: 60, Eli: 10 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const panel = el.querySelector(`#${TASKS_PANEL_IDS.leaderboard}`) as HTMLElement;
    expect(panel).not.toBeNull();

    // Every row's accessible name states its rank. The Podium computes its own
    // rank from points (`#{strictly above} + 1`), so it is an INDEPENDENT read of
    // the same competition-ranking rule.
    expect(ranksFromLabels(panel)).toEqual({
      Ann: 1, Ben: 1, Cleo: 3, Dana: 3, Eli: 5,
    });

    // Rows 4+ render the badge as visible text. The bug printed `#0` there.
    // Only the INNERMEST element whose whole text is a badge counts — the badge
    // div is wrapped in a positioning div whose textContent is the same string.
    const badges = Array.from(panel.querySelectorAll("div"))
      .filter((node) => /^#\d+$/.test((node.textContent || "").trim()))
      .filter((node) => !Array.from(node.querySelectorAll("div")).some((inner) =>
        /^#\d+$/.test((inner.textContent || "").trim()),
      ))
      .map((node) => (node.textContent || "").trim());
    expect(badges.length).toBeGreaterThan(0);
    expect(badges).toEqual(["#3", "#5"]);
    expect(text()).not.toContain("#0");
  });

  it("agrees member-for-member with useLeaderboardData on the same week", async () => {
    // ONE convention in the codebase: the Home/wall/KidHome hook and this page
    // must not rank one and the same week two different ways.
    const { useLeaderboardData } = await import("@/components/leaderboard/hooks/useLeaderboardData");
    let hookEntries: Array<{ name: string; points: number; rank: number }> = [];
    function Probe() {
      const { data } = useLeaderboardData();
      hookEntries = data.entries as Array<{ name: string; points: number; rank: number }>;
      return null;
    }

    await signInAs("Ann", "parent");
    seed([], { points: { Ann: 100, Ben: 100, Cleo: 60, Dana: 60, Eli: 10 } });
    const el = await renderAsync(
      <>
        <TasksPage />
        <Probe />
      </>,
    );
    await settle(200);
    await toLeaderboard();

    const panel = el.querySelector(`#${TASKS_PANEL_IDS.leaderboard}`) as HTMLElement;
    const fromPage = ranksFromLabels(panel);
    const fromHook = Object.fromEntries(hookEntries.map((e) => [e.name, e.rank]));

    expect(hookEntries.length).toBeGreaterThan(0);
    expect(fromPage).toEqual(fromHook);
    expect(Object.values(fromHook).filter((rank) => rank === 0)).toEqual([]);
  });

  it("a three-way tie shares one rank and the next rank is skipped", async () => {
    await signInAs("Ann", "parent");
    seed([], { points: { Ann: 100, Ben: 100, Cleo: 100, Dana: 50, Eli: 10 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const panel = el.querySelector(`#${TASKS_PANEL_IDS.leaderboard}`) as HTMLElement;
    expect(ranksFromLabels(panel)).toEqual({
      Ann: 1, Ben: 1, Cleo: 1, Dana: 4, Eli: 5,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — the neighbour of a tied row is found by POSITION, not by `rank - 2`
// ─────────────────────────────────────────────────────────────────────────────

describe("B the row above/below is a POSITION, so a tie cannot pick the wrong row", () => {
  const panelText = (el: HTMLElement) =>
    (el.querySelector(`#${TASKS_PANEL_IDS.leaderboard}`) as HTMLElement).textContent || "";

  it("a tie at the top: the tied leader reads the shared rank, and the row below is a real neighbour", async () => {
    // Ben is TIED for first. Two failures share this one row: the tie branch read
    // the `rank: 0` placeholder, so the card printed `#0`; and `rank ± 1` assumed
    // an ordinal, so the "closing in" nudge had no neighbour to compare against.
    await signInAs("Ben");
    seed([], { points: { Ann: 100, Ben: 100, Cleo: 80, Dana: 70, Eli: 50 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const rendered = panelText(el);
    expect(rendered).not.toContain("#0");
    // Rank 1 on points > 0 → the lead copy, on the SHARED rank.
    expect(rendered).toContain("You're in the lead!");
    // The row DIRECTLY BELOW is Cleo at 80 — a real neighbour, 20 points back.
    expect(rendered).toContain("Cleo is closing in! Only 20 pts behind you!");
  });

  it("a tie at the bottom: the last tied member is given no invented gap", async () => {
    // Eli is level with the row directly above him (Dana, 70). Neither the old
    // ordinal arithmetic nor a naive "points behind the leader" shortcut may
    // invent a positive gap: the card must fall through to its neutral copy.
    await signInAs("Eli");
    seed([], { points: { Ann: 100, Ben: 90, Cleo: 80, Dana: 70, Eli: 70 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const rendered = panelText(el);
    expect(rendered).not.toContain("pts behind Cleo");
    expect(rendered).not.toContain("is closing in!");
    expect(rendered).toContain("Complete tasks to climb the board!");
  });

  it("rank 1 with nobody tied: there is no row above, and nothing crashes", async () => {
    await signInAs("Ann", "parent");
    seed([], { points: { Ann: 100, Ben: 80, Cleo: 70, Dana: 60, Eli: 50 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const rendered = panelText(el);
    // `myIndex - 1` is -1 here, so the neighbour is `undefined` rather than a
    // wrapped read off the end of the array.
    expect(rendered).toContain("You're in the lead!");
    expect(rendered).not.toContain("you can catch up!");
    expect(rendered).toContain("Ben is closing in! Only 20 pts behind you!");
  });

  it("the last rank with nobody tied: the row above is real and there is nothing below", async () => {
    await signInAs("Eli");
    seed([], { points: { Ann: 100, Ben: 90, Cleo: 80, Dana: 70, Eli: 60 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const rendered = panelText(el);
    expect(rendered).toContain("10 pts behind Dana — you can catch up!");
    expect(rendered).not.toContain("is closing in!");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — the deprecated, ignored `index` prop
// ─────────────────────────────────────────────────────────────────────────────

describe("C the leaderboard rows are no longer handed a positional index", () => {
  const pageSource = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");
  const rowSource = readFileSync(join(process.cwd(), "src/components/leaderboard/LeaderboardRow.tsx"), "utf8");

  it("the LeaderboardRow call site passes no index prop", () => {
    const callSite = pageSource.slice(pageSource.indexOf("<LeaderboardRow"));
    expect(callSite.length).toBeGreaterThan(0);
    expect(pageSource).not.toMatch(/<LeaderboardRow[\s\S]{0,400}?\bindex=/);
  });

  it("the rows map over entries without an unused index parameter", () => {
    expect(pageSource).not.toMatch(/dynamicLeaderboard\.slice\(3\)\.map\(\s*\(\s*entry\s*,\s*index\s*\)/);
    expect(pageSource).toContain("dynamicLeaderboard.slice(3).map((entry) => (");
  });

  it("the row renders its badge from entry.rank and ignores index entirely", () => {
    expect(rowSource).toContain("#{entry.rank}");
    // The prop is still declared optional on the type (removing it is a wider
    // change), but nothing reads it.
    expect(rowSource.slice(rowSource.indexOf("export default function LeaderboardRow")))
      .not.toMatch(/\bindex\b/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — the view switch is LINKED to the panel it swaps
// ─────────────────────────────────────────────────────────────────────────────

describe("D the view switch names the panel it swaps", () => {
  it("the group has an id and each radio's aria-controls names the panel it swaps", async () => {
    await signInAs("Ann", "parent");
    seed([CHORE], { points: { Ann: 100 } });
    const el = await renderAsync(<TasksPage />);
    await settle();

    const group = el.querySelector(`[role="radiogroup"][aria-label="Tasks view"]`) as HTMLElement;
    expect(group).not.toBeNull();
    expect(group.getAttribute("id")).toBe(TASKS_VIEW_SWITCH_ID);
    expect(TASKS_VIEW_SWITCH_ID.length).toBeGreaterThan(0);

    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => (r.textContent || "").trim())).toEqual(["Tasks", "Leaderboard"]);
    const controls = radios.map((r) => r.getAttribute("aria-controls"));
    expect(controls).toEqual([TASKS_PANEL_IDS.tasks, TASKS_PANEL_IDS.leaderboard]);
    expect(new Set(controls).size).toBe(2);

    // Only the ACTIVE panel is mounted, so each is resolved in its own state —
    // the leaderboard half is the second case below.
    const board = el.querySelector(`#${TASKS_PANEL_IDS.tasks}`) as HTMLElement;
    expect(board).not.toBeNull();
    expect(board.getAttribute("role")).toBe("tabpanel");
    expect(board.getAttribute("aria-labelledby")).toBe(TASKS_VIEW_SWITCH_ID);
    // The label the two sides share must actually resolve.
    expect(el.querySelector(`#${TASKS_VIEW_SWITCH_ID}`)).toBe(group);
  });

  it("the LEADERBOARD panel is a tabpanel labelled by the group too", async () => {
    await signInAs("Ann", "parent");
    seed([CHORE], { points: { Ann: 100, Ben: 40 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    const panel = el.querySelector(`#${TASKS_PANEL_IDS.leaderboard}`) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(TASKS_VIEW_SWITCH_ID);

    // The group is still mounted and still names it.
    const group = el.querySelector(`[role="radiogroup"][id="${TASKS_VIEW_SWITCH_ID}"]`);
    expect(group).not.toBeNull();
    const leaderboardRadio = Array.from(group!.querySelectorAll('[role="radio"]'))
      .find((r) => (r.textContent || "").trim() === "Leaderboard")!;
    expect(leaderboardRadio.getAttribute("aria-controls")).toBe(TASKS_PANEL_IDS.leaderboard);
  });

  it("a SegmentedControl that passes neither new prop renders exactly as before", async () => {
    // Optional props must default to today's behaviour: no id, no aria-controls,
    // same radios, same classes.
    const before = [
      "relative flex w-full flex-wrap rounded-2xl bg-[var(--color-surface-2)] p-1",
    ].join("");
    const el = await renderAsync(
      <SegmentedControl
        aria-label="Nothing swapped"
        value="a"
        onChange={() => {}}
        options={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
      />,
    );
    await settle();
    const group = el.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group).not.toBeNull();
    expect(group.hasAttribute("id")).toBe(false);
    expect(group.className).toContain("relative flex w-full flex-wrap rounded-2xl");
    expect(before.length).toBeGreaterThan(0);
    for (const radio of Array.from(group.querySelectorAll('[role="radio"]'))) {
      expect(radio.hasAttribute("aria-controls")).toBe(false);
      expect(radio.getAttribute("aria-checked")).toBe(radio.textContent?.trim() === "A" ? "true" : "false");
    }
  });

  it("the ariaControls callback may decline an option, and that radio gets no aria-controls", async () => {
    const el = await renderAsync(
      <SegmentedControl
        id="probe-group"
        aria-label="Probe"
        ariaControls={(option) => (option.id === "b" ? "probe-panel" : undefined)}
        value="a"
        onChange={() => {}}
        options={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
      />,
    );
    await settle();
    const group = el.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.getAttribute("id")).toBe("probe-group");
    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(radios[0].hasAttribute("aria-controls")).toBe(false);
    expect(radios[1].getAttribute("aria-controls")).toBe("probe-panel");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — SoftButton secondary ink, MEASURED across all ten accents in both themes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A hand-rolled resolver, because jsdom does not cascade stylesheets or resolve
 * custom properties (the same reasoning as tests/unit/theme-token-contrast.test.ts):
 * for the (theme, accent) pair under test, walk the `:root…` blocks of the live
 * stylesheet, take the last applicable declaration, then substitute `var()` and
 * evaluate `color-mix()` with premultiplied alpha. Everything asserted below is a
 * NUMBER derived from the token values the browser would actually paint.
 */
const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const ACCENTS = ["nori", "violet", "rose", "coral", "lavender", "cyan", "mint", "amber", "apricot", "sage"] as const;
type Accent = (typeof ACCENTS)[number];
type Theme = "light" | "dark";

type Rgba = [number, number, number, number];

interface Block { selector: string; decls: Record<string, string>; order: number }

function readBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  const stack: Array<Record<string, string>> = [];
  const wrappers: string[] = [];
  let buffer = "";
  let quote: string | null = null;
  const flush = (into: Record<string, string>) => {
    for (const decl of buffer.split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim();
      if (!prop.startsWith("--")) continue;
      into[prop] = decl.slice(idx + 1).trim();
    }
    buffer = "";
  };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      buffer += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buffer += ch; continue; }
    if (ch === "{") {
      const prelude = buffer.trim().split(";").pop()?.trim() ?? "";
      buffer = "";
      const decls: Record<string, string> = {};
      if (/^@(media|supports|layer|container)\b/.test(prelude)) { wrappers.push(prelude); stack.push(decls); }
      else { stack.push(decls); blocks.push({ selector: prelude, decls, order: blocks.length }); }
      continue;
    }
    if (ch === "}") {
      flush(stack.length ? stack[stack.length - 1] : {});
      const closed = stack.pop();
      if (closed && /^@(media|supports|layer|container)\b/.test(wrappers[wrappers.length - 1] || "")) wrappers.pop();
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  return blocks;
}

const BLOCKS = readBlocks(CSS);

function blockApplies(selector: string, theme: Theme, accent: Accent): boolean {
  const s = selector.replace(/\s+/g, "");
  if (s === "@theme" || s === ":root") return true;
  const attr = (name: string) => {
    const m = s.match(new RegExp(`\\[${name}=["']([^"']+)["']\\]`));
    return m ? m[1] : null;
  };
  const wantedTheme = attr("data-theme");
  const wantedAccent = attr("data-accent");
  if (wantedTheme !== null && wantedTheme !== theme) return false;
  if (wantedAccent !== null && wantedAccent !== accent) return false;
  // `:root:not([data-theme="dark"])` is the pre-hydration light branch.
  const negated = s.match(/:not\(\[data-theme="(\w+)"\]\)/);
  if (negated && negated[1] === theme) return false;
  if (/\[data-contrast="boost"\]/.test(s)) return false;
  return /^:root/.test(s);
}

function rawToken(name: string, theme: Theme, accent: Accent): string {
  let found: string | undefined;
  for (const block of BLOCKS) {
    if (!(name in block.decls)) continue;
    if (!blockApplies(block.selector, theme, accent)) continue;
    found = block.decls[name];
  }
  return found ?? "";
}

const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  transparent: [0, 0, 0, 0],
};

function hexToRgba(hex: string): Rgba {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
}

function splitTopLevel(input: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) { out.push(current); current = ""; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

function evaluate(raw: string, theme: Theme, accent: Accent, stack: string[]): Rgba {
  const expr = raw.trim();
  if (expr.startsWith("color-mix(")) {
    const inner = splitTopLevel(expr.slice("color-mix(".length, expr.lastIndexOf(")")), ",").slice(1);
    const [leftRaw, rightRaw] = inner;
    const pct = (part: string) => {
      const m = part.match(/([\d.]+)%\s*$/);
      return m ? Number(m[1]) / 100 : null;
    };
    const p1 = pct(leftRaw);
    const p2 = pct(rightRaw);
    const c1 = evaluate(leftRaw.replace(/[\d.]+%\s*$/, ""), theme, accent, stack);
    const c2 = evaluate(rightRaw.replace(/[\d.]+%\s*$/, ""), theme, accent, stack);
    const t1 = p1 === null && p2 === null ? 0.5 : p1 ?? 1 - (p2 as number);
    const t2 = p2 === null && p1 === null ? 0.5 : p2 ?? 1 - t1;
    const a1 = t1 * c1[3];
    const a2 = t2 * c2[3];
    const alpha = a1 + a2;
    if (alpha === 0) return [0, 0, 0, 0];
    const ch = (i: number) => (a1 * c1[i] + a2 * c2[i]) / alpha;
    return [ch(0), ch(1), ch(2), alpha];
  }
  const asVar = expr.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (asVar) {
    const name = asVar[1];
    if (stack.includes(name)) throw new Error(`cycle: ${[...stack, name].join(" -> ")}`);
    return evaluate(rawToken(name, theme, accent), theme, accent, [...stack, name]);
  }
  if (expr.startsWith("#")) return hexToRgba(expr);
  const named = NAMED[expr.toLowerCase()];
  if (named) return [...named] as Rgba;
  throw new Error(`unsupported colour value: ${expr}`);
}

function luminance(rgb: Rgba): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const ratio2 = (n: number) => Math.round(n * 100) / 100;
const token = (name: string, theme: Theme, accent: Accent) => evaluate(rawToken(name, theme, accent), theme, accent, []);

/**
 * The ink a SoftButton secondary paints, resolved from the CLASS the primitive
 * actually renders. Read out of the source rather than restated here, so the
 * measurement cannot drift away from the shipped variant.
 */
function secondaryInkSource(): string {
  const source = readFileSync(join(process.cwd(), "src/components/ui/SoftButton.tsx"), "utf8");
  const line = source.split("\n").find((l) => /^\s*secondary:/.test(l));
  if (!line) throw new Error("SoftButton has no secondary variant");
  // The ink is a named const interpolated into the variant string; resolve the
  // interpolation so the measurement reads the SHIPPED class, not a symbol.
  const composed = line.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const decl = source.match(new RegExp(`const ${name} =\\s*"([^"]*)"`));
    if (!decl) throw new Error(`SoftButton interpolates \${${name}} but declares no such string const`);
    return decl[1];
  });
  const match = composed.match(/text-\[([^\]]+)\]/);
  if (!match) throw new Error(`secondary variant declares no text-[…] ink: ${line.trim()}`);
  return match[1];
}

describe("E SoftButton secondary ink clears WCAG AA on --color-surface-2 in BOTH themes", () => {
  const surface2 = (theme: Theme, accent: Accent) => token("--color-surface-2", theme, accent);

  /** The ink expression as a CSS colour string, for the resolver. */
  function inkExpression(source: string, theme: Theme, accent: Accent): string {
    // A raw `var(--token)` resolves straight through the stylesheet; a
    // `color-mix(…)` needs `in_srgb` → `in srgb` and its var() operands filled
    // in, which the resolver does as it walks.
    const filled = source.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/gi, (_, name: string) => rawToken(name, theme, accent));
    return filled.replace(/_/g, " ").replace(/in_srgb/g, "in srgb");
  }

  const ratios = (theme: Theme) =>
    ACCENTS.map((accent) => ({
      accent,
      ratio: ratio2(contrast(
        evaluate(inkExpression(secondaryInkSource(), theme, accent), theme, accent, ["ink"]),
        surface2(theme, accent),
      )),
    }));

  it("clears 4.5:1 for ALL TEN accents in DARK", () => {
    const rows = ratios("dark");
    expect({ failing: rows.filter((r) => r.ratio < 4.5), all: rows }).toEqual({ failing: [], all: rows });
    expect(rows).toHaveLength(10);
  });

  it("clears 4.5:1 for ALL TEN accents in LIGHT", () => {
    const rows = ratios("light");
    expect({ failing: rows.filter((r) => r.ratio < 4.5), all: rows }).toEqual({ failing: [], all: rows });
    expect(rows).toHaveLength(10);
  });

  it("the secondary ink is walked toward body ink, not the deepened accent fill", () => {
    // `--color-accent-button` is accent-mixed 60% toward black for WHITE label
    // use; on a light surface-2 fill it is a dark ink in a dark theme's palette,
    // which is why it measured 1.88:1. The fix must be the accent-INK family.
    const ink = secondaryInkSource();
    expect(ink).not.toBe("var(--color-accent-button)");
    expect(ink).toContain("var(--color-text-primary)");
    expect(ink).toContain("var(--color-accent-selected)");
  });

  it("primary / danger / success keep their proven ink and fill, and disabled is untouched", () => {
    const source = readFileSync(join(process.cwd(), "src/components/ui/SoftButton.tsx"), "utf8");
    const lineFor = (variant: string) => {
      const line = source.split("\n").find((l) => new RegExp(`^\\s*${variant}:`).test(l));
      if (!line) throw new Error(`SoftButton has no ${variant} variant`);
      return line;
    };
    // Primary was re-pointed from `bg-[var(--color-accent-button)]` to the same
    // 60%-toward-black mix written inline, because the accent-button token gets
    // inline-pinned on <html> by theme-config's preset check (fixed separately)
    // and the mix keeps the exact same computed fill. White ink preserved.
    expect(lineFor("primary")).toContain("color-mix(in_srgb,var(--color-accent-selected)_60%,black)");
    expect(lineFor("primary")).toContain("text-white");
    expect(lineFor("danger")).toContain("text-white");
    expect(lineFor("success")).toContain("text-white");
    expect(lineFor("ghost")).toContain("text-text-secondary");
    // The disabled convergence is a SURFACE change and must survive verbatim.
    expect(source).toContain(
      'const disabledMap =\n  "!bg-[var(--color-surface-2)] !text-[var(--color-text-secondary)] !border-[var(--color-border)] !shadow-none";',
    );
    // Every size variant is still declared.
    for (const size of ["sm", "md", "lg", "icon"]) {
      expect(source).toMatch(new RegExp(`^\\s*${size}: "`, "m"));
    }
  });

  it("the disabled ink still clears AA on its own surface in both themes", () => {
    for (const theme of ["light", "dark"] as Theme[]) {
      const rows = ACCENTS.map((accent) => ({
        accent,
        ratio: ratio2(contrast(token("--color-text-secondary", theme, accent), surface2(theme, accent))),
      }));
      expect({ theme, failing: rows.filter((r) => r.ratio < 4.5) }).toEqual({ theme, failing: [] });
    }
  });

  it("renders every variant with its ink and the disabled convergence applied", async () => {
    const el = await renderAsync(
      <>
        <SoftButton variant="secondary" className="probe-secondary">Sec</SoftButton>
        <SoftButton className="probe-primary">Pri</SoftButton>
        <SoftButton variant="secondary" disabled className="probe-disabled">Off</SoftButton>
      </>,
    );
    await settle();
    const secondary = el.querySelector(".probe-secondary") as HTMLElement;
    const primary = el.querySelector(".probe-primary") as HTMLElement;
    const disabled = el.querySelector(".probe-disabled") as HTMLElement;
    expect(secondary.className).toContain("bg-[var(--color-surface-2)]");
    expect(secondary.className).toContain("border");
    expect(primary.className).toContain("text-white");
    // Disabled wins over the variant's own ink on every axis it overrides.
    expect(disabled.className).toContain("!text-[var(--color-text-secondary)]");
    expect(disabled.className).toContain("!bg-[var(--color-surface-2)]");
    expect(disabled.className).toContain("!border-[var(--color-border)]");
    expect(disabled.className).toContain("!shadow-none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — the hardening this page already has must survive
// ─────────────────────────────────────────────────────────────────────────────

describe("regression the wave's hardening survives these edits", () => {
  const pageSource = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");

  it("the PIN dialog is driven by ONE pinIntent, and no stale field has come back", () => {
    // The four arm fields are DERIVED consts; nothing may write them again.
    expect(pageSource).not.toMatch(/setPinTaskId\(|setPinCrewAction\(|setPinReward\(|setPinPenalty\(/);
    expect(pageSource).toContain("const [pinIntent, setPinIntent] = useState<PinIntent | null>(null);");
    for (const derived of ["pinTaskId", "pinCrewAction", "pinReward", "pinPenalty"]) {
      expect(pageSource).toMatch(new RegExp(`const ${derived} = pinIntent`));
    }
    // All 12 PIN gates read those derived consts, not the union's `.kind`.
    const gates = pageSource.match(/\bpinTaskId\b|\bpinCrewAction\b|\bpinReward\b|\bpinPenalty\b/g) || [];
    expect(gates.length).toBeGreaterThanOrEqual(12);
  });

  it("all five PIN-gated actions still reach the ONE dialog, each naming its own target", async () => {
    const board = [
      { ...CHORE, id: 71, title: "Water the plants", assignee: "Ben" },
      { ...CREW_TASK, id: 70, title: "Clean the garage" },
    ];
    const catalogue = {
      points: { Ann: 100, Ben: 40, Cleo: 20, Dana: 10, Eli: 0 },
      rewards: [{ id: 3, name: "Movie night", emoji: "\u{1F3AC}", cost: 5 }],
      penalties: [{ id: 7, name: "Skipped trash", emoji: "\u{1F5D1}\uFE0F", points: 5 }],
    };

    /** Open a gate, read its dialog, then CANCEL it. */
    const dialogFor = async (open: () => Promise<void>) => {
      await open();
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog, "a dialog opened").not.toBeNull();
      await act(async () => { buttonByText("Cancel").click(); });
      await settle();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      return dialog.textContent || "";
    };

    // The parent-side gates live on the leaderboard panel.
    await signInAs("Ann", "parent");
    server.verifyOkFor = "Ann";
    seed(board, catalogue);
    await renderAsync(<TasksPage />);
    await settle();
    await toLeaderboard();

    // 3. a penalty
    expect(await dialogFor(() => clickByAriaLabel("Apply penalty")))
      .toContain('Apply "Skipped trash" penalty');
    // 4. a reward redemption
    expect(await dialogFor(() => clickByAriaLabel("Redeem Movie night")))
      .toContain('Redeem "Movie night" for 5pts');
    // 5. a manual adjust, from a rank-4 row (a LeaderboardRow control \u2014 the
    //    podium slots\u2019 own adjust button carries no accessible name).
    expect(await dialogFor(() => clickByAriaLabel("Adjust points for Dana")))
      .toContain("Adjust points for Dana");
    await unmount();

    // The member-side gates live on the board. Signing in flips the filter to
    // "My Tasks", so the chore has to be THIS member\u2019s to be listed at all.
    await signInAs("Ben");
    server.verifyOkFor = "Ben";
    seed(board, catalogue);
    await renderAsync(<TasksPage />);
    await settle();

    // 1. an assigned chore completion
    expect(await dialogFor(() => clickByAriaLabel("Complete Water the plants")))
      .toContain('Complete "Water the plants"');
    // 2. a crew self-join
    expect(await dialogFor(() => clickByAriaLabel("Join crew for Clean the garage")))
      .toContain('Join the crew for "Clean the garage"');

    // Nothing leaked a queued command: every dialog was cancelled.
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("showToast takes the tone as an ARGUMENT, and a failure with no error wording still reads as an error", async () => {
    await signInAs("Ann", "parent");
    seed([]);
    const el = await renderAsync(<TasksPage />);
    await settle();

    // The message carries NO error cue — no "failed", no "error", no "!". Only an
    // explicit tone argument can put it in the error treatment.
    await act(async () => { buttonByText("✨ Get chore ideas from Consuela").click(); });
    await settle(160);

    const toast = el.querySelector('[role="status"][aria-live="polite"]') as HTMLElement;
    expect(toast, "a toast").not.toBeNull();
    expect(toast.textContent).toBe("Consuela couldn't come up with ideas right now — try again in a bit.");
    expect(toast.textContent?.toLowerCase()).not.toContain("fail");
    expect(toast.textContent?.toLowerCase()).not.toContain("error");
    expect(toast.className).toContain("--color-accent-rose");

    // The tone is threaded as state, never derived from the text.
    const source = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");
    expect(source).toContain('const showToast = useCallback((msg: string, tone: "neutral" | "success" | "error" = "neutral")');
    expect(source).toContain("<Toast open={Boolean(toast)} tone={toastTone}>{toast}</Toast>");
    expect(source).not.toMatch(/tone\s*[:=]\s*[^,\n]*\.(includes|indexOf|match|test)\(/);
  });

  it("the tri-state sync read still refuses to render 'All caught up'", async () => {
    await signInAs("Ann", "parent");
    server.syncStatus = 503;
    seed([]);
    await renderAsync(<TasksPage />);
    await settle(180);
    expect(text()).toContain("Couldn't reach the family server");
    expect(text()).not.toContain("All caught up");

    server.syncStatus = 200;
    await renderAsync(<TasksPage />);
    await settle(180);
    expect(text()).toContain("All caught up");
  });

  it("the 'All' open-assignee sentinel is unchanged", () => {
    expect(pageSource).toContain('const OPEN_ASSIGNEE = "All";');
  });
});