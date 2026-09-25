// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsErrorBoundary from "@/components/ui/SettingsErrorBoundary";

let shouldThrow = true;
const mountedRoots: Root[] = [];

function UnstableChild() {
  if (shouldThrow) throw new Error("private diagnostic detail");
  return <p>Recovered content</p>;
}

function renderBoundary(insideMain = false) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mountedRoots.push(root);
  const boundary = (
    <SettingsErrorBoundary>
      <UnstableChild />
    </SettingsErrorBoundary>
  );
  act(() => {
    root.render(insideMain ? <main>{boundary}</main> : boundary);
  });
  return element;
}

describe("SettingsErrorBoundary", () => {
  afterEach(() => {
    shouldThrow = true;
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows a calm recovery state without exposing the error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const element = renderBoundary();

    const fallbackSurface = element.querySelector<HTMLElement>('section[data-settings-surface="true"][data-settings-content="true"]');
    expect(fallbackSurface).toBeTruthy();
    const alert = element.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.classList.contains("w-full")).toBe(true);
    expect(alert?.classList.contains("max-w-2xl")).toBe(true);
    expect(alert?.classList.contains("max-w-lg")).toBe(false);
    for (const control of Array.from(element.querySelectorAll<HTMLElement>('button, a[href="/settings"]'))) {
      expect(control.classList.contains("min-h-[64px]")).toBe(true);
    }
    expect(element.querySelector("h1")?.textContent).toContain("Settings");
    expect(element.querySelector("main")).toBeNull();
    expect(element.querySelector("section")).toBeTruthy();
    expect(element.textContent).toContain("Try again");
    expect(element.querySelector('a[href="/settings"]')).toBeTruthy();
    expect(element.textContent).not.toContain("saved settings are still safe");
    expect(element.textContent).not.toContain("private diagnostic detail");
  });

  it("does not nest a main when the incumbent shell already supplies one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const element = renderBoundary(true);

    expect(element.querySelectorAll("main")).toHaveLength(1);
    expect(element.querySelector("main > section")).toBeTruthy();
  });

  it("retries the children when Try again is pressed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const element = renderBoundary();
    shouldThrow = false;

    const retry = Array.from(element.querySelectorAll("button")).find((button) => button.textContent === "Try again");
    expect(retry).toBeTruthy();
    act(() => {
      retry!.click();
    });

    expect(element.textContent).toContain("Recovered content");
    expect(element.textContent).not.toContain("Try again");
  });
});
