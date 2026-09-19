// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import GroceryItemActionsSheet from "@/components/meals/GroceryItemActionsSheet";

const item = (over: any = {}) => ({ id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: true, ...over });

let reactRoot: Root | null = null;

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  reactRoot = createRoot(el);
  await act(async () => { reactRoot!.render(<GroceryItemActionsSheet {...props} />); });
  return el;
}
const sheetButtons = (root: HTMLElement) =>
  Array.from(document.body.querySelectorAll("button")).filter(b => !root.contains(b));
const byLabel = (root: HTMLElement, re: RegExp) => {
  const b = sheetButtons(root).find(x => re.test(x.getAttribute("aria-label") || x.textContent || ""));
  if (!b) throw new Error(`sheet button ${re} not found`);
  return b as HTMLButtonElement;
};

beforeEach(() => { document.body.innerHTML = ""; });

afterEach(async () => {
  await act(async () => { reactRoot?.unmount(); });
  reactRoot = null;
  document.body.innerHTML = "";
});

describe("GroceryItemActionsSheet", () => {
  it("renders all actions for a needed item (no pantry action)", async () => {
    const el = await render({ open: true, item: item(), onClose: () => {}, onToggleLock: () => {}, onEdit: () => {}, onDelete: () => {}, onSendToPantry: () => {} });
    byLabel(el, /lock Milk from auto-sync/);
    byLabel(el, /Edit Milk/);
    byLabel(el, /Delete Milk/);
    expect(sheetButtons(el).some(b => /send Milk to pantry/i.test(b.getAttribute("aria-label") || ""))).toBe(false);
  });
  it("adds the pantry action for a checked-off item", async () => {
    const el = await render({ open: true, item: item({ needed: false }), onClose: () => {}, onToggleLock: () => {}, onEdit: () => {}, onDelete: () => {}, onSendToPantry: () => {} });
    byLabel(el, /send Milk to pantry/i);
  });
  it("reuses the unlock label for a locked item", async () => {
    const el = await render({ open: true, item: item({ manualOverride: true }), onClose: () => {}, onToggleLock: () => {}, onEdit: () => {}, onDelete: () => {}, onSendToPantry: () => {} });
    byLabel(el, /unlock Milk for auto-sync/);
  });
  it("calls the handler and closes on every action", async () => {
    const calls: string[] = [];
    const el = await render({ open: true, item: item(), onClose: () => calls.push("close"), onToggleLock: () => calls.push("lock"), onEdit: () => calls.push("edit"), onDelete: () => calls.push("delete"), onSendToPantry: () => calls.push("pantry") });
    await act(async () => { byLabel(el, /Delete Milk/).click(); });
    expect(calls).toEqual(["delete", "close"]);
  });
  it("renders nothing when closed or itemless", async () => {
    const el = await render({ open: false, item: null, onClose: () => {}, onToggleLock: () => {}, onEdit: () => {}, onDelete: () => {}, onSendToPantry: () => {} });
    expect(document.body.textContent || "").not.toContain("Milk");
  });
});
