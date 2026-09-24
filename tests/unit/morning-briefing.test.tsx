// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import MorningBriefingWidget from "@/components/briefing/MorningBriefingWidget";

const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

function mount(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}

const ack = async () => true;

describe("MorningBriefingWidget acknowledged state", () => {
  it("renders the acknowledged state centered with the illustrated briefing icon", () => {
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
    expect(iconBox?.querySelector('svg[data-variant="briefing"]')).not.toBeNull();
    expect(iconBox?.querySelector('svg[data-variant="briefing"]')?.getAttribute("data-state")).toBe("default");
    expect(iconBox?.textContent).not.toContain("🌅");
    expect((el.querySelector(".widget-card") as HTMLElement | null)?.style.getPropertyValue("--widget-tone")).toContain("#f97316");
  });

  it("selects the unread motion state while the briefing awaits acknowledgement", () => {
    const briefing = {
      id: "b1",
      scopeDate: "2026-08-20",
      acknowledged: false,
      summary: {
        events: [{ id: "e1", title: "School pickup", time: "3:00 PM" }],
        tasks: [],
        meals: [],
        suggestions: [],
      },
    } as never;

    const el = render(<MorningBriefingWidget briefing={briefing} loading={false} ack={ack} ackError={false} />);
    expect(el.querySelector('svg[data-variant="briefing"]')?.getAttribute("data-state")).toBe("unread");
  });

  it("keeps the briefing icon mounted through acknowledgement so its state can transition", () => {
    const briefing = {
      id: "b1",
      scopeDate: "2026-08-20",
      acknowledged: false,
      summary: {
        events: [{ id: "e1", title: "School pickup", time: "3:00 PM" }],
        tasks: [],
        meals: [],
        suggestions: [],
      },
    } as never;

    const { container, root } = mount(<MorningBriefingWidget briefing={briefing} loading={false} ack={ack} ackError={false} />);
    const before = container.querySelector('svg[data-variant="briefing"]');
    expect(before).not.toBeNull();
    expect(before?.getAttribute("data-state")).toBe("unread");

    act(() => {
      root.render(<MorningBriefingWidget briefing={{ ...briefing, acknowledged: true }} loading={false} ack={ack} ackError={false} />);
    });

    const after = container.querySelector('svg[data-variant="briefing"]');
    expect(after).toBe(before);
    expect(after?.getAttribute("data-state")).toBe("default");
    expect(after?.getAttribute("class")).toContain("home-widget-icon-state-default");
    expect(container.textContent).toContain("Acknowledged ✓");
  });

  it("keeps the compact full-height geometry through acknowledgement", () => {
    const briefing = {
      id: "b1",
      scopeDate: "2026-08-20",
      acknowledged: false,
      summary: {
        events: [{ id: "e1", title: "School pickup", time: "3:00 PM" }],
        tasks: [],
        meals: [],
        suggestions: [],
      },
    } as never;

    const { container, root } = mount(<MorningBriefingWidget briefing={briefing} loading={false} ack={ack} ackError={false} className="h-full" />);
    const shellBefore = container.firstElementChild as HTMLElement;
    const cardBefore = container.querySelector(".widget-card") as HTMLElement;
    const bodyBefore = Array.from(cardBefore.querySelectorAll<HTMLElement>("div")).find((node) => node.className.includes("min-h-0") && node.className.includes("p-5"));
    expect(shellBefore.className).toContain("h-full");
    expect(bodyBefore?.className).toContain("p-5");
    expect(bodyBefore?.className).toContain("flex-1");

    act(() => {
      root.render(<MorningBriefingWidget briefing={{ ...briefing, acknowledged: true }} loading={false} ack={ack} ackError={false} className="h-full" />);
    });

    const shellAfter = container.firstElementChild as HTMLElement;
    const cardAfter = container.querySelector(".widget-card") as HTMLElement;
    const bodyAfter = Array.from(cardAfter.querySelectorAll<HTMLElement>("div")).find((node) => node.className.includes("min-h-0") && node.className.includes("p-5"));
    expect(shellAfter).toBe(shellBefore);
    expect(cardAfter).toBe(cardBefore);
    expect(shellAfter.className).toContain("h-full");
    expect(bodyAfter?.className).toContain("p-5");
    expect(bodyAfter?.className).toContain("flex-1");
    expect(cardAfter.querySelector("h3")?.className).toContain("text-base");
  });

  it("removes briefing acknowledgement opacity transitions under reduced motion", () => {
    const briefing = {
      id: "b1",
      scopeDate: "2026-08-20",
      acknowledged: true,
      summary: { events: [], tasks: [], meals: [], suggestions: [] },
    } as never;
    const el = render(<MorningBriefingWidget briefing={briefing} loading={false} ack={ack} ackError={false} />);
    expect(document.querySelector(".briefing-acknowledged")).not.toBeNull();
    const rule = globalsCss.slice(globalsCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rule).toMatch(/\.briefing-acknowledged[\s\S]*?transition:\s*none\s*!important;/);
  });
});
