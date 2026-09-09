// @vitest-environment jsdom
// Harness note: no @testing-library/react — createRoot + act pattern (see
// wall-chrome.test.tsx). No existing test renders the full settings page and
// mocking its whole hook graph would be disproportionate, so the control is
// extracted to src/components/settings/WallDisplayToggle.tsx (self-contained:
// localStorage + event dispatch, mounted-gated) and the settings page renders
// it inside the "Layout & display" SectionCard. The plan's two behavioral
// assertions are preserved: the control exists in the card (wiring contract
// test below) and selecting On persists consuela-wall-mode.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import WallDisplayToggle from "@/components/settings/WallDisplayToggle";
import { WALL_MODE_KEY, WALL_MODE_EVENT } from "@/hooks/useWallMode";

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

function radio(el: HTMLElement, name: RegExp): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll('[role="radio"]')).find(
    (b) => name.test(b.textContent || "")
  );
  if (!btn) throw new Error(`radio ${name} not found`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  root = null;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  localStorage.clear();
});

describe("WallDisplayToggle", () => {
  it("defaults to Auto with the Wall display (ApoloSign) control and explainer", () => {
    const el = render(<WallDisplayToggle />);
    const group = el.querySelector('[role="radiogroup"][aria-label="Wall display (ApoloSign)"]');
    expect(group).toBeTruthy();
    expect(radio(el, /✨ Auto/).getAttribute("aria-checked")).toBe("true");
    expect(radio(el, /🧱 Wall on/).getAttribute("aria-checked")).toBe("false");
    expect(radio(el, /🧱 Wall off/).getAttribute("aria-checked")).toBe("false");
    expect(el.textContent).toContain(
      "Wall display (ApoloSign) — Auto detects the wall screen on its own; force On/Off to override."
    );
    expect(localStorage.getItem(WALL_MODE_KEY)).toBeNull();
  });

  it("selecting Wall on persists consuela-wall-mode=on and dispatches the change event", () => {
    const el = render(<WallDisplayToggle />);
    const fired = vi.fn();
    window.addEventListener(WALL_MODE_EVENT, fired);
    act(() => {
      radio(el, /🧱 Wall on/).click();
    });
    expect(radio(el, /🧱 Wall on/).getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(WALL_MODE_KEY)).toBe("on");
    expect(fired).toHaveBeenCalledTimes(1);
    window.removeEventListener(WALL_MODE_EVENT, fired);
  });

  it("selecting Wall off persists off", () => {
    const el = render(<WallDisplayToggle />);
    act(() => {
      radio(el, /🧱 Wall off/).click();
    });
    expect(localStorage.getItem(WALL_MODE_KEY)).toBe("off");
  });

  it("hydrates a stored preference on mount; Auto removes the key + dispatches", () => {
    localStorage.setItem(WALL_MODE_KEY, "on");
    const el = render(<WallDisplayToggle />);
    expect(radio(el, /🧱 Wall on/).getAttribute("aria-checked")).toBe("true");
    const fired = vi.fn();
    window.addEventListener(WALL_MODE_EVENT, fired);
    act(() => {
      radio(el, /✨ Auto/).click();
    });
    expect(localStorage.getItem(WALL_MODE_KEY)).toBeNull();
    expect(fired).toHaveBeenCalledTimes(1);
    window.removeEventListener(WALL_MODE_EVENT, fired);
  });
});

describe("settings page wiring contract", () => {
  it("renders WallDisplayToggle inside the Layout & display card", () => {
    const src = readFileSync(resolve(__dirname, "../../src/app/settings/page.tsx"), "utf8");
    expect(src).toContain('from "@/components/settings/WallDisplayToggle"');
    expect(src).toContain("<WallDisplayToggle />");
  });
});
