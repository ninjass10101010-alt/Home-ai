// @vitest-environment jsdom
// U2 — the ✅ Completed card's real disclosure, 8px-grid rows and loading state.
//
// The visual gate measures these in a browser; this suite pins the contracts a
// jsdom run can hold: the `aria-controls`/id pair, the collapsed default, the
// single rotating chevron, the row classes, the clamp classes, and the three
// placeholder rows of the first-read window (never a fabricated "0 done").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import TasksPage from "@/app/tasks/page";
import type { Task } from "@/types/tasks";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ROSTER = [
  { id: 1, name: "Rebecca", fullName: "Rebecca Mom", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 7, emoji: "🧒", color: "cyan" },
];

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => ROSTER,
    selectMembersFallback: () => ROSTER,
  },
}));

const MONDAY = "2026-09-28";

function row(over: Partial<Task> & { id: number; title: string }): Task {
  return {
    assignee: "Rebecca Mom",
    assigneeEmoji: "👩",
    due: MONDAY,
    points: 5,
    recurring: null,
    category: "chores",
    completed: true,
    completedBy: "Rebecca Mom",
    priority: "medium",
    ...over,
  } as Task;
}

const SEED = [
  row({ id: 1, title: "Stamped this week", completedAt: "2026-09-29T01:00:00.000Z", completedInWeek: MONDAY }),
  row({ id: 2, title: "Stamped last week", completedAt: "2026-09-24T18:00:00.000Z", completedInWeek: "2026-09-21" }),
  row({
    id: 3,
    title: "Awaiting parent",
    completedAt: "2026-09-29T01:00:00.000Z",
    pendingApproval: { byName: "Caspian Garcia", at: "2026-09-29T02:00:00.000Z", points: 6 },
  }),
];

function seed(rows: unknown[] = SEED) {
  localStorage.setItem("consuela-tasks", JSON.stringify(rows));
  localStorage.setItem("consuela-week-data", JSON.stringify({
    weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [],
  }));
}

let root: Root | null = null;

async function renderAsync(fetchStub?: unknown) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  vi.stubGlobal("fetch", fetchStub ?? vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }),
  } as any)));
  await act(async () => { root = createRoot(el); root.render(<TasksPage />); });
  return el;
}

async function settle(ms = 90) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function disclosure(el: HTMLElement): HTMLButtonElement {
  const btn = [...el.querySelectorAll("button")]
    .find((b) => /Show completed|Hide completed/.test(b.textContent || ""));
  expect(btn, "the completed disclosure").toBeTruthy();
  return btn as HTMLButtonElement;
}

async function expand(el: HTMLElement): Promise<HTMLButtonElement> {
  const btn = disclosure(el);
  if (/Show completed/.test(btn.textContent || "")) {
    await act(async () => { btn.click(); });
  }
  await settle(60);
  return btn;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T21:00:00-04:00") });
  mockAuth.currentUser = { name: "Rebecca", fullName: "Rebecca Mom", role: "parent" };
  mockAuth.isLoggedIn = true;
});

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("U2 — the Completed disclosure", () => {
  it("points aria-controls at the list container and starts collapsed", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);

    const btn = disclosure(el);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const controls = btn.getAttribute("aria-controls");
    expect(controls, "aria-controls names the list").toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel, "the controlled container exists").not.toBeNull();
    expect(panel!.className).toContain("tasks-disclosure-panel");
    expect(panel!.getAttribute("data-open")).toBe("false");
  });

  it("keeps the literals and flips aria-expanded/controls together", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);

    const btn = await expand(el);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.textContent).toContain("Hide completed");
    const panel = document.getElementById(btn.getAttribute("aria-controls")!);
    expect(panel!.getAttribute("data-open")).toBe("true");
  });

  it("rotates one chevron instead of swapping ↑/↓ glyphs", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);

    const btn = disclosure(el);
    expect(btn.querySelector(".tasks-disclosure-chevron")).not.toBeNull();
    expect(btn.textContent).not.toContain("↑");
    expect(btn.textContent).not.toContain("↓");
  });
});

describe("U2 — density and no visible truncation", () => {
  it("settled rows sit on the 8px grid", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);
    await expand(el);

    const card = el.querySelector("[data-completed-card]")!;
    const rowEl = card.querySelector(".schedule-row") as HTMLElement;
    expect(rowEl, "a settled row renders").toBeTruthy();
    expect(rowEl.className).toContain("px-3");
    expect(rowEl.className).toContain("py-3");
    expect(rowEl.className).toContain("gap-2");
    expect(rowEl.className).not.toMatch(/py-2\.5/);
    expect(rowEl.className).not.toMatch(/\bgap-3\b/);
  });

  it("clamps titles at five lines before lg and wraps the meta instead of truncating", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);
    await expand(el);

    const card = el.querySelector("[data-completed-card]")!;
    const title = [...card.querySelectorAll("div")]
      .find((d) => d.textContent === "Stamped this week") as HTMLElement;
    expect(title, "the row title renders").toBeTruthy();
    expect(title.className).toContain("line-clamp-5");
    expect(title.className).toContain("lg:line-clamp-2");
    const meta = title.nextElementSibling as HTMLElement;
    expect(meta.className).toContain("line-clamp-2");
    expect(meta.className).not.toMatch(/\btruncate\b/);
  });
});

describe("U2 — the loading window", () => {
  it("renders three placeholder rows and no disclosure while the first read is outstanding", async () => {
    seed([]);
    const el = await renderAsync(vi.fn((input: any) => (
      String(input) === "/api/tasks/sync"
        ? new Promise(() => {})
        : Promise.resolve({ ok: false, status: 401, json: async () => ({}) })
    )));
    await settle(250);

    const card = el.querySelector("[data-completed-card]");
    expect(card, "the card renders during the read").not.toBeNull();
    expect(card!.querySelectorAll(".schedule-row").length).toBe(3);
    expect(card!.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect([...card!.querySelectorAll("button")]
      .some((b) => /Show completed/.test(b.textContent || ""))).toBe(false);
    expect(card!.textContent).not.toContain("0 done");
    expect(card!.textContent).toContain("checking");
  });
});

describe("U2 — the done-row meta collapses a duplicate name", () => {
  it("prints one name when the completer resolves to the assignee", async () => {
    // "Rebecca" (session/roster short name) resolves to "Rebecca Mom", the
    // assignee — the resolved-ledger space `resolveMemberName` defines.
    seed([row({ id: 1, title: "Stamped this week", completedBy: "Rebecca", completedAt: "2026-09-29T01:00:00.000Z", completedInWeek: MONDAY })]);
    const el = await renderAsync();
    await settle(120);
    await expand(el);

    const card = el.querySelector("[data-completed-card]")!;
    const title = [...card.querySelectorAll("div")].find((d) => d.textContent === "Stamped this week") as HTMLElement;
    const meta = title.nextElementSibling as HTMLElement;
    expect(meta.textContent).toBe("Rebecca");
    expect(meta.textContent).not.toContain("·");
  });

  it("keeps both names when the completer differs", async () => {
    seed([row({ id: 2, title: "Done by another", completedBy: "Caspian Garcia", completedAt: "2026-09-29T01:00:00.000Z", completedInWeek: MONDAY })]);
    const el = await renderAsync();
    await settle(120);
    await expand(el);

    const card = el.querySelector("[data-completed-card]")!;
    const title = [...card.querySelectorAll("div")].find((d) => d.textContent === "Done by another") as HTMLElement;
    const meta = title.nextElementSibling as HTMLElement;
    expect(meta.textContent).toBe("Rebecca · Caspian");
  });
});

describe("U2 — §H-5 skeleton parity contract", () => {
  it("puts the shared floor class on the placeholders, at the settled line heights", async () => {
    seed([]);
    const el = await renderAsync(vi.fn((input: any) => (
      String(input) === "/api/tasks/sync"
        ? new Promise(() => {})
        : Promise.resolve({ ok: false, status: 401, json: async () => ({}) })
    )));
    await settle(250);

    const placeholders = el.querySelectorAll(".tasks-completed-row.schedule-row");
    expect(placeholders.length).toBe(3);
    for (const row of placeholders) {
      // Two title lines, one folding away at `sm`, then the meta line.
      expect(row.querySelectorAll('[class*="h-[19.25px]"]').length).toBe(2);
      expect(row.querySelectorAll('[class*="h-[19.25px]"][class*="sm:hidden"]').length).toBe(1);
      expect(row.querySelector('[class*="h-[16.5px]"]')).toBeTruthy();
    }
  });

  it("puts the same floor class on every settled row, pending included", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);
    await expand(el);

    const card = el.querySelector("[data-completed-card]")!;
    const rows = [...card.querySelectorAll(".schedule-row")];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.className).toContain("tasks-completed-row");
    }
  });

  it("pins the declared floors in globals.css", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.tasks-completed-row\s*\{\s*min-height:\s*125px;\s*\}/);
    expect(css).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.tasks-completed-row\s*\{\s*min-height:\s*62px;\s*\}/);
  });
});
