// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import LedgerWidget from "@/components/finance/LedgerWidget";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let authState = { isParent: true };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

const PAYLOAD = {
  yearData: {
    "2026-09": {
      period: { monthLabel: "September", yearLabel: "2026" },
      ledger: { totalBudgeted: 7712.84, totalSpent: 1234.56 },
      accounts: [
        { name: "LMCU Checking", type: "Checking", balance: 3816.18 },
        { name: "Huntington", type: "Checking", balance: 526.36 },
        { name: "LMCU Shares", type: "Savings", balance: 5248.57 },
      ],
      balanceSnapshots: [
        { name: "Discover", category: "Loan", balance: 3488.63, lastUpdated: "2026-08-11" },
        { name: "Mortgage", category: "Loan", balance: 370194.62, lastUpdated: "8/31/2026" },
      ],
    },
  },
};

function fetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => PAYLOAD }))
  );
}

describe("LedgerWidget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    authState = { isParent: true };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders cash, debt, month totals, and freshness for a parent", async () => {
    fetchOk();
    const el = render(<LedgerWidget />);
    await act(async () => {});
    expect(el.textContent).toContain("The Ledger");
    expect(el.textContent).toContain("$9,591");   // cash
    expect(el.textContent).toContain("$373,683"); // debt
    expect(el.textContent).toContain("$1,235 of $7,713");
    expect(el.textContent).toContain("September 2026");
    expect(el.textContent).toContain("Balances as of 8/31/2026");
    // deep link to the embed page
    const link = Array.from(el.querySelectorAll("a[href='/ledger']"));
    expect(link.length).toBeGreaterThan(0);
  });

  it("renders nothing for non-parents and never fetches", async () => {
    authState = { isParent: false };
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const el = render(<LedgerWidget />);
    await act(async () => {});
    expect(el.innerHTML).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows an honest error state and Try again recovers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => { throw new Error("down"); })
    );
    const el = render(<LedgerWidget />);
    await act(async () => {});
    expect(el.textContent).toContain("unreachable");

    fetchOk();
    const btn = Array.from(el.querySelectorAll("button")).find((b) =>
      /Try again/.test(b.textContent ?? "")
    )!;
    await act(async () => { btn.click(); });
    expect(el.textContent).toContain("$9,591");
  });
});
