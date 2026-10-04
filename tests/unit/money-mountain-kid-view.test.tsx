// @vitest-environment jsdom
/**
 * /money-mountain — a child's read-only view.
 *
 * `/money-mountain` is listed in `nav-items.ts` for `SIGNED_IN_ROLES`
 * (parent + child + pet) ON PURPOSE — "Finance stays off the shared
 * signed-out screen, like the ledger", and a kid watching their own mountain
 * climb is the entire motivational point of the feature. So the page must not
 * be hidden from a child.
 *
 * But every WRITE in this domain is now parent-only
 * (`requireLiveSession({ requireRole: 'parent' })`), so the page as shipped
 * showed a child a "New Goal" button, an "Add Funds" button and a "Withdraw"
 * button that all 403, an empty state whose only action was
 * "Create Your First Mountain", and a failure surface that said
 * "Failed to load mountains" — a page that looked broken rather than read-only.
 *
 * These tests pin the honest version: a child sees their own balance, progress,
 * milestones and history; gets NO write affordance at all (not a disabled one —
 * none, because none of them work); and is told the truth by a real sentence.
 * The parent's experience is asserted in the same file so the fix cannot be
 * bought by hiding the page from everyone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── The page's own surroundings are stubbed; its decisions are not ───────────
// PageShell only contributes the dock (whose presence is pinned statically by
// tests/unit/route-shell-contract.test.ts), and FogBackground / the emergency
// dialog are atmosphere and a modal. Neither carries a money affordance.
vi.mock("@/components/ui/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

// Sentinels: these two are another agent's committed, separately-tested files.
// The create sentinel still SUBMITS, so the "a write came back refused in
// flight" path is driven for real rather than mocked away.
vi.mock("@/components/money-mountain/CreateMountainForm", () => ({
  CreateMountainForm: ({ onSubmit }: { onSubmit: (data: unknown) => Promise<void> }) => (
    <button
      data-testid="create-mountain-form"
      // The real form awaits `onSubmit`, then closes, and catches a rejection
      // into its own inline error — so the sentinel does the same, or a
      // deliberate 400 would surface as an unhandled rejection.
      onClick={() => {
        void onSubmit({
          name: "Skateboard",
          targetAmount: 100,
          currency: "USD",
          icon: "🚲",
          color: "#ffffff",
          mountainTheme: "snow",
          matchEnabled: false,
          matchPercentage: 50,
        }).catch(() => {});
      }}
    >
      submit-create
    </button>
  ),
}));
vi.mock("@/components/money-mountain/TransactionLogger", () => ({
  TransactionLogger: () => <div data-testid="transaction-logger" />,
}));

const auth = vi.hoisted(() => ({
  role: "child" as "parent" | "child" | "pet" | null,
  hydrated: true,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: auth.role
      ? { id: 1, name: "Kai", role: auth.role, emoji: "", color: "", avatarSize: "", glow: false }
      : null,
    hydrated: auth.hydrated,
    isLoggedIn: auth.role !== null,
    isParent: auth.role === "parent",
  }),
}));

import MoneyMountainPage from "@/app/money-mountain/page";

// ── Fixtures ────────────────────────────────────────────────────────────────
const MOUNTAIN = {
  id: "mtn-kid-1",
  userId: "Kai",
  name: "Skateboard",
  description: "For the park",
  targetAmount: 100,
  currentAmount: 25,
  currency: "USD" as const,
  icon: "🛹",
  mountainTheme: "forest" as const,
  status: "active" as const,
  isCompleted: false,
  percentageComplete: 25,
  milestoneIndex: 1,
  daysActive: 12,
  matchEnabled: true,
  matchPercentage: 50,
  matchedAmount: 5,
  totalDeposits: 25,
  totalWithdrawals: 0,
  transactionCount: 2,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
};

const MILESTONES = [
  { id: "ms-1", mountainId: MOUNTAIN.id, percentage: 25, label: "Base Camp", icon: "⛺", isReached: true },
  { id: "ms-2", mountainId: MOUNTAIN.id, percentage: 50, label: "Halfway!", icon: "🌲", isReached: false },
];

const TRANSACTIONS = [
  {
    id: "tx-1",
    mountainId: MOUNTAIN.id,
    userId: "Kai",
    type: "deposit" as const,
    amount: 20,
    currency: "USD" as const,
    date: "2026-09-18T12:00:00.000Z",
    description: "Chore money",
    source: "chore" as const,
    isMatch: false,
    approved: true,
    createdAt: "2026-09-18T12:00:00.000Z",
  },
  {
    id: "tx-2",
    mountainId: MOUNTAIN.id,
    userId: "Dad",
    type: "match" as const,
    amount: 5,
    currency: "USD" as const,
    date: "2026-09-18T12:00:01.000Z",
    description: "Match for: Chore money",
    source: "match" as const,
    isMatch: true,
    approved: true,
    createdAt: "2026-09-18T12:00:01.000Z",
  },
];

const DETAIL = { mountain: MOUNTAIN, milestones: MILESTONES, transactions: TRANSACTIONS };

// ── The wire ────────────────────────────────────────────────────────────────
type Call = { method: string; url: string };
let calls: Call[] = [];
let listStatus = 200;
let listBody: { mountains: unknown[] } = { mountains: [MOUNTAIN] };
let detailStatus = 200;
let writeStatus = 200;
let writeError: string | null = null;

function respond(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function installFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (method !== "GET") {
        return respond({ error: writeError }, writeStatus);
      }
      if (/\/api\/money-mountain\/[^/]+$/.test(url)) {
        return respond(DETAIL, detailStatus);
      }
      return respond(listBody, listStatus);
    }),
  );
}

let activeRoot: Root | null = null;

async function renderPage() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(<MoneyMountainPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return el;
}

function buttonLabels(el: HTMLElement) {
  return Array.from(el.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
}

beforeEach(() => {
  document.body.innerHTML = "";
  auth.role = "child";
  auth.hydrated = true;
  listStatus = 200;
  listBody = { mountains: [MOUNTAIN] };
  detailStatus = 200;
  writeStatus = 200;
  writeError = null;
  installFetch();
});

afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("/money-mountain — a child sees their own mountain", () => {
  it("shows the balance they have saved", async () => {
    const el = await renderPage();
    expect(el.textContent).toContain("$25.00");
    expect(el.textContent).toContain("$100.00");
  });

  it("shows how far up the mountain they are", async () => {
    const el = await renderPage();
    expect(el.textContent).toContain("25%");
    expect(el.textContent).toMatch(/75% to go/i);
  });

  it("shows their milestones", async () => {
    const el = await renderPage();
    expect(el.textContent).toContain("Base Camp");
    expect(el.textContent).toContain("Halfway!");
  });

  it("shows their transaction history", async () => {
    const el = await renderPage();
    expect(el.textContent).toContain("Chore money");
    expect(el.textContent).toContain("+$20.00");
    expect(el.textContent).toContain("+$5.00");
  });

  it("shows the parent's match, which is the motivation", async () => {
    const el = await renderPage();
    expect(el.textContent).toMatch(/matched/i);
  });
});

describe("/money-mountain — a child gets no write affordance at all", () => {
  it("renders zero buttons — none of them would work", async () => {
    const el = await renderPage();
    expect(buttonLabels(el)).toEqual([]);
  });

  it("has no 'New Goal' control", async () => {
    const el = await renderPage();
    expect(el.textContent).not.toContain("New Goal");
  });

  it("has no deposit or withdraw control", async () => {
    const el = await renderPage();
    expect(el.textContent).not.toContain("Add Funds");
    expect(el.textContent).not.toContain("Withdraw");
  });

  it("cannot open the create form or the transaction logger", async () => {
    const el = await renderPage();
    expect(el.querySelector('[data-testid="create-mountain-form"]')).toBeNull();
    expect(el.querySelector('[data-testid="transaction-logger"]')).toBeNull();
  });

  it("explains why the money controls are missing, in a real sentence", async () => {
    const el = await renderPage();
    expect(el.textContent).toMatch(/grown-up/);
  });

  it("never issues a non-GET request", async () => {
    await renderPage();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("/money-mountain — a pet gets the same read-only view", () => {
  it("is told the same thing", async () => {
    auth.role = "pet";
    const el = await renderPage();
    expect(buttonLabels(el)).toEqual([]);
    expect(el.textContent).toMatch(/grown-up/);
  });
});

describe("/money-mountain — a child's empty state is honest", () => {
  it("is not offered a create action it cannot perform", async () => {
    listBody = { mountains: [] };
    const el = await renderPage();
    expect(el.textContent).not.toContain("Create Your First Mountain");
    expect(buttonLabels(el)).toEqual([]);
  });

  it("says a grown-up sets the goals up", async () => {
    listBody = { mountains: [] };
    const el = await renderPage();
    expect(el.textContent).toMatch(/grown-up/);
  });
});

describe("/money-mountain — a child's error surfaces are true", () => {
  it("never says 'Failed to load' for a page that is working as designed", async () => {
    listStatus = 500;
    const el = await renderPage();
    expect(el.textContent).not.toMatch(/failed to load/i);
    expect(el.textContent).not.toMatch(/unable to load/i);
  });

  it("reassures a child that nothing is lost", async () => {
    listStatus = 500;
    const el = await renderPage();
    expect(el.textContent).toMatch(/nothing.?s lost/i);
  });

  it("names the real reason on a refused detail read instead of hanging", async () => {
    detailStatus = 403;
    const el = await renderPage();
    expect(el.textContent).toMatch(/isn't yours/i);
    // The old code swallowed the 403 and left "Select a mountain to view
    // details" on screen forever, which reads as a dead page.
    expect(el.textContent).not.toContain("Select a mountain to view details");
  });

  it("does not tell a child to make a first deposit", async () => {
    const el = await renderPage();
    expect(el.textContent).not.toContain("Add your first deposit to get started!");
  });
});

describe("/money-mountain — a write refused in flight goes read-only", () => {
  it("drops the parent's controls and says why, rather than repeating the 403", async () => {
    auth.role = "parent";
    writeStatus = 403;
    writeError = "adult_only";
    const el = await renderPage();
    await act(async () => {
      (Array.from(el.querySelectorAll("button")).find((b) => /New Goal/.test(b.textContent ?? "")) as HTMLButtonElement).click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="create-mountain-form"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls.some((c) => c.method === "POST")).toBe(true);
    expect(el.textContent).not.toContain("New Goal");
    expect(el.textContent).toMatch(/grown-up/);
  });

  it("keeps the parent's own validation failure in the form, not in a role notice", async () => {
    // A 400 is not a permission problem: flipping the page to read-only because
    // a goal had no name would be a lie about what the viewer may do.
    auth.role = "parent";
    writeStatus = 400;
    writeError = "Name and target amount are required";
    const el = await renderPage();
    await act(async () => {
      (Array.from(el.querySelectorAll("button")).find((b) => /New Goal/.test(b.textContent ?? "")) as HTMLButtonElement).click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="create-mountain-form"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(buttonLabels(el).join(" ")).toContain("New Goal");
    expect(el.textContent).not.toMatch(/went read-only/);
  });
});

describe("/money-mountain — the parent's experience is unchanged", () => {
  it("keeps the 'New Goal' control", async () => {
    auth.role = "parent";
    const el = await renderPage();
    expect(buttonLabels(el).join(" ")).toContain("New Goal");
  });

  it("keeps the deposit and withdraw controls", async () => {
    auth.role = "parent";
    const el = await renderPage();
    const labels = buttonLabels(el).join(" ");
    expect(labels).toContain("Add Funds");
    expect(labels).toContain("Withdraw");
  });

  it("still opens the create form", async () => {
    auth.role = "parent";
    const el = await renderPage();
    await act(async () => {
      (Array.from(el.querySelectorAll("button")).find((b) => /New Goal/.test(b.textContent ?? "")) as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="create-mountain-form"]')).not.toBeNull();
  });

  it("still offers the create action on an empty page", async () => {
    auth.role = "parent";
    listBody = { mountains: [] };
    const el = await renderPage();
    expect(buttonLabels(el).join(" ")).toContain("Create Your First Mountain");
  });

  it("still shows the parent's own header copy", async () => {
    auth.role = "parent";
    const el = await renderPage();
    expect(el.textContent).toContain("Set goals, save money, climb mountains!");
  });

  it("keeps its own 'Unable to Load Mountains' state with a retry", async () => {
    auth.role = "parent";
    listStatus = 500;
    const el = await renderPage();
    expect(el.textContent).toContain("Unable to Load Mountains");
    expect(buttonLabels(el).join(" ")).toContain("Retry");
  });

  it("still opens the transaction logger from Add Funds", async () => {
    auth.role = "parent";
    const el = await renderPage();
    await act(async () => {
      (Array.from(el.querySelectorAll("button")).find((b) => /Add Funds/.test(b.textContent ?? "")) as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="transaction-logger"]')).not.toBeNull();
  });
});

describe("/money-mountain — no affordance paints before the role resolves", () => {
  it("withholds the parent's controls until auth has hydrated", async () => {
    auth.role = "parent";
    auth.hydrated = false;
    const el = await renderPage();
    expect(el.textContent).not.toContain("New Goal");
  });
});