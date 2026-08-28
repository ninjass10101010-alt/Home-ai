// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HomeSuggestionsWidget from "@/components/suggestions/HomeSuggestionsWidget";
import { AuthProvider } from "@/hooks/useAuth";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(<AuthProvider>{ui}</AuthProvider>));
  return el;
}

function makeSuggestions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    idempotencyHash: `h${i}`,
    kind: "pantry_low",
    severity: "info",
    title: `Suggestion ${i}`,
    body: `Body for suggestion ${i}`,
    emoji: "🥫",
    status: "pending",
    scopeDate: "2026-08-27",
    createdAt: new Date().toISOString(),
  }));
}

function stubFetchWith(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/consuela/suggestions")) {
        return Promise.resolve({ json: () => Promise.resolve({ items }) });
      }
      return Promise.reject(new Error("no network"));
    })
  );
}

describe("HomeSuggestionsWidget containment", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("caps the visible rows at 2 and offers a '+N more · See all' footer", async () => {
    stubFetchWith(makeSuggestions(4));
    const el = render(<HomeSuggestionsWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const rows = Array.from(el.querySelectorAll("*")).filter(
      (n) => n.textContent?.startsWith("Suggestion ") && n.className.includes("font-semibold")
    );
    expect(rows.length).toBe(2);

    expect(el.textContent).toContain("+2 more · See all →");
  });

  it("wraps the rows in a scrollable, min-height-0 container so they cannot spill", async () => {
    stubFetchWith(makeSuggestions(4));
    const el = render(<HomeSuggestionsWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const scroller = Array.from(el.querySelectorAll("div")).find(
      (d) => d.className.includes("overflow-y-auto") && d.className.includes("min-h-0")
    );
    expect(scroller).toBeTruthy();
  });

  it("hides the footer when there is nothing extra to reveal", async () => {
    stubFetchWith(makeSuggestions(2));
    const el = render(<HomeSuggestionsWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(el.textContent).not.toContain("more · See all →");
  });
});
