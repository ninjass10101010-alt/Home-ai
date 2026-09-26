// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/rewards",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Caspian", role: "child" } as any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

// Parents exist in the roster — the >100pt gate verifies the typed PIN
// against them (same verifyPinRemote loop the Tasks page runs).
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { name: "Jeffery", fullName: "Jeffery", role: "parent", color: "blue", emoji: "👨" },
      { name: "Caspian", fullName: "Caspian", role: "child", color: "green", emoji: "🧒" },
    ],
  },
}));

const store = vi.hoisted(() => ({
  week: { weekStart: "2026-09-01", points: { Caspian: 200 } as Record<string, number>, streak: {}, lastActive: {}, history: [] as any[] },
  saveWeekData: vi.fn(async (_week: any) => {}),
  syncWeekDataToPB: vi.fn(async (_week: any) => {}),
}));

vi.mock("@/lib/task-utils", () => ({
  loadWeekData: () => ({ ...store.week, points: { ...store.week.points }, history: [...store.week.history] }),
  loadTasks: () => [],
  mergeTasksSnapshot: (tasks: any) => ({ ...tasks, tasksChanged: false, weekChanged: false }),
  adoptAuthoritativeWeekData: (_current: any, server: any) => server,
  loadRewards: () => [
    { id: 1, name: "Movie night", emoji: "🎬", cost: 150 },
    { id: 2, name: "Ice cream trip", emoji: "🍦", cost: 40 },
  ],
  saveWeekData: (week: any) => {
    store.week = { ...week, points: { ...week.points }, history: [...(week.history ?? [])] };
    return store.saveWeekData(week);
  },
  addTransaction: (week: any, type: string, amount: number, description: string, member: string) => ({
    ...week,
    history: [...week.history, { id: 1, timestamp: "2026-09-04T12:00:00.000Z", type, amount, description, member }],
  }),
  syncWeekDataToPB: store.syncWeekDataToPB,
}));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

import RewardsShop from "@/modes/kid/RewardsShop";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";

// The route's authoritative week ledger after a 150pt "Movie night" redeem.
const REDEEMED_WEEK = {
  weekStart: "2026-09-01",
  points: { Caspian: 50 },
  streak: {},
  lastActive: {},
  history: [
    {
      id: 9,
      timestamp: "2026-09-04T12:00:00.000Z",
      member: "Caspian",
      type: "redeem",
      amount: -150,
      description: "Redeemed: Movie night (-150pts)",
      meta: { operationId: "redeem-fixture-op", source: "reward-redeem" },
    },
  ],
};

let redeemResult: { status: number; body: any; network?: boolean } = {
  status: 200,
  body: { ok: true, weekData: REDEEMED_WEEK },
};

let posted: Array<{ url: string; body: any }> = [];

// Parent PIN "0000" verifies for parents only; kid PIN "1234" for Caspian.
function fetchHandler() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/members/verify")) {
      const body = JSON.parse(String(init?.body || "{}"));
      const member = db_member(body.memberName);
      const ok =
        (member?.role === "parent" && body.pin === "0000") ||
        (body.memberName === "Caspian" && body.pin === "1234");
      return ok
        ? { ok: true, json: async () => ({ member: { name: body.memberName } }) }
        : { ok: false, status: 401, json: async () => ({}) };
    }
    if (url.includes("/api/rewards/redeem")) {
      if (redeemResult.network) throw new TypeError("Failed to fetch");
      posted.push({ url, body: JSON.parse(String(init?.body || "{}")) });
      return { ok: redeemResult.status < 400, status: redeemResult.status, json: async () => redeemResult.body };
    }
    return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) };
  });
}

function db_member(name: string) {
  if (name === "Jeffery") return { role: "parent" };
  if (name === "Caspian") return { role: "child" };
  return null;
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

async function settle(ms = 60) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

async function waitUntil(assertion: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => { await Promise.resolve(); });
      assertion();
    },
    { timeout: 5000, interval: 10 },
  );
}

function pinInputByLabel(ariaLabel: string): HTMLInputElement | null {
  return document.querySelector(`input[aria-label="${ariaLabel}"]`);
}

function outboxEntry(operationTitle: string) {
  return listTaskOutbox().find((entry) => entry.displayTarget.title === operationTitle);
}

async function clickRewardCard(labelPrefix: string, opened: string) {
  const card = document.querySelector(`[aria-label^="${labelPrefix}"]`) as HTMLElement;
  expect(card).not.toBeNull();
  await act(async () => { card.click(); });
  await waitUntil(() => expect(pinInputByLabel(opened)).not.toBeNull());
}

async function fillPin(ariaLabel: string, value: string) {
  const input = pinInputByLabel(ariaLabel);
  expect(input).not.toBeNull();
  await act(async () => { setInputValue(input!, value); });
  await waitUntil(() => expect(pinInputByLabel(ariaLabel)?.value).toBe(value));
}

async function pressButton(text: string, settled: () => void) {
  const button = buttonByText(text);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
  await waitUntil(settled);
}

function redeemsOnTheWire(): number {
  return posted.filter((entry) => entry.url.includes("/api/rewards/redeem")).length;
}

async function approveBigReward() {
  await clickRewardCard("Movie night — 150 points", "Parent PIN");
  await fillPin("Parent PIN", "0000");
  await pressButton("Approve", () => expect(pinInputByLabel("Your 4-digit PIN")).not.toBeNull());
  await fillPin("Your 4-digit PIN", "1234");
}

describe("RewardsShop parent approval gate (>100pt rewards)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    __resetTaskOutboxForTests();
    __resetTaskCommandCredentialsForTests();
    posted = [];
    store.week = { weekStart: "2026-09-01", points: { Caspian: 200 }, streak: {}, lastActive: {}, history: [] };
    store.saveWeekData.mockReset();
    store.syncWeekDataToPB.mockClear();
    redeemResult = { status: 200, body: { ok: true, weekData: REDEEMED_WEEK } };
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("tapping a >100pt reward opens the parent-approval modal and writes nothing", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();

    const card = el.querySelector('[aria-label^="Movie night — 150 points"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    // The established Tasks-page gate: parent approval BEFORE any redemption.
    expect(document.body.textContent || "").toContain("Parent Approval Required");
    expect(document.body.textContent || "").not.toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
  });

  it("a WRONG parent PIN never unlocks the redemption or writes points", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Movie night — 150 points"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const parentInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    expect(parentInput).not.toBeNull();
    await act(async () => { setInputValue(parentInput, "9999"); });
    await act(async () => { buttonByText("Approve")!.click(); });
    await settle();

    expect(document.body.textContent || "").toContain("Parent PIN required to approve large rewards.");
    expect(document.body.textContent || "").not.toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
  });

  it("a correct parent PIN unlocks the kid-PIN step, and the write lands only after it", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Movie night — 150 points"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const parentInput = document.querySelector('input[aria-label="Parent PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(parentInput, "0000"); });
    await act(async () => { buttonByText("Approve")!.click(); });
    await settle();

    // Approved → the normal kid redemption PIN step opens; still no write.
    expect(document.body.textContent || "").toContain("Redeem with your PIN");
    expect(store.saveWeekData).not.toHaveBeenCalled();

    const kidInput = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    expect(kidInput).not.toBeNull();
    await act(async () => { setInputValue(kidInput, "1234"); });
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();

    // The server's returned weekData is adopted verbatim — the old
    // local-then-fire-and-forget sync (syncWeekDataToPB) is gone: the gateway
    // now rejects a child's week_data write, so it would 403 and be reverted.
    expect(store.saveWeekData).toHaveBeenCalled();
    const week = store.saveWeekData.mock.calls.at(-1)![0];
    expect(week.points.Caspian).toBe(50);
    expect(week.history.some((tx: any) => tx.type === "redeem" && tx.amount === -150)).toBe(true);
    expect(store.syncWeekDataToPB).not.toHaveBeenCalled();
    expect(document.body.textContent || "").toContain("Redeemed!");
  });

  it("a ≤100pt reward skips parent approval (kid PIN only, as before)", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Ice cream trip — 40 points"]') as HTMLElement;
    expect(card).not.toBeNull();
    await act(async () => { card.click(); });
    await settle();

    expect(document.body.textContent || "").not.toContain("Parent Approval Required");
    expect(document.body.textContent || "").toContain("Redeem with your PIN");
  });

  it("a failed redeem (duplicate 409) shows the honest error and does NOT celebrate", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    redeemResult = {
      status: 409,
      body: { ok: false, reason: "duplicate", error: "That redemption just went through — check your points." },
    };
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Ice cream trip — 40 points"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();

    const text = document.body.textContent || "";
    expect(text).toContain("That redemption just went through");
    expect(text).not.toContain("Redeemed!");
    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect((document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement).value).toBe("");
  });

  it("an insufficient-points 400 surfaces the server's 'needs N more pts' copy (no celebration)", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    redeemResult = {
      status: 400,
      body: { ok: false, reason: "insufficient", error: "Caspian needs 10 more pts for 🍦 Ice cream trip" },
    };
    const el = await renderAsync(<RewardsShop />);
    await settle();
    const card = el.querySelector('[aria-label^="Ice cream trip — 40 points"]') as HTMLElement;
    await act(async () => { card.click(); });
    await settle();

    const input = document.querySelector('input[aria-label="Your 4-digit PIN"]') as HTMLInputElement;
    await act(async () => { setInputValue(input, "1234"); });
    await act(async () => { buttonByText("Redeem")!.click(); });
    await settle();

    const text = document.body.textContent || "";
    expect(text).toContain("needs 10 more pts");
    expect(text).not.toContain("Redeemed!");
    expect(store.saveWeekData).not.toHaveBeenCalled();
  });
});

describe("RewardsShop redemption acknowledgment (Wave 3 Task 4)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    __resetTaskOutboxForTests();
    __resetTaskCommandCredentialsForTests();
    posted = [];
    store.week = { weekStart: "2026-09-01", points: { Caspian: 200 }, streak: {}, lastActive: {}, history: [] };
    store.saveWeekData.mockReset();
    store.syncWeekDataToPB.mockClear();
    redeemResult = { status: 200, body: { ok: true, weekData: REDEEMED_WEEK } };
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("does not mutate local points before a 200 or 202 response", async () => {
    redeemResult = { status: 0, body: {}, network: true };
    vi.stubGlobal("fetch", fetchHandler());
    await renderAsync(<RewardsShop />);
    await settle();

    const before = JSON.parse(JSON.stringify(store.week));
    await approveBigReward();
    await pressButton("Redeem", () => {
      const entry = outboxEntry("Movie night");
      expect(entry?.status).toBe("retrying");
    });

    expect(store.saveWeekData).not.toHaveBeenCalled();
    expect(store.week).toEqual(before);
    expect(store.week.history).toHaveLength(0);
    expect(document.body.textContent || "").not.toContain("Redeemed!");
    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].status).toBe("retrying");
    expect(listTaskOutbox()[0].route).toBe("/api/rewards/redeem");
  });

  it("reuses one operation ID for network retries", async () => {
    redeemResult = { status: 0, body: {}, network: true };
    vi.stubGlobal("fetch", fetchHandler());
    await renderAsync(<RewardsShop />);
    await settle();

    await approveBigReward();
    await pressButton("Redeem", () => expect(outboxEntry("Movie night")?.status).toBe("retrying"));
    expect(listTaskOutbox()).toHaveLength(1);

    redeemResult = {
      status: 202,
      body: { ok: true, applied: true, duplicate: false, reconciled: false, weekData: REDEEMED_WEEK },
    };
    await pressButton("Redeem", () => expect(listTaskOutbox()).toHaveLength(0));

    const redeems = posted.filter((entry) => entry.url.includes("/api/rewards/redeem"));
    expect(redeems).toHaveLength(1);
    expect(listTaskOutbox()).toHaveLength(0);
    expect(typeof redeems[0].body.operationId).toBe("string");
    expect(redeems[0].body.operationId.length).toBeGreaterThan(0);
    expect(redeems[0].body).toMatchObject({
      action: "redeem",
      pin: "1234",
      parentPin: "0000",
      parentName: "Jeffery",
    });
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain("1234");
    expect(dump).not.toContain("0000");
  });

  it("adopts 202 and never creates a second local transaction", async () => {
    redeemResult = {
      status: 202,
      body: { ok: true, applied: true, duplicate: false, reconciled: false, weekData: REDEEMED_WEEK },
    };
    vi.stubGlobal("fetch", fetchHandler());
    await renderAsync(<RewardsShop />);
    await settle();

    await approveBigReward();
    await pressButton("Redeem", () => {
      expect(store.saveWeekData).toHaveBeenCalled();
      expect(listTaskOutbox()).toHaveLength(0);
    });

    expect(document.body.textContent || "").toContain("Redeemed!");
    expect(listTaskOutbox()).toHaveLength(0);
    expect(store.saveWeekData).toHaveBeenCalledTimes(1);

    const week = store.saveWeekData.mock.calls.at(-1)![0];
    expect(week.points.Caspian).toBe(50);
    expect(week.history.filter((tx: any) => tx.type === "redeem")).toHaveLength(1);
    expect(
      week.history.filter((tx: any) => tx.meta?.operationId === "redeem-fixture-op"),
    ).toHaveLength(1);
    expect(week.history.filter((tx: any) => tx.operationId !== undefined)).toHaveLength(0);
    expect(typeof posted.at(-1)!.body.operationId).toBe("string");
  });

  it("a queued >100 redemption names the approver on the wire and never a cost or a title", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    await renderAsync(<RewardsShop />);
    await settle();

    await approveBigReward();
    await pressButton("Redeem", () => expect(redeemsOnTheWire()).toBe(1));

    const redeems = posted.filter((entry) => entry.url.includes("/api/rewards/redeem"));
    expect(redeems).toHaveLength(1);
    expect(redeems[0].body).toMatchObject({
      action: "redeem",
      memberName: "Caspian",
      parentName: "Jeffery",
      pin: "1234",
      parentPin: "0000",
    });
    expect(redeems[0].body).not.toHaveProperty("cost");
    expect(redeems[0].body).not.toHaveProperty("title");
    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain("1234");
    expect(dump).not.toContain("0000");
  });

  it("a ≤100pt redemption sends the member PIN only — no parent identity at all", async () => {
    vi.stubGlobal("fetch", fetchHandler());
    await renderAsync(<RewardsShop />);
    await settle();

    await clickRewardCard("Ice cream trip — 40 points", "Your 4-digit PIN");
    await fillPin("Your 4-digit PIN", "1234");
    await pressButton("Redeem", () => expect(redeemsOnTheWire()).toBe(1));

    const redeems = posted.filter((entry) => entry.url.includes("/api/rewards/redeem"));
    expect(redeems).toHaveLength(1);
    expect(redeems[0].body.pin).toBe("1234");
    expect(redeems[0].body).not.toHaveProperty("parentPin");
    expect(redeems[0].body).not.toHaveProperty("parentName");
  });
});
