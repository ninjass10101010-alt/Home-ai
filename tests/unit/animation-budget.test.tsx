// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  AMBIENT_ANIMATION_BUDGET,
  AnimationBudgetProvider,
  useAmbientAnimation,
} from "@/components/providers/AnimationBudgetProvider";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ id }: { id: string }) {
  const allowed = useAmbientAnimation();
  return createElement("span", { "data-probe": id }, allowed ? "on" : "off");
}

function probes(count: number): ReactNode {
  return Array.from({ length: count }, (_, i) => createElement(Probe, { key: i, id: `p${i}` }));
}

let host: HTMLElement;
let root: Root;

function mount(ui: ReactNode): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(ui));
}

function states(): string[] {
  return Array.from(host.querySelectorAll("[data-probe]")).map((el) => el.textContent);
}

beforeEach(() => {
  host = undefined as unknown as HTMLElement;
  root = undefined as unknown as Root;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("ambient animation budget (audit 4.5)", () => {
  it("grants exactly AMBIENT_ANIMATION_BUDGET slots and denies the rest", () => {
    mount(
      createElement(AnimationBudgetProvider, null, probes(AMBIENT_ANIMATION_BUDGET + 2)),
    );
    const s = states();
    expect(s.filter((v) => v === "on")).toHaveLength(AMBIENT_ANIMATION_BUDGET);
    expect(s.filter((v) => v === "off")).toHaveLength(2);
  });

  it("releases slots when animated surfaces unmount, so the next claim wins", () => {
    mount(createElement(AnimationBudgetProvider, null, probes(AMBIENT_ANIMATION_BUDGET + 1)));
    expect(states().filter((v) => v === "off")).toHaveLength(1);

    act(() => root.render(createElement("div", null)));
    act(() => root.render(createElement(AnimationBudgetProvider, null, probes(AMBIENT_ANIMATION_BUDGET))));
    expect(states().filter((v) => v === "on")).toHaveLength(AMBIENT_ANIMATION_BUDGET);
  });

  it("stays unbounded outside a provider (every route except Home)", () => {
    mount(probes(3));
    expect(states().filter((v) => v === "on")).toHaveLength(3);
  });
});
