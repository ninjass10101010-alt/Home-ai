// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import MorningBriefingWidget from "@/components/briefing/MorningBriefingWidget";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

const ack = async () => true;

describe("MorningBriefingWidget acknowledged state", () => {
  it("renders the acknowledged state centered with a large sunrise icon", () => {
    const briefing = {
      id: "b1",
      scopeDate: "2026-08-20",
      acknowledged: true,
      summary: {
        events: [],
        tasks: [],
        meals: [],
        suggestions: [],
      },
    } as never;

    const el = render(<MorningBriefingWidget briefing={briefing} loading={false} ack={ack} ackError={false} />);
    expect(el.textContent).toContain("Acknowledged ✓");

    // Icon is the prominent large size (h-12 w-12) with a warm halo.
    const iconBox = Array.from(el.querySelectorAll("div")).find(
      (d) => d.className.includes("h-12") && d.className.includes("w-12")
    );
    expect(iconBox).toBeTruthy();

    const halo = Array.from(el.querySelectorAll("div")).find(
      (d) => d.className.includes("absolute") && d.className.includes("inset-0") && d.getAttribute("style")?.includes("249, 115, 22, 0.5")
    );
    expect(halo).toBeTruthy();
  });
});