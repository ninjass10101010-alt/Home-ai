// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: vi.fn() }));
vi.mock("@/lib/chat-thread", () => ({ mergeThread: vi.fn(), SEED_GREETING_ID: "seed" }));
vi.mock("@/modes/kid/kid-store", () => ({ verifyPinRemote: vi.fn(), unreachableCopy: () => "unreachable" }));

import RememberedChip, { isMemoryProposal } from "@/components/chat/RememberedChip";

function render(el: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return container;
}

function buttonLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button")).map(
    (b) => `${(b as HTMLButtonElement).textContent ?? ""} ${(b as HTMLButtonElement).getAttribute("aria-label") ?? ""}`,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("isMemoryProposal", () => {
  it("accepts a memory proposal", () => {
    expect(isMemoryProposal({ tool: "remember_memory", args: { content: "x" } })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isMemoryProposal({ tool: "adjust_points", args: {} })).toBe(false);
    expect(isMemoryProposal(null)).toBe(false);
  });
});

describe("RememberedChip", () => {
  it("shows an undo affordance for a stored fact", () => {
    const container = render(
      <RememberedChip proposal={{ tool: "remember_memory", mode: "stored", id: "m1", args: { content: "Bailey is allergic to peanuts" } }} />,
    );
    expect(container.textContent).toContain("Bailey is allergic to peanuts");
    expect(buttonLabels(container).some((l) => /undo/i.test(l))).toBe(true);
  });

  it("offers Remember / Not now for a proposal", () => {
    const container = render(
      <RememberedChip proposal={{ tool: "remember_memory", mode: "proposed", args: { content: "I love pizza" } }} />,
    );
    const labels = buttonLabels(container);
    expect(labels.some((l) => /remember/i.test(l))).toBe(true);
    expect(labels.some((l) => /not now/i.test(l))).toBe(true);
  });

  it("never shows the undo button for a proposal that was not stored", () => {
    const container = render(
      <RememberedChip proposal={{ tool: "remember_memory", mode: "proposed", args: { content: "I love pizza" } }} />,
    );
    expect(buttonLabels(container).some((l) => /undo/i.test(l))).toBe(false);
  });
});
