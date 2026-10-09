// @vitest-environment jsdom
// F1 — the Completed card RENDERED (B2_TIP_SHA = 190b626d5e8f4c3f78ae419fabcb69ef532f8c25).
//
// Drives the real /tasks page under a pinned family clock (Mon 2026-09-28
// 21:00 EDT) and asserts the expanded card's sections: every completed row in
// exactly one group, this week under "This week", last week under
// "Week of Sep 21–Sep 27", the undated row under "Earlier", the pending tap
// pinned above everything, a chore count in every header and NO points total,
// and the old "Past" mislabel gone.
//
// The DOM carries no task id, so rows are identified by their aria-label
// ("Undo completion of …" on the undo control, "… waiting for parent approval"
// on the pinned row). Fixture titles are unique per row, which makes the title
// a 1:1 proxy for the id — a proxy, not the id itself (see F1's honesty
// clause in the report/CHANGELOG).
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

const PINNED_NOW = "2026-09-28T21:00:00-04:00"; // Mon 21:00 EDT
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
  row({ id: 1, title: "Stamped this week", completedAt: "2026-09-29T01:00:00.000Z", completedInWeek: "2026-09-28" }),
  row({ id: 2, title: "Unstamped this week", completedAt: "2026-09-29T01:00:00.000Z" }),
  row({ id: 3, title: "Stamped last week", completedAt: "2026-09-24T18:00:00.000Z", completedInWeek: "2026-09-21" }),
  row({ id: 4, title: "Unstamped last week", completedAt: "2026-09-24T18:00:00.000Z" }),
  row({ id: 5, title: "Future stamped", completedAt: "2026-10-19T14:00:00.000Z", completedInWeek: "2026-10-19" }),
  row({
    id: 6,
    title: "Awaiting parent",
    completedAt: "2026-09-29T01:00:00.000Z",
    pendingApproval: { byName: "Caspian Garcia", at: "2026-09-29T02:00:00.000Z", points: 6 },
  }),
  row({ id: 7, title: "Undated chore", completedAt: undefined, completedInWeek: undefined }),
  { ...row({ id: 8, title: "Open chore", completedAt: undefined }), completed: false, completedBy: undefined },
];

function seed() {
  localStorage.setItem("consuela-tasks", JSON.stringify(SEED));
  localStorage.setItem("consuela-week-data", JSON.stringify({
    weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [],
  }));
}

let root: Root | null = null;

async function renderAsync() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url === "/api/tasks/sync") {
      return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  }));
  await act(async () => { root = createRoot(el); root.render(<TasksPage />); });
  return el;
}

async function settle(ms = 90) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(PINNED_NOW) });
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

describe("Completed card — grouped by week (rendered)", () => {
  it("puts every completed row in exactly one week group, counts chores, and drops the 'Past' token", async () => {
    seed();
    const el = await renderAsync();
    await settle(120);

    const toggle = [...el.querySelectorAll("button")].find((b) => /Show completed/i.test(b.textContent || ""));
    expect(toggle, "Show completed toggle").toBeTruthy();
    await act(async () => { toggle!.click(); });
    await settle(60);

    const card = el.querySelector("[data-completed-card]") as HTMLElement | null;
    expect(card, "[data-completed-card]").not.toBeNull();
    const sections = [...card!.querySelectorAll("section[aria-labelledby]")];
    const headerOf = (sec: Element) => sec.querySelector("h3")?.textContent ?? "";
    const titleOf = (label: string) =>
      label
        .replace(/^Undo completion of /, "")
        .replace(/^Cancel completion of /, "")
        .replace(/ waiting for parent approval$/, "");
    const titlesIn = (sec: Element) =>
      [...sec.querySelectorAll("[aria-label]")].map((n) => titleOf(n.getAttribute("aria-label")!));
    const sectionFor = (header: string) =>
      sections.find((sec) => headerOf(sec).startsWith(header));

    // 1. No row dropped and none duplicated: set equality on titles (a 1:1
    //    proxy for the id), not a count.
    const completedTitles = SEED.filter((t) => t.completed).map((t) => t.title).sort();
    expect(sections.flatMap(titlesIn).sort()).toEqual(completedTitles);

    // 2. Exactly one group each.
    const seen = new Map<string, number>();
    for (const sec of sections) {
      for (const title of titlesIn(sec)) seen.set(title, (seen.get(title) ?? 0) + 1);
    }
    for (const [title, count] of seen) {
      expect({ title, count }).toEqual({ title, count: 1 });
    }

    // 3. The right group for each row — and the pending tap pinned ABOVE
    //    every week group.
    expect(headerOf(sections[0])).toMatch(/^Waiting on approval/);
    expect(titlesIn(sectionFor("Waiting on approval")!)).toEqual(["Awaiting parent"]);
    expect(titlesIn(sectionFor("This week")!).sort()).toEqual(["Stamped this week", "Unstamped this week"]);
    expect(titlesIn(sectionFor("Week of Sep 21–Sep 27")!).sort()).toEqual(["Stamped last week", "Unstamped last week"]);
    expect(titlesIn(sectionFor("Week of Oct 19–Oct 25")!)).toEqual(["Future stamped"]);
    expect(titlesIn(sectionFor("Earlier")!)).toEqual(["Undated chore"]);

    // 4. No points total anywhere in a header; every header carries a chore count.
    for (const sec of sections) {
      const text = headerOf(sec);
      expect(text).toMatch(/^(Waiting on approval|This week|Week of .+|Earlier)/);
      expect(text).toMatch(/\d+ chores?/);
      expect(text).not.toMatch(/\d+\s*pts?/i);
    }

    // 5. The mislabel is gone from the rendered card.
    expect(card!.textContent).not.toContain("Past");
  });
});
