// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const suggestionsMock = vi.hoisted(() => ({ items: [] as any[], loading: false, act: vi.fn() }));
vi.mock("@/components/suggestions/hooks/useSuggestions", () => ({
  useSuggestions: () => ({
    items: suggestionsMock.items,
    loading: suggestionsMock.loading,
    dismiss: vi.fn(),
    act: suggestionsMock.act,
    needsPin: false,
    pinError: null,
    submitPin: vi.fn(),
    cancelPin: vi.fn(),
  }),
}));
vi.mock("@/components/suggestions/SuggestionPinModal", () => ({
  default: () => null,
}));

import { OpenLoopChips } from "@/app/chat/OpenLoopChips";

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

beforeEach(() => {
  suggestionsMock.items = [];
  suggestionsMock.loading = false;
  suggestionsMock.act = vi.fn();
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
});

describe("OpenLoopChips", () => {
  it("renders Consuela's live open loops as tap-to-draft chips", () => {
    suggestionsMock.items = [
      { id: "s1", kind: "pantry_low", title: "Milk is running low", emoji: "🥛", status: "pending" },
      { id: "s2", kind: "calendar_conflict", title: "Soccer overlaps dinner", emoji: "📅", status: "pending" },
    ];
    const onDraft = vi.fn();
    const el = render(<OpenLoopChips onDraft={onDraft} />);
    expect(el.textContent).toContain("Milk is running low");
    expect(el.textContent).toContain("Soccer overlaps dinner");
    const chip = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Milk"))!;
    act(() => { chip.click(); });
    expect(onDraft).toHaveBeenCalledWith(expect.stringContaining("Milk is running low"));
  });

  it("falls back to static category chips when the engine has nothing", () => {
    const onDraft = vi.fn();
    const el = render(<OpenLoopChips onDraft={onDraft} />);
    expect(el.textContent).toContain("Add Event");
    const chip = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Add Event"))!;
    act(() => { chip.click(); });
    expect(onDraft).toHaveBeenCalledWith(expect.stringContaining("soccer practice"));
    expect(JSON.stringify(onDraft.mock.calls[0][0])).not.toContain("Caspian");
  });

  it("shows a quiet loading state, not fabricated loops", () => {
    suggestionsMock.loading = true;
    const el = render(<OpenLoopChips onDraft={vi.fn()} />);
    expect(el.textContent).toContain("Seeing what needs doing");
  });

  it("hides parent-only kinds from child sessions", () => {
    suggestionsMock.items = [
      { id: "s1", kind: "pantry_low", title: "Milk is running low", emoji: "🥛", status: "pending" },
      { id: "s2", kind: "task_penalty_streak", title: "Chores skipped 3 days", emoji: "⚠️", status: "pending" },
    ];
    const el = render(<OpenLoopChips onDraft={vi.fn()} role="child" />);
    expect(el.textContent).not.toContain("Milk is running low");
    expect(el.textContent).toContain("Chores skipped 3 days");
  });

  it("caps the live loops at four", () => {
    suggestionsMock.items = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, kind: "custom", title: `Loop ${i}`, status: "pending",
    }));
    const el = render(<OpenLoopChips onDraft={vi.fn()} />);
    const loopButtons = Array.from(el.querySelectorAll("button")).filter((b) => b.textContent?.includes("Loop "));
    expect(loopButtons.length).toBe(4);
  });

  it("dedupes contradictory stale rows by normalized title (trust rule: never show two versions of one condition)", () => {
    // API contract: the feed is sorted -createdAt (NEWEST FIRST) — s2 (3 items)
    // is the fresher scan; s1 is the stale pre-fix row.
    suggestionsMock.items = [
      { id: "s2", kind: "grocery_store_optimization", title: "3 items have no store assigned", status: "pending" },
      { id: "s1", kind: "grocery_store_optimization", title: "2 items have no store assigned", status: "pending" },
      { id: "s3", kind: "pantry_low", title: "Milk is running low", status: "pending" },
    ];
    const el = render(<OpenLoopChips onDraft={vi.fn()} />);
    const storeChips = Array.from(el.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("no store assigned")
    );
    expect(storeChips.length).toBe(1);
    // The fresh row (higher id from the newest scan) survives.
    expect(el.textContent).toContain("3 items have no store assigned");
    expect(el.textContent).toContain("Milk is running low");
  });

  it("offers a confirm-gated Do-it affordance for actionable loops — the primary tap still drafts", () => {
    suggestionsMock.items = [
      {
        id: "s1", kind: "grocery_store_optimization", title: "3 items have no store assigned",
        status: "pending", actionLabel: "Assign to Aldi", actionPayload: { tool: "get_grocery_list", args: {} },
      },
    ];
    const onDraft = vi.fn();
    const el = render(<OpenLoopChips onDraft={onDraft} />);
    const chip = el.querySelector("button[aria-label*='3 items have no store assigned']") as HTMLElement;
    expect(chip).not.toBeNull();
    // Primary tap = draft (kid-safety rule unchanged).
    act(() => { chip.click(); });
    expect(onDraft).toHaveBeenCalled();
    // Act never silently drafts and the primary tap never acts.
    expect(suggestionsMock.act).not.toHaveBeenCalled();
    // The Do-it affordance is a separate, named control.
    const doIt = el.querySelector("button[aria-label='Do it: Assign to Aldi']") as HTMLElement;
    expect(doIt).not.toBeNull();
    act(() => { doIt.click(); });
    expect(suggestionsMock.act).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(onDraft).toHaveBeenCalledTimes(1); // act never silently drafts
  });

  it("shows no Do-it affordance for view-only loops (nothing actionable)", () => {
    suggestionsMock.items = [
      { id: "s1", kind: "calendar_conflict", title: "Soccer overlaps dinner", status: "pending" },
    ];
    const el = render(<OpenLoopChips onDraft={vi.fn()} />);
    const actBtn = el.querySelector("button[aria-label^='Do it:']");
    expect(actBtn).toBeNull();
  });

  it("Do-it keeps a 36px visual but grows its HIT AREA to ≥44px via the ::after negative-inset pattern", () => {
    suggestionsMock.items = [
      {
        id: "s1", kind: "grocery_store_optimization", title: "3 items have no store assigned",
        status: "pending", actionLabel: "Assign to Aldi", actionPayload: { tool: "get_grocery_list", args: {} },
      },
    ];
    const el = render(<OpenLoopChips onDraft={vi.fn()} />);
    const doIt = el.querySelector("button[aria-label='Do it: Assign to Aldi']") as HTMLElement;
    expect(doIt).not.toBeNull();
    // 36px visual + 2×4px ::after inset = 44px effective.
    expect(doIt.className).toContain("min-h-[36px]");
    expect(doIt.className).toContain("relative");
    expect(doIt.className).toContain("after:absolute");
    expect(doIt.className).toContain("after:-inset-1");
    // before:-inset is DEAD on glass-* surfaces (the material ::before wins)
    // — the contract is ::after.
    expect(doIt.className).not.toContain("before:-inset");
  });
});
