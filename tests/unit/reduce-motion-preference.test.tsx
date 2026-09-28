// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { THEME_STORAGE_KEY } from "@/lib/theme-config";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * UI audit Phase 5.5 — a user-facing Reduce-motion toggle. The OS-level
 * `prefers-reduced-motion` never fires on the shared wall, so the family sets
 * it in Settings → Appearance; ThemeProvider mirrors it onto
 * `<html data-reduce-motion="true">` and globals.css applies the blanket
 * reduced-motion treatment.
 */

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-reduce-motion");
  // jsdom has no matchMedia; ThemeProvider queries it for the system scheme.
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function Consumer({ onReady }: { onReady: (set: (v: boolean) => void) => void }) {
  const { setReduceMotion } = useTheme();
  onReady(setReduceMotion);
  return null;
}

function mountConsumer(): { setReduceMotion: (v: boolean) => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let setter: (v: boolean) => void = () => {};
  act(() =>
    root.render(
      createElement(ThemeProvider, null, createElement(Consumer, { onReady: (s) => (setter = s) })),
    ),
  );
  return { setReduceMotion: (v) => act(() => setter(v)) };
}

describe("user-facing reduce motion (audit 5.5)", () => {
  it("mirrors the preference onto <html data-reduce-motion> and persists it", () => {
    const { setReduceMotion } = mountConsumer();

    setReduceMotion(true);
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "{}").reduceMotion).toBe(true);

    setReduceMotion(false);
    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "{}").reduceMotion).toBe(false);
  });

  it("globals.css applies the blanket reduced-motion treatment under the attribute", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain('html[data-reduce-motion="true"] *');
    const block = css.slice(
      css.indexOf('html[data-reduce-motion="true"] *'),
      css.indexOf("}", css.indexOf('html[data-reduce-motion="true"] *')),
    );
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("transition-duration: 0.01ms !important");
  });
});
