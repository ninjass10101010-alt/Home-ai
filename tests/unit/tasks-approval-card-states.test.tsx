// @vitest-environment jsdom
// U1 — the ⏳ Needs approval card's named states and its ordering contract.
//
// This suite pins the behaviours the visual gate measures in a browser but
// cannot assert in jsdom: newest-tap-first ordering, the count strip (a count,
// never a points total), the per-kid badge, the row-in-flight state, the
// loading placeholders, and the 180 s age hint.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { __resetTaskOutboxForTests } from "@/lib/task-command-store";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Rebecca", role: "parent", emoji: "👩" } as any, isLoggedIn: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 7, emoji: "🧒", color: "cyan" },
      { id: 3, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 13, emoji: "🌈", color: "mint" },
    ],
    selectMembersFallback: () => [],
  },
}));

import TasksPage from "@/app/tasks/page";
import { localWeekStartISO } from "@/lib/local-date";

const MONDAY = localWeekStartISO();
const NOW = Date.parse("2026-10-08T17:00:00.000Z");

function pendingRow(overrides: Record<string, unknown> = {}) {
  const at = "2026-10-08T16:00:00.000Z";
  return {
    id: 101,
    title: "Drain the sink",
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    due: MONDAY,
    points: 5,
    recurring: null,
    category: "Chores",
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: at,
    completedInWeek: MONDAY,
    priority: "low",
    pendingApproval: { byName: "Caspian Garcia", at, points: 5 },
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

function approveButtons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll('button[aria-label^="Approve "]')] as HTMLButtonElement[];
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => () => {} })));
});

afterEach(async () => {
  if (activeRoot) {
    await act(async () => { activeRoot!.unmount(); });
    activeRoot = null;
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("U1 — approval queue ordering", () => {
  it("renders newest tap first, with an id tiebreak for equal instants", async () => {
    seed([
      pendingRow({ id: 3, title: "Oldest", pendingApproval: { byName: "Caspian Garcia", at: "2026-10-07T18:00:00.000Z", points: 5 } }),
      pendingRow({ id: 9, title: "Newest", pendingApproval: { byName: "Aurora Garcia", at: "2026-10-08T14:30:00.000Z", points: 5 } }),
      pendingRow({ id: 20, title: "Tie low", pendingApproval: { byName: "Caspian Garcia", at: "2026-10-08T12:00:00.000Z", points: 5 } }),
      pendingRow({ id: 21, title: "Tie high", pendingApproval: { byName: "Aurora Garcia", at: "2026-10-08T12:00:00.000Z", points: 5 } }),
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(approveButtons(el).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Approve Newest",
      "Approve Tie high",
      "Approve Tie low",
      "Approve Oldest",
    ]);
  });

  it("shows the award the approval will pay, never the pre-bonus base", async () => {
    seed([pendingRow({ id: 7, title: "Bonus chore", points: 6, pendingApproval: { byName: "Caspian Garcia", at: "2026-10-08T16:00:00.000Z", points: 9 } })]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("+9pts");
    expect(el.textContent).not.toContain("+6pts");
  });

  it("a crew row reads per-head and crew size, and keeps a partial crew's check-in tail", async () => {
    seed([
      pendingRow({
        id: 11,
        title: "Wash the car",
        crewSize: 3,
        crew: { members: [
          { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-10-08T16:00:00.000Z", checkedInAt: "2026-10-08T16:05:00.000Z" },
          { name: "Aurora Garcia", emoji: "🌈", joinedAt: "2026-10-08T16:00:00.000Z", checkedInAt: "2026-10-08T16:05:00.000Z" },
        ] },
        pendingApproval: { byName: "Caspian Garcia", at: "2026-10-08T16:00:00.000Z", points: 7, crew: ["Caspian Garcia", "Aurora Garcia"] },
      }),
    ]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("+7pts each");
    expect(el.textContent).toContain("3 people");
    expect(el.textContent).toContain("2 of 3 checked in");
  });
});

describe("U1 — the count strip and per-kid badge", () => {
  it("counts chores on the way — never a points total", async () => {
    seed([pendingRow({ id: 1 }), pendingRow({ id: 2 })]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    const strip = el.querySelector(".tasks-approval-summary") as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.textContent).toContain("2 chores on the way");
    expect(strip.textContent).not.toContain("pts");
  });

  it("uses the singular for one chore", async () => {
    seed([pendingRow({ id: 1 })]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect((el.querySelector(".tasks-approval-summary") as HTMLElement).textContent).toContain("1 chore on the way");
  });

  it("labels each row by kid only when the queue holds two or more kids", async () => {
    seed([pendingRow({ id: 1, pendingApproval: { byName: "Caspian Garcia", at: "2026-10-08T16:00:00.000Z", points: 5 } })]);
    const oneKid = await renderAsync(<TasksPage />);
    await settle();
    expect(oneKid.querySelectorAll('[data-testid="approval-kid-badge"]').length).toBe(0);
    await act(async () => { activeRoot!.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";

    seed([
      pendingRow({ id: 1, pendingApproval: { byName: "Caspian Garcia", at: "2026-10-08T16:00:00.000Z", points: 5 } }),
      pendingRow({ id: 2, title: "Fold the towels", assignee: "Aurora Garcia", pendingApproval: { byName: "Aurora Garcia", at: "2026-10-08T15:00:00.000Z", points: 4 } }),
    ]);
    const twoKids = await renderAsync(<TasksPage />);
    await settle();
    expect(twoKids.querySelectorAll('[data-testid="approval-kid-badge"]').length).toBe(2);
  });
});

describe("U1 — named states", () => {
  it("renders skeleton rows during the first snapshot read and never says 0 on the way", async () => {
    seed([]);
    vi.stubGlobal("fetch", vi.fn((input: any) => {
      const url = String(input);
      if (url === "/api/tasks/sync") return new Promise(() => {});
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as any);
    }));
    const el = await renderAsync(<TasksPage />);
    await settle(250);
    const card = [...el.querySelectorAll("h2")].find((h) => /Needs approval/i.test(h.textContent || ""));
    expect(card, "the card renders while the read is outstanding").toBeTruthy();
    expect(el.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(el.querySelector(".tasks-approval-summary")).toBeNull();
  });

  it("never fabricates a zero in the loading window", async () => {
    seed([]);
    vi.stubGlobal("fetch", vi.fn((input: any) => {
      const url = String(input);
      if (url === "/api/tasks/sync") return new Promise(() => {});
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as any);
    }));
    const el = await renderAsync(<TasksPage />);
    await settle(250);
    // An unread queue is unknown, never "0 tapped" / "Approve all (0)".
    expect(el.textContent).not.toContain("0 tapped");
    expect(el.textContent).not.toContain("Approve all (0)");
    expect(el.textContent).toContain("checking the queue…");
    const approveAll = [...el.querySelectorAll("button")].find((b) => /Approve all/i.test(b.textContent || "")) as HTMLButtonElement;
    expect(approveAll, "the button keeps its literal 'Approve all' during loading").toBeTruthy();
    expect(approveAll.disabled).toBe(true);
  });

  it("marks a row with a queued approval as Sending… and disables both actions", async () => {
    seed([pendingRow({ id: 12, title: "Drain the sink" })]);
    localStorage.setItem("consuela-task-operation-outbox-v1", JSON.stringify([{
      version: 1,
      operationId: "test-in-flight-approve-12",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 12, memberName: "Rebecca (Mom)" },
      createdAt: "2026-10-08T16:00:00.000Z",
      attemptCount: 1,
      nextAttemptAt: "2026-10-08T23:00:00.000Z",
      status: "queued",
      displayTarget: { kind: "approval", taskId: 12, title: "Drain the sink" },
    }]));
    vi.stubGlobal("fetch", vi.fn((input: any) => {
      const url = String(input);
      if (url === "/api/tasks/approve") return new Promise(() => {});
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as any);
    }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("⏳ Sending…");
    expect((el.querySelector('button[aria-label="Approve Drain the sink"]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('button[aria-label="Send back Drain the sink"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Approve all while an approve-all command is in flight", async () => {
    seed([pendingRow({ id: 12, title: "Drain the sink" })]);
    localStorage.setItem("consuela-task-operation-outbox-v1", JSON.stringify([{
      version: 1,
      operationId: "test-in-flight-approve-all",
      route: "/api/tasks/approve",
      action: "approve-all",
      payload: { taskIds: [12], memberName: "Rebecca (Mom)" },
      createdAt: "2026-10-08T16:00:00.000Z",
      attemptCount: 1,
      nextAttemptAt: "2026-10-08T23:00:00.000Z",
      status: "queued",
      displayTarget: { kind: "approval", title: "1 tapped task" },
    }]));
    vi.stubGlobal("fetch", vi.fn((input: any) => {
      const url = String(input);
      if (url === "/api/tasks/approve") return new Promise(() => {});
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as any);
    }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const approveAll = [...el.querySelectorAll("button")].find((b) => /Approve all/i.test(b.textContent || "")) as HTMLButtonElement;
    expect(approveAll.disabled).toBe(true);
    expect(approveAll.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("U1 — the 180 s age hint", () => {
  it("shows an age hint once a pending row is older than 180s", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    seed([pendingRow({ id: 1, pendingApproval: { byName: "Caspian Garcia", at: new Date(NOW - 181_000).toISOString(), points: 5 } })]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("⏳ waiting 3 min");
  });

  it("shows no age hint at 179s", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    seed([pendingRow({ id: 1, pendingApproval: { byName: "Caspian Garcia", at: new Date(NOW - 179_000).toISOString(), points: 5 } })]);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).not.toContain("waiting");
  });
});
