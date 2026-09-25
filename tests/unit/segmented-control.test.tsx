// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import SegmentedControl from "@/components/ui/SegmentedControl";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const source = readFileSync(resolve(__dirname, "../../src/components/ui/SegmentedControl.tsx"), "utf8");
const options = [
  { id: "selected", label: "Selected" },
  { id: "glow", label: "Glow" },
  { id: "button", label: "Button" },
  { id: "border", label: "Border" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(compact = false, onChange = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(
    <SegmentedControl
      compact={compact}
      aria-label="Accent target"
      value="selected"
      options={options}
      onChange={onChange}
    />,
  ));
  return { element: host, onChange };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

describe("SegmentedControl", () => {
  it("preserves the existing default density and semantics", () => {
    const { element, onChange } = render();
    const group = element.querySelector<HTMLElement>('[role="radiogroup"]')!;
    const radios = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const indicator = element.querySelector<HTMLElement>("span[style]")!;

    expect(group.getAttribute("aria-label")).toBe("Accent target");
    expect(group.className).not.toContain("min-w-0");
    expect(radios).toHaveLength(4);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].className).toContain("px-3");
    expect(radios[0].className).toContain("gap-1.5");
    expect(radios[0].className).toContain("text-xs");
    expect(radios[0].className).not.toContain("basis-0");
    expect(radios[0].querySelector("span")?.className).toBe("whitespace-nowrap");
    expect(indicator.style.width).toBe("calc(25%)");
    expect(indicator.style.transform).toBe("translateX(0%)");

    act(() => radios[3].click());
    expect(onChange).toHaveBeenCalledWith("border");
  });

  it("uses shrinkable equal-quarter classes in compact mode without changing semantics", () => {
    const { element, onChange } = render(true);
    const group = element.querySelector<HTMLElement>('[role="radiogroup"]')!;
    const radios = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const indicator = element.querySelector<HTMLElement>("span[style]")!;

    expect(group.className).toContain("min-w-0");
    expect(radios).toHaveLength(4);
    for (const radio of radios) {
      expect(radio.className).toContain("min-w-0");
      expect(radio.className).toContain("basis-0");
      expect(radio.className).toContain("flex-1");
      expect(radio.className).toContain("px-1");
      expect(radio.className).toContain("text-xs");
      expect(radio.className).not.toContain("text-[11px]");
      expect(radio.className).not.toContain("px-3");
      expect(radio.querySelector("span")?.className).toBe("min-w-0 truncate");
    }
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(indicator.style.width).toBe("calc(25%)");
    expect(indicator.style.transform).toBe("translateX(0%)");

    act(() => radios[2].click());
    expect(onChange).toHaveBeenCalledWith("button");
  });

  it("pins the compact quarter-width source contract", () => {
    expect(source).toContain("compact?: boolean");
    expect(source).toContain("basis-0");
    expect(source).toContain("min-w-0 truncate");
    expect(source).toContain("calc(100% / ${options.length})");
  });
});
