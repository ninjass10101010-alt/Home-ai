// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import SidebarNav from "@/components/ui/SidebarNav";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const navState = vi.hoisted(() => ({ path: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => navState.path }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: mockUseAuth }));

const PARENT = { currentUser: { role: "parent" } };
const CHILD = { currentUser: { role: "child" } };

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function railLabels(root: HTMLElement): (string | null)[] {
  return Array.from(root.querySelectorAll("nav a")).map((a) => a.textContent);
}

function activeLabel(root: HTMLElement): string | null {
  return root.querySelector('nav a[aria-current="page"]')?.textContent ?? null;
}

beforeEach(() => {
  mockUseAuth.mockReturnValue(PARENT);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  navState.path = "/";
});

describe("SidebarNav (the desktop rail)", () => {
  it("renders the manifest order for a parent — no more private 6-item list", () => {
    const el = render(<SidebarNav />);
    expect(railLabels(el)).toEqual(["Home", "Ask", "Meals", "Tasks", "Calendar", "House", "Settings"]);
  });

  it("swaps House for Rewards for a signed-in child, exactly like the dock", () => {
    mockUseAuth.mockReturnValue(CHILD);
    const el = render(<SidebarNav />);
    expect(railLabels(el)).toEqual(["Home", "Ask", "Meals", "Tasks", "Rewards", "Calendar", "Settings"]);
  });

  it("draws every item with the shared SVG icon set instead of emoji chrome", () => {
    const el = render(<SidebarNav />);
    const links = Array.from(el.querySelectorAll("nav a"));
    expect(links.length).toBe(7);
    for (const link of links) {
      expect(link.querySelector("svg"), `${link.textContent} has no icon`).not.toBeNull();
      expect(/\p{Extended_Pictographic}/u.test(link.textContent ?? ""), `${link.textContent} shows emoji`).toBe(false);
    }
  });

  it("uses the same active-item rule as the dock: a nested section keeps its parent lit", () => {
    navState.path = "/settings/me";
    const el = render(<SidebarNav />);
    expect(activeLabel(el)).toBe("Settings");
  });

  it("does not light up a lookalike prefix", () => {
    navState.path = "/mealsomething";
    const el = render(<SidebarNav />);
    expect(activeLabel(el)).toBeNull();
  });

  it("labels the rail for screen readers and keeps the Emergency reference link", () => {
    const el = render(<SidebarNav />);
    expect(el.querySelector('nav[aria-label="Main"]')).not.toBeNull();
    expect(el.querySelector('a[href="/emergency"]')).not.toBeNull();
  });
});
