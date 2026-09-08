// @vitest-environment jsdom
// Harness note: this repo has no @testing-library/react; tests use the
// established createRoot+act pattern (see cache-refresher-screensaver.test.tsx).
// Assertions mirror the brief's testing-library test 1:1 via data-testid queries.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { ScreensaverBoard } from "@/components/screensaver/ScreensaverBoard";
import type { ScreensaverPayload } from "@/lib/screensaver/compose";

const payload: ScreensaverPayload = {
  ok: true,
  generatedAt: new Date().toISOString(),
  date: "2026-09-07",
  events: [
    { title: "All-day errand", time: "All day", allDay: true },
    { title: "Soccer", time: "4:00 PM", allDay: false, color: "#3b82f6" },
  ],
  dinner: { name: "Tacos" },
  tasks: { done: 6, total: 11 },
  briefing: ["📅 2 events today", "✅ 5 chores still open"],
  weather: { tempF: 72, hiF: 78, loF: 61, condition: "Partly cloudy" },
};

let root: Root | null = null;

function render(ui: ReactElement): void {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => {
    root!.render(ui);
  });
}

function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
});

afterEach(() => {
  // Unmount inside act so the clock interval + poller interval + visibility
  // listener tear down before the DOM goes away (no leaked timers).
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ScreensaverBoard", () => {
  it("renders every zone from the initial payload", () => {
    render(<ScreensaverBoard initial={payload} />);
    expect(byTestId("ss-clock")).toBeTruthy();
    expect(byTestId("ss-events")!.textContent).toContain("Soccer");
    expect(byTestId("ss-events")!.textContent).toContain("All-day errand");
    expect(byTestId("ss-dinner")!.textContent).toContain("Tacos");
    expect(byTestId("ss-chores")!.textContent).toContain("6 of 11");
    expect(byTestId("ss-weather")!.textContent).toContain("72°");
    expect(byTestId("ss-briefing")!.textContent).toContain("5 chores still open");
    expect(byTestId("ss-stale")).toBeNull();
  });

  it("null initial renders the clock only, no crash", () => {
    render(<ScreensaverBoard initial={null} />);
    expect(byTestId("ss-clock")).toBeTruthy();
    expect(byTestId("ss-events")!.textContent).toContain("Waiting for the family server");
  });

  it("dinner null shows the honest empty line", () => {
    render(<ScreensaverBoard initial={{ ...payload, dinner: null }} />);
    expect(byTestId("ss-dinner")!.textContent).toContain("Nothing planned yet");
  });
});
