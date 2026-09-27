// @vitest-environment jsdom
/**
 * Audit P0-4 (phase 2) — `ReadStatePill` is the compact honesty affordance for
 * bento widgets, so it has to satisfy the same two rules as the rest of the
 * phase: it must *name* the state, and it must offer a *real* way out.
 *
 * The tap-target and text-size assertions are deliberate. `EmptyState` and
 * `ErrorState` were built for full screens; the first inline row we shipped for
 * a widget would otherwise have been another 10px caption with a 20px "retry"
 * word nobody on a wall display could hit (audit P1-2 / P2-1).
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadStatePill from "@/components/ui/ReadStatePill";
import { READ_COPY, READ_COPY_STALE, type ReadFailure } from "@/lib/read-state";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

async function render(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(ui);
  });
  return host;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  const active = root;
  root = null;
  if (active) await act(async () => active.unmount());
  document.body.innerHTML = "";
});

describe("ReadStatePill", () => {
  const states: ReadFailure[] = ["empty", "offline", "unauthorised", "error"];

  it("names every failure state with the shared copy", async () => {
    for (const state of states) {
      const el = await render(<ReadStatePill state={state} />);
      expect(el.textContent).toContain(READ_COPY[state]);
      expect(el.querySelector("[data-read-state]")?.getAttribute("data-read-state")).toBe(state);
    }
  });

  it("announces politely without stealing focus (role=status, aria-live=polite)", async () => {
    const el = await render(<ReadStatePill state="offline" />);
    const row = el.querySelector('[data-testid="read-state-pill"]')!;
    expect(row.getAttribute("role")).toBe("status");
    expect(row.getAttribute("aria-live")).toBe("polite");
  });

  it("accepts the stale copy when usable data is still on screen", async () => {
    const el = await render(<ReadStatePill state="error" message={READ_COPY_STALE} />);
    expect(el.textContent).toContain("saved copy");
    expect(el.textContent).not.toBe(READ_COPY.error);
  });

  it("can name the thing that failed", async () => {
    const el = await render(<ReadStatePill state="offline" subject="Google Calendar" />);
    expect(el.textContent).toContain("Google Calendar");
    expect(el.textContent).toContain(READ_COPY.offline);
  });

  it("offers a real, tappable retry — colour alone is the bug this replaces", async () => {
    const onRetry = vi.fn();
    const el = await render(<ReadStatePill state="error" onRetry={onRetry} />);
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("Try again");
    await act(async () => {
      button.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("holds the retry to the 44px / 12px floor the sweep enforces", async () => {
    const el = await render(<ReadStatePill state="offline" onRetry={() => {}} />);
    const classes = el.querySelector("button")!.className;
    expect(classes).toContain("hit-44"); // 44x44 pseudo box (globals.css)
    expect(classes).toContain("min-h-11"); // 2.75rem = 44px real height
    expect(classes).toContain("text-xs"); // 12px — the Contract B2 floor
  });

  it("shows honest progress while a retry is in flight instead of looking dead", async () => {
    const el = await render(<ReadStatePill state="error" onRetry={() => {}} retrying />);
    const button = el.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Trying…");
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("renders no retry affordance when the caller has none to give", async () => {
    const el = await render(<ReadStatePill state="unauthorised" />);
    expect(el.querySelector("button")).toBeNull();
  });
});
