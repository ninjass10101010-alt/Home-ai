// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import MoreSheet, { MoreButton } from "@/components/patterns/MoreSheet";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: mockUseAuth }));

const PARENT = { currentUser: { role: "parent" } };
const CHILD = { currentUser: { role: "child" } };
const GUEST = { currentUser: null };

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function hrefs(): (string | null)[] {
  return Array.from(document.querySelectorAll("[data-more-sheet] a")).map((a) => a.getAttribute("href"));
}

function titles(): (string | null)[] {
  return Array.from(document.querySelectorAll("[data-more-sheet] h3")).map((h) => h.textContent);
}

beforeEach(() => {
  mockUseAuth.mockReturnValue(PARENT);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("MoreSheet", () => {
  it("renders nothing at all while closed", () => {
    render(<MoreSheet open={false} onClose={() => {}} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("[data-more-sheet]")).toBeNull();
  });

  it("gives a parent every formerly orphaned destination, with real copy", () => {
    render(<MoreSheet open onClose={() => {}} />);
    expect(hrefs()).toEqual([
      "/grocery",
      "/skill-tree",
      "/time-capsule",
      "/analytics",
      "/money-mountain",
      "/memory",
    ]);
    expect(titles()).toEqual([
      "Grocery",
      "Skill Tree",
      "Time Capsule",
      "Insights",
      "Money Mountain",
      "Family Memory",
    ]);
    const rows = Array.from(document.querySelectorAll("[data-more-sheet] a"));
    for (const row of rows) {
      expect(row.textContent?.trim().length ?? 0, `${row.getAttribute("href")} is a blank row`).toBeGreaterThan(3);
      expect(row.querySelector("svg"), `${row.getAttribute("href")} has no icon`).not.toBeNull();
    }
  });

  it("never shows a child the parent-only memory bank", () => {
    mockUseAuth.mockReturnValue(CHILD);
    render(<MoreSheet open onClose={() => {}} />);
    expect(hrefs()).not.toContain("/memory");
    expect(hrefs()).toContain("/money-mountain");
  });

  it("keeps personal and financial destinations off the signed-out wall", () => {
    mockUseAuth.mockReturnValue(GUEST);
    render(<MoreSheet open onClose={() => {}} />);
    expect(hrefs()).toEqual(["/grocery", "/skill-tree", "/time-capsule", "/analytics"]);
    expect(document.querySelector("[data-more-role]")?.getAttribute("data-more-role")).toBe("guest");
  });

  it("opens as a real dialog with a title, and announces the role it filtered for", () => {
    render(<MoreSheet open onClose={() => {}} />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("More");
    expect(document.querySelector("[data-more-role]")?.getAttribute("data-more-role")).toBe("parent");
  });
});

describe("MoreButton", () => {
  it("announces that it opens a dialog and carries an accessible name", () => {
    const el = render(<MoreButton onClick={() => {}} />);
    const button = el.querySelector("button")!;
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-label")).toBe("More destinations");
    expect(button.textContent).toContain("More");
  });

  it("calls back when tapped", () => {
    const onClick = vi.fn();
    const el = render(<MoreButton onClick={onClick} />);
    act(() => {
      el.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
