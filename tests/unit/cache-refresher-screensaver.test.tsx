// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pathnameRef = { current: "/screensaver" };
vi.mock("next/navigation", () => ({ usePathname: () => pathnameRef.current }));
const refreshCaches = vi.fn(async () => {});
const flushPendingWrites = vi.fn(async () => {});
vi.mock("@/db", () => ({ db: { refreshCaches: () => refreshCaches() } }));
vi.mock("@/lib/pending-writes", () => ({ flushPendingWrites: () => flushPendingWrites() }));

import { CacheRefresher } from "@/components/ui/CacheRefresher";

let root: Root | null = null;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => {
    root!.render(ui);
  });
  return el;
}

function rerender(ui: ReactElement) {
  act(() => {
    root!.render(ui);
  });
}

beforeEach(() => {
  refreshCaches.mockClear();
  flushPendingWrites.mockClear();
});

afterEach(() => {
  // Unmount inside act so the effect cleanup tears down the 60s interval
  // + visibility listener before the DOM goes away (no leaked timers).
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

it("does not poll the gateway on /screensaver", async () => {
  pathnameRef.current = "/screensaver";
  vi.useFakeTimers();
  try {
    const el = render(
      <CacheRefresher>
        <p>board</p>
      </CacheRefresher>
    );
    expect(el.textContent).toContain("board");
    // A real delay past one full 60s cycle (microtasks flushed) — not a
    // near-vacuous waitFor on an already-passing condition.
    await vi.advanceTimersByTimeAsync(60_000 + 5_000);
    expect(refreshCaches).not.toHaveBeenCalled();
    expect(flushPendingWrites).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("still polls on normal routes", async () => {
  pathnameRef.current = "/";
  render(
    <CacheRefresher>
      <p>home</p>
    </CacheRefresher>
  );
  await vi.waitFor(() => expect(refreshCaches).toHaveBeenCalled());
});

it("re-arms gateway polling after client navigation between normal routes", async () => {
  pathnameRef.current = "/";
  vi.useFakeTimers();
  try {
    render(
      <CacheRefresher>
        <p>home</p>
      </CacheRefresher>
    );
    // Mount-time flush + refresh land via microtasks.
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCaches).toHaveBeenCalledTimes(1);
    expect(flushPendingWrites).toHaveBeenCalledTimes(1);

    // First 60s tick refreshes (mount flush + tick = 2 flushes).
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshCaches).toHaveBeenCalledTimes(2);
    expect(flushPendingWrites).toHaveBeenCalledTimes(2);

    // Client navigation / -> /chat: the once-per-load mount flush must NOT
    // re-run…
    pathnameRef.current = "/chat";
    rerender(
      <CacheRefresher>
        <p>chat</p>
      </CacheRefresher>
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(flushPendingWrites).toHaveBeenCalledTimes(2);

    // …but the interval must be re-armed: another tick refreshes again.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshCaches).toHaveBeenCalledTimes(3);
    expect(flushPendingWrites).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
