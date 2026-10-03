// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
// The fallback renders through `PageShell` (the dock has to survive a Settings
// crash), so the shell's own dependencies need stubbing here: this suite renders
// the boundary bare, with none of the root layout's providers around it.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: null, hydrated: true }),
}));
vi.mock("@/hooks/useWallMode", () => ({ useWallMode: () => ({ wall: false }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/me",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    // Scoped to the alert: the shell the fallback now brings has the dock's own
    // buttons in the tree, and those are held to the dock's sizing, not this one.
    for (const control of Array.from(element.querySelectorAll<HTMLElement>('[role="alert"] button, [role="alert"] a[href="/settings"]'))) {
      expect(control.classList.contains("min-h-[64px]")).toBe(true);
    }
    expect(element.querySelector("h1")?.textContent).toContain("Settings");
    // The single `<main>` is PageShell's. The boundary has to bring one: it sits
    // in `settings/layout.tsx`, so tripping it replaces `SettingsSectionView` and
    // its shell along with the rest of the subtree.
    expect(element.querySelectorAll("main")).toHaveLength(1);
    expect(element.querySelector("section")).toBeTruthy();
    expect(element.textContent).toContain("Try again");
    expect(element.querySelector('a[href="/settings"]')).toBeTruthy();
    expect(element.textContent).not.toContain("saved settings are still safe");
    expect(element.textContent).not.toContain("private diagnostic detail");
  });

  it("brings the dock, and only one of it, even nested in an outer main", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const element = renderBoundary(true);

    // The dead end this fixes: a Settings crash with no dock and no way out.
    expect(element.querySelectorAll("nav")).toHaveLength(1);
    // …and exactly one dock even when something above already supplied a main.
    expect(element.querySelectorAll("main")).toHaveLength(2);
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
