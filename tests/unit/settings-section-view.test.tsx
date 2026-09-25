// @vitest-environment jsdom
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: {
    hydrated: true,
    currentUser: null as { role: "parent" | "child" | "pet" } | null,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState.value,
}));

vi.mock("@/components/ui/PageShell", () => ({
  default: ({ children }: { children: ReactElement }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; children?: ReactNode }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}));

import SettingsSectionView from "@/components/settings/SettingsSectionView";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import { useSettingsFeedback } from "@/hooks/useSettingsFeedback";

const sectionViewSource = readFileSync(resolve(__dirname, "../../src/components/settings/SettingsSectionView.tsx"), "utf8");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];

function mount(ui: ReactElement) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return { element, root };
}

function cleanupRoots() {
  while (mountedRoots.length > 0) {
    const root = mountedRoots.pop()!;
    act(() => root.unmount());
  }
}

function FeedbackProbe() {
  const { feedback, showFeedback, clearFeedback } = useSettingsFeedback();
  return (
    <>
      <button type="button" onClick={() => showFeedback("Saved", "success")}>Show feedback</button>
      <button type="button" onClick={clearFeedback}>Clear feedback</button>
      <span data-testid="feedback-message">{feedback?.message ?? ""}</span>
      <span data-testid="feedback-tone">{feedback?.tone ?? ""}</span>
    </>
  );
}

function renderView(section: "me" | "family" | "safety" | "appearance" | "home" | "system") {
  return mount(
    <SettingsSectionView section={section}>
      <div data-settings-component={section} />
    </SettingsSectionView>,
  ).element;
}

async function renderLoadedView(section: "me" | "family" | "safety" | "appearance" | "home" | "system") {
  return renderView(section);
}

describe("SettingsSectionView", () => {
  beforeEach(() => {
    authState.value = {
      hydrated: true,
      currentUser: null,
    };
  });

  afterEach(() => {
    cleanupRoots();
    document.body.innerHTML = "";
  });

  it("waits for auth reconciliation before showing a focused section", () => {
    authState.value = {
      hydrated: false,
      currentUser: null,
    };

    const element = renderView("family");

    expect(element.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(element.textContent).not.toContain("People, pets, and roles");
  });

  it("locks a parent-only direct route for a guest", () => {
    const element = renderView("family");

    expect(element.textContent).toContain("not available");
    expect(element.textContent).not.toContain("People, pets, and roles");
    expect(element.querySelector('a[href="/settings"]')).toBeTruthy();
  });

  it.each([
    ["me", "me"],
    ["family", "family"],
    ["safety", "safety"],
    ["appearance", "appearance"],
    ["home", "home"],
    ["system", "system"],
  ] as const)("switches %s to its approved section component", async (section, component) => {
    authState.value = {
      hydrated: true,
      currentUser: { role: "parent" },
    };

    const element = await renderLoadedView(section);
    const rendered = Array.from(element.querySelectorAll<HTMLElement>("[data-settings-component]"));

    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.dataset.settingsComponent).toBe(component);
    expect(element.querySelector("[data-settings-surface]")?.getAttribute("data-section")).toBe(section);
     expect(element.querySelector('a[href="/settings"]')?.textContent).toContain("Back");
     for (const link of Array.from(element.querySelectorAll('nav[aria-label="Settings sections"] a'))) {
       expect(link.getAttribute("data-prefetch")).toBe("false");
     }
   });

  it("disables Next prefetch on every available-section link", () => {
    expect(sectionViewSource).toContain("prefetch={false}");
  });

  it("renders an allowed parent section with a real, large back link", async () => {
    authState.value = {
      hydrated: true,
      currentUser: { role: "parent" },
    };

    const element = await renderLoadedView("home");

    expect(element.querySelector("h1")?.textContent).toBe("Home");
    expect(element.querySelector('[data-settings-component="home"]')).toBeTruthy();
    const backLink = element.querySelector('a[href="/settings"]');
    expect(backLink?.textContent).toContain("Back");
    expect(backLink?.className).toContain("min-h-16");
  });
});

describe("SettingsConfirmDialog", () => {
  afterEach(() => {
    cleanupRoots();
    document.body.innerHTML = "";
  });

  it("uses the shared dialog with optional body content and confirms", () => {
    const onConfirm = vi.fn();
    mount(
      <SettingsConfirmDialog
        open
        title="Reset layout?"
        description="This changes the Home layout."
        confirmLabel="Reset"
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      >
        <p>Body content</p>
      </SettingsConfirmDialog>,
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Reset layout?");
    expect(dialog?.textContent).toContain("Body content");
    const confirm = Array.from(dialog?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Reset");
    act(() => confirm?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss while busy through Escape or the backdrop", () => {
    const onClose = vi.fn();
    mount(
      <SettingsConfirmDialog
        open
        title="Reset layout?"
        confirmLabel="Reset"
        busy
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    const backdrop = dialog?.parentElement;
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("invokes the void confirmation callback without handling its return", () => {
    const callbackResult = Promise.resolve();
    const catchSpy = vi.spyOn(callbackResult, "catch");
    const onConfirm = vi.fn(() => callbackResult);
    mount(
      <SettingsConfirmDialog
        open
        title="Reset layout?"
        confirmLabel="Reset"
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = Array.from(dialog?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Reset");
    act(() => confirm?.click());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(catchSpy).not.toHaveBeenCalled();
  });
});

describe("useSettingsFeedback", () => {
  afterEach(() => {
    cleanupRoots();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("returns typed feedback and clears it after the display interval", () => {
    vi.useFakeTimers();
    const { element } = mount(<FeedbackProbe />);

    const show = element.querySelector("button")!;
    act(() => show.click());
    expect(element.querySelector('[data-testid="feedback-message"]')?.textContent).toBe("Saved");
    expect(element.querySelector('[data-testid="feedback-tone"]')?.textContent).toBe("success");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(element.querySelector('[data-testid="feedback-message"]')?.textContent).toBe("");
    expect(element.querySelector('[data-testid="feedback-tone"]')?.textContent).toBe("");
  });

  it("clears feedback immediately when requested", () => {
    const { element } = mount(<FeedbackProbe />);
    const show = element.querySelector("button")!;
    act(() => show.click());
    expect(element.querySelector('[data-testid="feedback-message"]')?.textContent).toBe("Saved");
    act(() => element.querySelectorAll("button")[1].click());
    expect(element.querySelector('[data-testid="feedback-message"]')?.textContent).toBe("");
    expect(element.querySelector('[data-testid="feedback-tone"]')?.textContent).toBe("");
  });

  it("clears its pending timer when unmounted", () => {
    vi.useFakeTimers();
    const { element, root } = mount(<FeedbackProbe />);
    const show = element.querySelector("button")!;

    act(() => show.click());
    expect(vi.getTimerCount()).toBe(1);
    mountedRoots.pop();
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
