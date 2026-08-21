// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import CapsuleNav from "@/components/ui/CapsuleNav";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: mockUseAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const PARENT_USER = {
  currentUser: { id: 1, name: "Jeffery", role: "parent", emoji: "👨", color: "#fff", pin: "1234", avatarSize: "md", glow: false },
};
const CHILD_USER = {
  currentUser: { id: 2, name: "Caspian", role: "child", emoji: "🧒", color: "#fff", pin: "1234", avatarSize: "md", glow: false },
};

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function navLabels(root: HTMLElement): (string | null)[] {
  return Array.from(root.querySelectorAll("nav button")).map((b) => b.getAttribute("aria-label"));
}

describe("CapsuleNav with the House tab", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(PARENT_USER);
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders 7 items for a parent with House between Calendar and Settings", () => {
    const el = render(<CapsuleNav />);
    expect(navLabels(el)).toEqual(["Home", "Ask", "Meals", "Tasks", "Calendar", "House", "Settings"]);
  });

  it("renders 6 items for a child and omits House", () => {
    mockUseAuth.mockReturnValue(CHILD_USER);
    const el = render(<CapsuleNav />);
    const labels = navLabels(el);
    expect(labels).toHaveLength(6);
    expect(labels).not.toContain("House");
    expect(labels).toEqual(["Home", "Ask", "Meals", "Tasks", "Calendar", "Settings"]);
  });

  it("every nav item carries an aria-label", () => {
    const el = render(<CapsuleNav />);
    const buttons = Array.from(el.querySelectorAll("nav button"));
    expect(buttons.length).toBe(7);
    for (const b of buttons) {
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
