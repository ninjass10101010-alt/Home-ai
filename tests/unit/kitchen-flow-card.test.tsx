// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import KitchenFlowCard from "@/components/meals/KitchenFlowCard";

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<KitchenFlowCard {...props} />); });
  return el;
}

describe("KitchenFlowCard", () => {
  beforeEach(() => { document.body.innerHTML = ""; localStorage.clear(); });

  it("renders the stepper with the current step highlighted", async () => {
    const root = await render({ step: "shop", summary: "8 items to buy · 3 checked off" });
    expect(root.textContent).toContain("Plan");
    expect(root.textContent).toContain("Shop");
    expect(root.textContent).toContain("Stock");
    const current = Array.from(root.querySelectorAll("[aria-current='step']"));
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Shop");
  });

  it("shows the step sentence and the live summary", async () => {
    const root = await render({ step: "plan", summary: "12 meals planned · 5 ingredients missing" });
    expect(root.textContent).toContain("Pick this week's meals");
    expect(root.textContent).toContain("12 meals planned · 5 ingredients missing");
  });

  it("collapses and remembers the collapse state", async () => {
    const root = await render({ step: "stock", summary: "24 stocked · 3 running low · 1 out" });
    const toggle = Array.from(root.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "Collapse kitchen flow card") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); });
    expect(root.textContent).not.toContain("24 stocked");
    expect(localStorage.getItem("consuela-kitchen-flow-collapsed")).toBe("1");
  });
});
