// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import ListRow from "@/components/ui/ListRow";

function renderRow(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

describe("ListRow motion", () => {
  it("does not apply the tap class (no hover/press scale) to any row", () => {
    const row = renderRow(<ListRow title="Test" onClick={() => {}} />);
    expect(row.className).not.toContain("tap");
  });

  it("keeps the hover background and focus ring for interactive rows", () => {
    const row = renderRow(<ListRow title="Test" onClick={() => {}} />);
    expect(row.className).toContain("hover:bg-[var(--color-surface-0)]/45");
    expect(row.className).toContain("focus-visible:ring-2");
  });

  it("does not add a focus ring to non-interactive rows", () => {
    const row = renderRow(<ListRow title="Test" />);
    expect(row.className).not.toContain("focus-visible");
  });
});