// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DesignSystemSelfAudit, { scanDesignSystem } from "@/components/design-system/DesignSystemSelfAudit";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * UI audit Phase 5.6 — one design-system page that audits itself: the
 * near-duplicate `/_design-system` page is deleted (middleware still rewrites
 * the legacy URL to `/design-system`), and the surviving page ends with a live
 * self-audit running the four house rules against its own DOM.
 */

function stubRect(el: Element, width: number, height: number) {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

function fixture(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <span style="font-size:9px">tiny</span>
    <span style="font-size:13px">fine</span>
    <button id="unnamed"></button>
    <button id="named">Save</button>
    <div id="pressed" style="box-shadow: inset 0 2px 4px rgba(0,0,0,0.4)"></div>
    <div id="exempt" data-ds-shadow-exempt style="box-shadow: inset 0 1px 0 rgba(255,255,255,0.2)"></div>
    <div data-ds-audit-ignore><span style="font-size:8px">ignored</span></div>
    <button id="small" aria-label="Small action"></button>
    <button id="small-hit" class="hit-44" aria-label="Small but hit-44"></button>
  `;
  document.body.appendChild(root);
  stubRect(root.querySelector("#small")!, 20, 20);
  stubRect(root.querySelector("#small-hit")!, 20, 20);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("design-system self-audit (audit 5.6)", () => {
  it("the duplicate /_design-system page stays deleted (middleware still rewrites the URL)", () => {
    expect(existsSync(join(process.cwd(), "src/app/_design-system/page.tsx"))).toBe(false);
  });

  it("flags sub-12px text, unnamed controls and resting inset shadows — and honours the opt-outs", () => {
    const root = fixture();
    const findings = scanDesignSystem(root);
    const by = (c: string) => findings.filter((f) => f.category === c);

    expect(by("sub-12px").map((f) => f.detail)).toEqual(["span at 9px"]);
    expect(by("no-accessible-name").map((f) => f.detail)).toEqual([expect.stringContaining("id=\"unnamed\"")]);
    expect(by("inset-shadow").map((f) => f.detail)).toEqual(["#pressed"]); // exempt div + audit-ignore subtree stay quiet
  });

  it("flags tap targets under 44px only when hit-44 is missing", () => {
    const root = fixture();
    const details = scanDesignSystem(root)
      .filter((f) => f.category === "tap-target")
      .map((f) => f.detail);
    expect(details).toHaveLength(1);
    expect(details[0]).toContain("20×20");
    expect(details[0]).toContain("small");
  });

  it("renders the audit card with a working re-scan", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(DesignSystemSelfAudit)));
    expect(host.textContent).toContain("Live self-audit");
    expect(host.textContent).toContain("Text below the 12px floor");
    const reScan = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Re-scan");
    expect(reScan).toBeDefined();
    act(() => reScan!.click());
    expect(host.textContent).toContain("finding");
  });
});
