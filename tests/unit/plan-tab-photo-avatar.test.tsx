// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

vi.mock("@/db", () => ({
  db: {
    selectMembers: vi.fn(() => [
      { id: 1, name: "Rebecca", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily Photo", emoji: (globalThis as any).__EMILY_EMOJI, color: "rose" },
    ]),
    selectMembersFallback: vi.fn(() => [
      { id: 1, name: "Rebecca", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily Photo", emoji: (globalThis as any).__EMILY_EMOJI, color: "rose" },
    ]),
  },
}));

import PlanTab from "@/components/meals/PlanTab";

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  useAtmosphericTheme: () => ({ colors: {}, accentRgb: "99,102,241" }),
}));

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  (globalThis as any).__EMILY_EMOJI = PHOTO;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});
afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("PlanTab member picker photo avatars", () => {
  it("renders the add-back picker's photo member as an <img>, never raw base64 text", async () => {
    const el = render(<PlanTab meals={[]} activeDay="Wed" activeMeals={[]} recipes={[]} />);
    await act(async () => { await Promise.resolve(); });
    // No base64 anywhere before the picker opens (roster strip uses Avatar).
    expect(el.textContent).not.toContain("base64");

    // Remove the PHOTO eater so she appears in the add-back picker.
    const removeBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove Emily Photo"
    );
    expect(removeBtn).toBeDefined();
    await act(async () => { removeBtn!.click(); });

    // Open the "Not eating tonight" picker via its ＋ toggle button.
    const addBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Add members"
    );
    expect(addBtn).toBeDefined();
    await act(async () => { addBtn!.click(); });

    // The picker button for the photo member must render an image, not text.
    const pickerButtons = Array.from(el.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Emily Photo")
    );
    expect(pickerButtons.length).toBeGreaterThan(0);
    const pickerImg = pickerButtons.some((b) => b.querySelector("img"));
    expect(pickerImg).toBe(true);
    expect(el.textContent).not.toContain("base64");
    expect(el.textContent).not.toContain("data:image");
  });
});
