// @vitest-environment jsdom
/**
 * Money Mountain — a control exists iff it works.
 *
 * `MountainVisualization` rendered "💰 Add Funds" and "💸 Withdraw" as bare
 * `<button>`s wired to OPTIONAL `onDeposit` / `onWithdraw` props: pass nothing
 * and you get two live-looking buttons that call `undefined`. That is precisely
 * the shape requirement 2 forbids — a control that is visible, tappable, and
 * cannot do the thing. Now the action row exists only when at least one
 * callback does, each button only when its own callback does, and a viewer who
 * cannot move money gets a real explanation where the buttons were.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MountainVisualization } from "@/components/money-mountain/MountainVisualization";
import { TransactionHistory } from "@/components/money-mountain/TransactionHistory";
import { emptyHistoryHint, readOnlyReason } from "@/components/money-mountain/viewer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const MOUNTAIN = {
  id: "mtn-1",
  userId: "Kai",
  name: "Skateboard",
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

let activeRoot: Root | null = null;

async function render(node: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return el;
}

function buttons(el: HTMLElement) {
  return Array.from(el.querySelectorAll("button")).map((b) => b.textContent ?? "");
}

describe("MountainVisualization — read-only viewer", () => {
  afterEach(() => {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("renders no controls at all when the viewer cannot move money", async () => {
    const el = await render(<MountainVisualization mountain={MOUNTAIN} />);
    expect(buttons(el)).toEqual([]);
  });

  it("explains the missing controls instead of leaving a hole", async () => {
    const el = await render(<MountainVisualization mountain={MOUNTAIN} />);
    expect(el.textContent).toMatch(/grown-up/);
  });

  it("still shows the balance, the progress and the matched total", async () => {
    const el = await render(<MountainVisualization mountain={MOUNTAIN} />);
    // The whole point of the page for a kid: the money, and how far up it is.
    expect(el.textContent).toContain("$25.00");
    expect(el.textContent).toContain("$100.00");
    expect(el.textContent).toContain("25%");
    expect(el.textContent).toContain("Matched");
    expect(el.textContent).toContain("$5.00");
  });

  it("keeps the parent's controls when the callbacks are there", async () => {
    const onDeposit = vi.fn();
    const onWithdraw = vi.fn();
    const el = await render(
      <MountainVisualization
        mountain={MOUNTAIN}
        onDeposit={onDeposit}
        onWithdraw={onWithdraw}
        readOnlyNote={readOnlyReason("parent")}
      />,
    );
    expect(buttons(el).join(" ")).toContain("Add Funds");
    expect(buttons(el).join(" ")).toContain("Withdraw");
    // The parent's controls are present, so the note must not also be on screen
    // telling them to ask a grown-up.
    expect(el.textContent).not.toMatch(/ask a grown-up/i);
  });

  it("renders only the control that actually works", async () => {
    const el = await render(<MountainVisualization mountain={MOUNTAIN} onDeposit={vi.fn()} />);
    expect(buttons(el).join(" ")).toContain("Add Funds");
    expect(buttons(el).join(" ")).not.toContain("Withdraw");
  });

  it("deposit fires the deposit callback", async () => {
    const onDeposit = vi.fn();
    const el = await render(<MountainVisualization mountain={MOUNTAIN} onDeposit={onDeposit} />);
    await act(async () => {
      el.querySelector("button")!.click();
    });
    expect(onDeposit).toHaveBeenCalledTimes(1);
  });
});

describe("TransactionHistory — the empty hint is role-appropriate", () => {
  afterEach(() => {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("tells a parent to make the first deposit", async () => {
    const el = await render(<TransactionHistory transactions={[]} currency="USD" />);
    expect(el.textContent).toContain("Add your first deposit to get started!");
  });

  it("does not tell a child to deposit money it cannot deposit", async () => {
    const el = await render(
      <TransactionHistory
        transactions={[]}
        currency="USD"
        emptyHint={emptyHistoryHint("child")}
      />,
    );
    expect(el.textContent).not.toContain("Add your first deposit to get started!");
    expect(el.textContent).toMatch(/grown-up/);
  });
});