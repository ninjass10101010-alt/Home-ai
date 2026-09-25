// @vitest-environment jsdom
// Task 10 — KidHome writes through the durable outbox. An under-10 PIN-free
// tap, a 10+ PIN-gated completion, a crew join and a self-cancel are all
// queued commands; the kid's own ledger/rows never move locally, the PIN lives
// only in the ephemeral registry, and a queued command survives a reload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { todayMondayISO, weekKey } from "@/lib/task-utils";
import {
  __resetTaskOutboxForTests,
  listTaskOutbox,
} from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import KidHome from "@/modes/kid/KidHome";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KID_PIN = "3141";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Caspian", role: "child", age: 5 } as any }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ ...mockAuth, logout: vi.fn(), sessionWarning: false, sessionRemainingMs: 600000 }),
}));

const modeMock = vi.hoisted(() => ({ isBedtime: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({
    mode: "kid",
    isBedtime: modeMock.isBedtime,
    isWeekend: false,
    currentHour: 12,
    currentDay: 3,
    previousMode: null,
  }),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { id: 2, name: "Caspian", fullName: "Caspian Garcia", color: "cyan", emoji: "🧒", role: "child", age: 5 },
    ],
    selectMembersDetailed: () => [{ name: "Caspian Garcia", color: "cyan", emoji: "🧒" }],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
    selectHallOfFame: async () => [],
    listArchivedWeeks: async () => [],
  },
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => null }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/components/leaderboard/WeeklyWinModal", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: {},
    filterId: "atmos",
    accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

const server = vi.hoisted(() => ({ claimStatus: 200, throws: false, requests: [] as any[] }));

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/api/members/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ member: { name: "Caspian", fullName: "Caspian Garcia", role: "child" } }),
        };
      }
      if (url === "/api/tasks/claim") {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        server.requests.push(body);
        if (server.throws) throw new TypeError("network unavailable");
        return { ok: server.claimStatus < 400, status: server.claimStatus, json: async () => ({ success: true }) };
      }
      if (url === "/api/tasks/sync") {
        return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

const MONDAY = todayMondayISO();

let root: Root | null = null;

async function mount(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(ui);
  });
  return el;
}

async function settle(ms = 80) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function seed(tasks: any[]) {
  localStorage.setItem("consuela-tasks", JSON.stringify(tasks));
  localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }));
}

function storedTasks(): any[] {
  return JSON.parse(localStorage.getItem("consuela-tasks") || "[]");
}

function storedWeek(): any {
  return JSON.parse(localStorage.getItem("consuela-week-data") || "{}");
}

const QUEST_SEED_PENDING = {
  byName: "Caspian Garcia",
  at: expect.any(String),
  points: 5,
};

const QUEST = {
  id: 201,
  title: "Feed the dog",
  assignee: "Caspian Garcia",
  assigneeEmoji: "🧒",
  due: MONDAY,
  points: 5,
  recurring: null,
  category: "Pets",
  completed: false,
  priority: "low",
};

const CREW = {
  id: 202,
  title: "Wash the car",
  assignee: "Crew",
  assigneeEmoji: "🤝",
  due: MONDAY,
  points: 12,
  recurring: null,
  category: "Chores",
  completed: false,
  crewSize: 2,
  crew: { members: [] },
};

async function tapQuest(el: HTMLElement, title: string) {
  const card = el.querySelector(`[aria-label^="Complete quest: ${title}"], [aria-label^="Join a crew"]`) as HTMLElement;
  expect(card).not.toBeNull();
  await act(async () => { card.click(); });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  server.claimStatus = 200;
  server.throws = false;
  server.requests = [];
  modeMock.isBedtime = false;
  mockAuth.currentUser = { name: "Caspian", role: "child", age: 5 };
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as any);
  installFetch();
});

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount(); });
    root = null;
  }
  vi.unstubAllGlobals();
});

describe("under-10 PIN-free completion", () => {
  it("queues a credential-free command and writes no local pending row", async () => {
    server.claimStatus = 503;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");
    await settle(120);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "complete", payload: { taskId: 201 } });
    expect(storedTasks()[0].completed).toBe(false);
    expect(storedTasks()[0].pendingApproval).toBeUndefined();
    expect(storedWeek().history).toHaveLength(0);
    expect(storedWeek().points).toEqual({});
  });

  it("sends no pin on the wire for the PIN-free session action", async () => {
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");
    await settle(150);

    const posted = server.requests.filter((body) => body?.action === "complete");
    expect(posted.length).toBeGreaterThan(0);
    expect(posted[0].pin).toBeUndefined();
  });

  it("shows an honest queued notice and offers a cancel while the command waits", async () => {
    server.claimStatus = 503;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");
    await settle(150);

    expect(el.querySelector('[data-testid="kid-command-queue"]')).not.toBeNull();
    expect(el.textContent || "").toMatch(/Still sending 1 chore/);
  });

  it("survives a reload with the command still queued", async () => {
    server.claimStatus = 503;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");
    await settle(150);
    const [entry] = listTaskOutbox();

    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
    document.body.innerHTML = "";
    __resetTaskOutboxForTests();
    await mount(<KidHome />);
    await settle(120);

    const reloaded = listTaskOutbox()[0];
    expect(reloaded.operationId).toBe(entry.operationId);
    expect(reloaded.payload).toMatchObject({ taskId: 201, memberName: "Caspian Garcia" });
  });

  it("a 503 keeps the command and never writes a local earn line", async () => {
    server.claimStatus = 503;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");
    await settle(150);

    expect(listTaskOutbox()).toHaveLength(1);
    expect(storedWeek().history).toHaveLength(0);
  });

  it("a network rejection keeps the command queued", async () => {
    server.throws = true;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");
    await settle(150);

    expect(listTaskOutbox()).toHaveLength(1);
    expect(storedWeek().history).toHaveLength(0);
  });
});

describe("10+ PIN-gated completion", () => {
  it("carries the PIN ephemerally and never in localStorage", async () => {
    mockAuth.currentUser = { name: "Caspian", role: "child", age: 11 };
    server.claimStatus = 503;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();

    await tapQuest(el, "Feed the dog");
    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, KID_PIN);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const scope = document.querySelector('[role="dialog"]') ?? document;
    const submit = Array.from(scope.querySelectorAll("button")).find((b) =>
      /Done|Complete|Submit|✓/.test(b.textContent || ""),
    ) as HTMLButtonElement;
    expect(submit).toBeTruthy();
    await act(async () => { submit.click(); });
    await settle(150);

    expect(listTaskOutbox()[0]).toMatchObject({ route: "/api/tasks/claim", action: "complete" });
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain(KID_PIN);
  });
});

describe("crew join", () => {
  it("queues a PIN-free crew join for an under-10 session", async () => {
    server.claimStatus = 503;
    seed([CREW]);
    const el = await mount(<KidHome />);
    await settle();

    const crewRow = el.querySelector('[aria-label="Join crew: Wash the car"]') as HTMLElement;
    expect(crewRow).toBeTruthy();
    await act(async () => { crewRow.click(); });
    await settle();
    await settle(150);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "crew-join", payload: { taskId: 202 } });
    expect(storedTasks()[0].crew).toEqual({ members: [] });
  });
});

describe("self-cancel", () => {
  it("queues the server undo and does not clear the pending row locally", async () => {
    server.claimStatus = 503;
    seed([
      {
        ...QUEST,
        completed: true,
        completedBy: "Caspian Garcia",
        completedAt: new Date().toISOString(),
        completedInWeek: weekKey(),
        pendingApproval: { byName: "Caspian Garcia", at: new Date().toISOString(), points: 5 },
      },
    ]);
    const el = await mount(<KidHome />);
    await settle();

    const cancel = document.querySelector('[aria-label="Cancel: Feed the dog"]') as HTMLElement;
    expect(cancel).toBeTruthy();
    await act(async () => { cancel.click(); });
    await settle(150);

    const entry = listTaskOutbox()[0];
    expect(entry).toMatchObject({ route: "/api/tasks/claim", action: "undo", payload: { taskId: 201 } });
    expect(storedTasks()[0].pendingApproval).toEqual(QUEST_SEED_PENDING);
    expect(storedTasks()[0].completed).toBe(true);
  });
});

describe("no local writers on the kid surface", () => {
  it("never posts the retired snapshot writer", async () => {
    server.claimStatus = 503;
    seed([QUEST]);
    const el = await mount(<KidHome />);
    await settle();
    await tapQuest(el, "Feed the dog");
    await settle(150);

    const syncPosts = (globalThis.fetch as any).mock.calls.filter(
      ([url, init]: any[]) => String(url) === "/api/tasks/sync" && String(init?.method).toUpperCase() === "POST",
    );
    expect(syncPosts).toHaveLength(0);
  });
});
