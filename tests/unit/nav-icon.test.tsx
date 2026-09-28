// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import NavIcon, { NAV_ICON_PATHS } from "@/components/ui/NavIcon";
import { NAV_ICON_KEYS, type NavIconKey } from "@/lib/nav-items";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NavIcon", () => {
  it("covers exactly the icon keys the nav manifest can ask for", () => {
    expect(Object.keys(NAV_ICON_PATHS).sort()).toEqual([...NAV_ICON_KEYS].sort());
  });

  it("draws real geometry for every key", () => {
    for (const iconKey of NAV_ICON_KEYS) {
      const svg = render(<NavIcon iconKey={iconKey} />).querySelector("svg");
      expect(svg, `${iconKey} renders no svg`).not.toBeNull();
      expect(svg!.children.length, `${iconKey} draws nothing`).toBeGreaterThan(0);
    }
  });

  it("renders every icon as decorative, currentColor ink so the label carries the name", () => {
    for (const iconKey of NAV_ICON_KEYS) {
      const svg = render(<NavIcon iconKey={iconKey} />).querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    }
  });

  it("draws the active item heavier, like the pre-manifest dock did", () => {
    const idle = render(<NavIcon iconKey="home" />).querySelector("svg")!;
    const active = render(<NavIcon iconKey="home" active />).querySelector("svg")!;
    expect(idle.getAttribute("stroke-width")).toBe("2");
    expect(active.getAttribute("stroke-width")).toBe("2.5");
  });

  it("passes sizing classes straight through to the svg", () => {
    const svg = render(<NavIcon iconKey="tasks" className="h-8 w-8" />).querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("h-8 w-8");
  });

  it("keeps a key typed to the manifest — no dangling strings", () => {
    const key: NavIconKey = "memory";
    expect(NAV_ICON_PATHS[key]).toBeTruthy();
  });
});
