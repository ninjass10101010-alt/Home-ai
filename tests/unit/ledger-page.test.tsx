// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import LedgerPage from "@/app/ledger/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let authState = { isParent: true };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
// PageShell renders CapsuleNav (next/navigation); stub both minimally.
vi.mock("next/navigation", () => ({
  usePathname: () => "/ledger",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

describe("LedgerPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    authState = { isParent: true };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parent + healthy upstream → iframe pointed at /ledger-app/", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    const el = render(<LedgerPage />);
    await act(async () => {});
    const iframe = el.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/ledger-app/");
    expect(el.textContent).toContain("The Ledger");
  });

  it("child → locked state, no iframe, no fetch", async () => {
    authState = { isParent: false };
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const el = render(<LedgerPage />);
    await act(async () => {});
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("parents only");
    expect(spy).not.toHaveBeenCalled();
  });

  it("parent + upstream down → honest error + Try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502 })));
    const el = render(<LedgerPage />);
    await act(async () => {});
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("unreachable");
  });
});
