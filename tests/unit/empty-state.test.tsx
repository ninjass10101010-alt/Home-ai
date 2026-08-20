// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import EmptyState from "@/components/ui/EmptyState";

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

describe("EmptyState", () => {
  it("renders a self-contained glass card by default", () => {
    const state = render(<EmptyState title="Quiet day" description="No events today." icon="🌿" />);
    expect(state.className).toContain("rounded-3xl");
    expect(state.className).toContain("border");
    expect(state.className).toContain("backdrop-blur-xl");
    expect(state.className).toContain("min-h-56");
  });

  it("renders flat (no nested card chrome) when flat is set", () => {
    const state = render(<EmptyState title="Quiet day" description="No events today." icon="🌿" flat />);
    expect(state.className).not.toContain("rounded-3xl");
    expect(state.className).not.toContain("border");
    expect(state.className).not.toContain("backdrop-blur-xl");
    expect(state.className).not.toContain("min-h-56");
    expect(state.textContent).toContain("🌿");
    expect(state.textContent).toContain("Quiet day");
    expect(state.textContent).toContain("No events today.");
  });

  it("keeps action label + handler in flat mode", () => {
    let clicked = false;
    const state = render(
      <EmptyState title="No chores" description="Everything caught up" icon="🎉" flat actionLabel="Add chore" onAction={() => { clicked = true; }} />
    );
    const button = state.querySelector("button");
    expect(button?.textContent).toBe("Add chore");
    act(() => button?.click());
    expect(clicked).toBe(true);
  });
});