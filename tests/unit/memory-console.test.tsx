// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: vi.fn() }));
vi.mock("@/lib/chat-thread", () => ({ mergeThread: vi.fn(), SEED_GREETING_ID: "seed" }));

import { FamilyMemoryBrowser } from "@/components/analytics/FamilyMemoryBrowser";

function render(el: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/curate")) return { ok: true, json: async () => ({ ok: true, runs: [] }) } as any;
    if (String(url).includes("/family-playbooks")) return { ok: true, json: async () => ({ ok: true, playbooks: [] }) } as any;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        memories: [{ id: "m1", key: "allergy_peanuts_bailey", category: "allergy", content: "Bailey is allergic to peanuts", person: "Bailey", tags: [] }],
      }),
    } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("the memory console", () => {
  it("shows the facts it loaded", async () => {
    const container = render(<FamilyMemoryBrowser familyId="demo-family" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Bailey is allergic to peanuts");
  });

  it("offers the three tabs", async () => {
    const container = render(<FamilyMemoryBrowser familyId="demo-family" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => (t.textContent ?? "").toLowerCase());
    expect(tabs.some((t) => t.includes("facts"))).toBe(true);
    expect(tabs.some((t) => t.includes("playbooks"))).toBe(true);
    expect(tabs.some((t) => t.includes("learned"))).toBe(true);
  });
});
