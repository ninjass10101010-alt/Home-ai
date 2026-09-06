// @vitest-environment jsdom
// Fix-A finding 5 — /rewards was ungated: a parent or guest deep-linking in
// saw the kid shop with a meaningless balance. Non-kid modes now get a calm
// explainer (no redirect — the page stays discoverable); kids get the shop.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/rewards",
}));

const modeMock = vi.hoisted(() => ({ mode: "kid" as string }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: modeMock.mode, isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

// PageShell's SyncStatusBanner reads the auth context.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: null, isLoggedIn: false }),
}));

// Sentinel for the real shop (it has its own data/PIN harness elsewhere).
vi.mock("@/modes/kid/RewardsShop", () => ({
  default: () => <div data-testid="rewards-shop" />,
}));

import RewardsPage from "@/app/rewards/page";

let activeRoot: Root | null = null;

async function renderPage() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(<RewardsPage />);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

describe("/rewards mode gate", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    modeMock.mode = "kid";
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("kid mode renders the shop", async () => {
    const el = await renderPage();
    expect(el.querySelector('[data-testid="rewards-shop"]')).not.toBeNull();
    expect(el.textContent).not.toContain("This is the kids");
  });

  it("adult mode gets the calm explainer — no shop, no redirect", async () => {
    modeMock.mode = "adult";
    const el = await renderPage();
    expect(el.querySelector('[data-testid="rewards-shop"]')).toBeNull();
    expect(el.textContent).toContain("This is the kids' rewards shop");
    expect(el.textContent).toContain("Grown-ups set the rewards up on the Tasks page");
    // Discoverable, not bounced: a Tasks link is offered, nothing auto-navigates.
    expect(el.querySelector('a[href="/tasks"]')).not.toBeNull();
  });

  it("family/guest mode gets the same calm explainer", async () => {
    modeMock.mode = "family";
    const el = await renderPage();
    expect(el.querySelector('[data-testid="rewards-shop"]')).toBeNull();
    expect(el.textContent).toContain("This is the kids' rewards shop");
  });
});
