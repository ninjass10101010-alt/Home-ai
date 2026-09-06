// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import SyncStatusBanner from "@/components/ui/SyncStatusBanner";
import PageShell from "@/components/ui/PageShell";

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

async function render(el: HTMLElement, ui: React.ReactNode) {
  await act(async () => {
    createRoot(el).render(ui);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("SyncStatusBanner", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  it("shows a signed-out banner when the browser has no session", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await render(el, <SyncStatusBanner />);
    const banner = el.querySelector('[data-testid="sync-status-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/signed out/i);
  });

  it("renders nothing while signed in", async () => {
    mockAuth.isLoggedIn = true;
    const el = document.createElement("div");
    document.body.appendChild(el);
    await render(el, <SyncStatusBanner />);
    expect(el.querySelector('[data-testid="sync-status-banner"]')).toBeNull();
  });

  it("PageShell surfaces the banner on every data screen when signed out", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await render(
      el,
      <PageShell>
        <div>page body</div>
      </PageShell>
    );
    expect(el.textContent).toContain("page body");
    expect(el.querySelector('[data-testid="sync-status-banner"]')).not.toBeNull();
  });
});
