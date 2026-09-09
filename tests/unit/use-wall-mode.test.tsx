// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWallMode } from "@/hooks/useWallMode";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act pattern (see tests/unit/screensaver-board.test.tsx).
// renderHook is shimmed locally; the behavioral assertions are unchanged
// from the plan's test block.
let activeRoot: Root | null = null;
function renderHook<T>(use: () => T): { result: { current: T } } {
  const result = { current: undefined as T };
  function Probe() {
    result.current = use();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(Probe));
  });
  return { result };
}

function setViewport(width: number, height: number, portrait = true, coarse = true) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
    matches: q === "(orientation: portrait)" ? portrait : q === "(pointer: coarse)" ? coarse : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
  }
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.wall;
});

describe("useWallMode", () => {
  it("detects the wall and sets data-wall on <html>", () => {
    setViewport(1080, 1920);
    const { result } = renderHook(() => useWallMode());
    expect(result.current.wall).toBe(true);
    expect(result.current.mounted).toBe(true);
    expect(document.documentElement.dataset.wall).toBe("true");
  });

  it("a 390px phone is not wall", () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useWallMode());
    expect(result.current.wall).toBe(false);
    expect(document.documentElement.dataset.wall).toBeUndefined();
  });

  it("manual off beats auto-detect; the change event re-resolves", () => {
    setViewport(1080, 1920);
    localStorage.setItem("consuela-wall-mode", "off");
    const { result } = renderHook(() => useWallMode());
    expect(result.current.wall).toBe(false);
    act(() => {
      localStorage.setItem("consuela-wall-mode", "on");
      window.dispatchEvent(new Event("consuela-wall-mode-changed"));
    });
    expect(result.current.wall).toBe(true);
  });

  it("?wall=1 forces on even on a phone", () => {
    setViewport(390, 844);
    window.history.replaceState(null, "", "/?wall=1");
    const { result } = renderHook(() => useWallMode());
    expect(result.current.wall).toBe(true);
  });
});
