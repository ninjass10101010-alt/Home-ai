// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import SyncPreviewSheet from "@/components/meals/SyncPreviewSheet";

const preview = {
  items: [
    { name: "Chicken breast", quantity: "3 lb", category: "meat", priority: "high" as const },
    { name: "Milk", quantity: "1", category: "dairy", priority: "medium" as const },
  ],
  alreadyOnList: 2,
};

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<SyncPreviewSheet {...props} />); });
  // SyncPreviewSheet renders a Modal, which portals to document.body —
  // assertions query the body, not the mount container.
  return document.body;
}

function makeProps(overrides: any = {}) {
  const calls = { confirm: 0, cancel: 0 };
  return {
    props: {
      open: true,
      title: "Add missing from meal plan",
      preview,
      busy: false,
      onConfirm: () => { calls.confirm++; },
      onCancel: () => { calls.cancel++; },
      ...overrides,
    },
    calls,
  };
}

describe("SyncPreviewSheet", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("lists the items and the Add N button", async () => {
    const { props } = makeProps();
    const root = await render(props);
    expect(root.textContent).toContain("Chicken breast");
    expect(root.textContent).toContain("Milk");
    const add = Array.from(root.querySelectorAll("button")).find(b => /Add 2/.test(b.textContent || ""));
    expect(add).toBeTruthy();
  });

  it("shows the already-on-list count", async () => {
    const { props } = makeProps();
    const root = await render(props);
    expect(root.textContent).toMatch(/2 more already on your list/);
  });

  it("calls onConfirm when Add is tapped", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const add = Array.from(root.querySelectorAll("button")).find(b => /Add 2/.test(b.textContent || "")) as HTMLButtonElement;
    await act(async () => { add.click(); });
    expect(calls.confirm).toBe(1);
  });

  it("shows Adding… and disables confirm while busy", async () => {
    const { props } = makeProps({ busy: true });
    const root = await render(props);
    const add = Array.from(root.querySelectorAll("button")).find(b => /Adding/.test(b.textContent || "")) as HTMLButtonElement;
    expect(add).toBeTruthy();
    expect(add.disabled).toBe(true);
  });
});
