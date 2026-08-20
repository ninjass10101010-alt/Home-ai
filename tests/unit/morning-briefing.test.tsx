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
  it("renders the acknowledged state centered with a protruding sunrise icon", () => {
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

    // Icon rides the shared WidgetCard protruding top-left slot (88px box)
    // with the warm briefing tone injected as --widget-tone.
    const iconBox = Array.from(el.querySelectorAll("div")).find(
      (d) => d.className.includes("absolute") && d.className.includes("z-30") && d.className.includes("pointer-events-none")
    );
    expect(iconBox).toBeTruthy();
    expect(iconBox?.textContent).toContain("🌅");
    expect((el.querySelector(".widget-card") as HTMLElement | null)?.style.getPropertyValue("--widget-tone")).toContain("#f97316");
  });
});