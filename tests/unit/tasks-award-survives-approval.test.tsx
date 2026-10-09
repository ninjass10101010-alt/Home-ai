// @vitest-environment jsdom
// B1a D3 — the award survives approval.
//
// The claim records the paid amount in `pendingApproval.points` (base + speed
// bonus); approval used to clear `pendingApproval` and destroy the amount, so
// every card printed the base after a bonus claim. Approval now persists the
// paid amount as `awardedPoints` on the row, and the three award read sites
// prefer it over the pending record and the base.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/tasks",
}));

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Rebecca", role: "parent", emoji: "👩" } as any, isLoggedIn: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 7, emoji: "🌈", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
    ],
  },
}));

import TasksPage from "@/app/tasks/page";
import { localWeekStartISO } from "@/lib/local-date";
import { todayISO } from "@/lib/task-utils";
import { loadTasks } from "@/lib/task-utils";
import { adoptTaskOutboxAcknowledgement, __resetTaskOutboxForTests } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import { recurringClone } from "@/lib/task-recurrence";

const MONDAY = localWeekStartISO();
const TAP = "2026-10-08T15:00:00.000Z";

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    title: "Quest A",
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    due: todayISO(),
    points: 5,
    recurring: null,
    category: "Chores",
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: TAP,
    completedInWeek: MONDAY,
    priority: "low",
    pendingApproval: { byName: "Caspian Garcia", at: TAP, points: 7 },
    ...overrides,
  };
}

function seed(rows: Record<string, unknown>[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(rows));
  localStorage.setItem(
    "consuela-week-data",
    JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }),
  );
}

let activeRoot: Root | null = null;
async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}
async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
});

afterEach(async () => {
  if (activeRoot) {
    await act(async () => { activeRoot!.unmount(); });
    activeRoot = null;
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the award survives approval", () => {
  it("the Needs-approval card prints the recorded award, not the base", async () => {
    seed([taskRow()]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("7pts");
    expect(el.textContent).not.toContain("5pts");
  });

  it("the crew row prints the recorded award each", async () => {
    seed([
      taskRow({
        crewSize: 2,
        crew: {
          members: [
            { name: "Caspian Garcia", emoji: "🧒", joinedAt: TAP, checkedInAt: TAP },
            { name: "Aurora Garcia", emoji: "🌈", joinedAt: TAP, checkedInAt: TAP },
          ],
        },
        pendingApproval: {
          byName: "Crew",
          at: TAP,
          points: 7,
          crew: ["Caspian Garcia", "Aurora Garcia"],
        },
      }),
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("7pts each");
    expect(el.textContent).not.toContain("5pts each");
  });

  it("the Completed card's pending row prints the recorded award", async () => {
    seed([taskRow()]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    // A signed-in parent defaults to "My Tasks", so select the row's member
    // before the Completed card can map over it.
    const memberTile = el.querySelector('button[aria-label="Show Caspian Garcia\'s chores"]') as HTMLButtonElement;
    expect(memberTile).not.toBeNull();
    await act(async () => { memberTile.click(); });
    await settle();
    const showCompleted = [...el.querySelectorAll("button")].find((b) => /Show completed/i.test(b.textContent || ""));
    expect(showCompleted).toBeTruthy();
    await act(async () => { showCompleted!.click(); });
    await settle();
    expect(el.textContent).toContain("7pts on the way");
    expect(el.textContent).not.toContain("5pts on the way");
  });

  it("falls back to the chore's own points when nothing was recorded", async () => {
    seed([
      taskRow({
        pendingApproval: { byName: "Caspian Garcia", at: TAP } as any,
      }),
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("5pts");
    expect(el.textContent).not.toContain("NaN");
    expect(el.textContent).not.toContain("undefined");
  });

  it("an APPROVED row persists the award through the acknowledgement", async () => {
    // The tasks page has no rendered points site for an already-approved row
    // yet (U1/U2 own any Done-row amount); this pins the DATA survival the
    // three read sites depend on, through the real ack-clear path.
    seed([taskRow()]);
    await adoptTaskOutboxAcknowledgement({
      operationId: "op-award-survives",
      commandCreatedAt: "2026-10-08T15:30:00.000Z",
      reconciled: true,
      clearedTasks: [{
        id: 101,
        title: "Quest A",
        assignee: "Caspian Garcia",
        completed: true,
        completedBy: "Caspian Garcia",
        completedAt: TAP,
        completedInWeek: MONDAY,
        pendingApproval: null,
        sentBackAt: null,
        awardedPoints: 7,
      }],
    } as any);
    const row = loadTasks()[0];
    expect(row.pendingApproval).toBeUndefined();
    expect(row.awardedPoints).toBe(7);
  });

  it("a re-tapped row does not print the previous occurrence's award", async () => {
    seed([
      taskRow({
        awardedPoints: null,
        pendingApproval: { byName: "Caspian Garcia", at: "2026-10-08T16:00:00.000Z", points: 5 },
      }),
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("5pts");
    expect(el.textContent).not.toContain("7pts");
  });

  it("a recurring clone does not inherit last week's award", () => {
    const clone = recurringClone(
      { ...taskRow({ awardedPoints: 7 }), id: 101 } as any,
      202,
      "2026-10-12",
    );
    expect(clone.awardedPoints ?? null).toBeNull();
  });
});
