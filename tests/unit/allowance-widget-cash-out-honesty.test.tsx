// @vitest-environment jsdom
/**
 * Bug B — AllowanceWidget's kid-mode "Cash Out" was a lie told to a child.
 *
 * `handleCashOut` made NO API call, deducted nothing from the ledger, wrote a
 * fabricated withdrawal into `consuela-allowance-history-*` in localStorage,
 * and rendered "Money goes to your Greenlight card! 🎉" next to a HARDCODED
 * account fragment (`****2847`). It was repeatable forever by reloading.
 *
 * There is no cash-out endpoint anywhere in the app: `GREENLIGHT_API_KEY` is
 * registered "Stored for when the integration is enabled" and
 * `pointsToCashRate` is read but never written. So the honest state is
 * UNAVAILABLE, and this suite pins that: nothing is transferred, nothing is
 * invented, no non-real account number is shown, and the child is told the
 * truth instead of being congratulated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  connected: true,
  mode: "kid" as "kid" | "adult",
  points: 250,
  credentials: { pointsToCashRate: "50" } as Record<string, string>,
  // Referentially STABLE on purpose: the widget's points effect keys on the
  // `currentUser` object, so a factory that minted a new one per render would
  // loop forever the moment a press changed state.
  kidUser: { id: "kid-1", name: "Kid", role: "child" } as Record<string, string>,
  parentUser: { id: "parent-1", name: "Parent", role: "parent" } as Record<string, string>,
}));

vi.mock("@/lib/connections/store", () => ({
  isConnected: () => state.connected,
  getCredentials: () => state.credentials,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: state.mode === "kid" ? state.kidUser : state.parentUser,
  }),
}));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: state.mode }),
}));

// The points are real (the server-owned weekData ledger); only the transfer
// was fictional.
vi.mock("@/modes/kid/kid-store", () => ({
  currentWeekPoints: () => ({ points: state.points, key: "Kid" }),
}));

import AllowanceWidget from "@/components/integrations/AllowanceWidget";

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function text(root: HTMLElement): string {
  return root.textContent ?? "";
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll("button"));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  state.connected = true;
  state.mode = "kid";
  state.points = 250;
  state.credentials = { pointsToCashRate: "50" };
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AllowanceWidget cash-out honesty (kid mode)", () => {
  it("offers no enabled Cash Out control, even with points available", () => {
    const root = render(<AllowanceWidget />);

    const cashOut = buttons(root).find((button) => /cash out/i.test(button.textContent ?? ""));
    expect(cashOut).toBeDefined();
    expect(cashOut!.disabled).toBe(true);
  });

  it("makes no API call when the control is pressed", async () => {
    const root = render(<AllowanceWidget />);

    const cashOut = buttons(root).find((button) => /cash out/i.test(button.textContent ?? ""));
    await act(async () => {
      cashOut!.click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes no fabricated withdrawal into localStorage", async () => {
    const root = render(<AllowanceWidget />);

    const cashOut = buttons(root).find((button) => /cash out/i.test(button.textContent ?? ""));
    await act(async () => {
      cashOut!.click();
    });

    const keys = Object.keys(localStorage);
    expect(keys.filter((key) => /allowance|greenlight|withdraw/i.test(key))).toEqual([]);
  });

  it("does not render a fake transaction history even when one was left behind", () => {
    // A previous version of the widget persisted fabricated rows here. They
    // must not be read back and shown to a child as real withdrawals.
    localStorage.setItem(
      "consuela-allowance-history-Kid",
      JSON.stringify([
        {
          id: "txn-fabricated",
          type: "withdrawal",
          amount: 5,
          points: 250,
          date: "2026-10-01T00:00:00.000Z",
          description: "Consuela points → Greenlight",
        },
      ]),
    );

    const root = render(<AllowanceWidget />);

    expect(text(root)).not.toContain("txn-fabricated");
    expect(text(root)).not.toContain("Consuela points");
  });

  it("never congratulates the child that their money moved", () => {
    const root = render(<AllowanceWidget />);
    const copy = text(root);

    expect(copy).not.toMatch(/Money goes to/i);
    expect(copy).not.toMatch(/Transferring/i);
    expect(copy).not.toMatch(/🎉/);
  });

  it("shows no account number, real or invented", () => {
    const root = render(<AllowanceWidget />);
    const copy = text(root);

    expect(copy).not.toMatch(/\*{2,}\d/);
    expect(copy).not.toContain("2847");
  });

  it("tells the child the truth: it is not set up, and their points are untouched", () => {
    const root = render(<AllowanceWidget />);
    const copy = text(root);

    expect(copy).toMatch(/isn'?t set up/i);
    expect(copy).toMatch(/grown-?up|parent/i);
  });

  it("keeps showing the real points balance", () => {
    const root = render(<AllowanceWidget />);
    expect(text(root)).toContain("250");
  });
});

describe("AllowanceWidget cash-out honesty (parent view)", () => {
  it("shows no invented destination account", () => {
    state.mode = "adult";
    const root = render(<AllowanceWidget />);
    const copy = text(root);

    expect(copy).not.toMatch(/\*{2,}\d/);
    expect(copy).not.toContain("2847");
  });

  it("does not present an unconfigured conversion rate as fact", () => {
    state.mode = "adult";
    state.credentials = {};
    const root = render(<AllowanceWidget />);
    const copy = text(root);

    expect(copy).not.toMatch(/50 pts = \$1/);
    expect(copy).toMatch(/not set/i);
  });
});
