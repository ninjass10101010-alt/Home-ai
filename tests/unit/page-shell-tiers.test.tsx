// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import PageShell from "@/components/ui/PageShell";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/me",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: mockUseAuth }));

const PARENT = { hydrated: true, currentUser: { role: "parent" } };
// `hydrated: true` on every session: the dock renders nothing until auth has
// hydrated (capsule-nav-hydration.test.tsx), so a fixture without the flag
// describes a signed-out screen that has not resolved yet, not a parent/kid/pet.
const CHILD = { hydrated: true, currentUser: { role: "child" } };
const PET = { hydrated: true, currentUser: { role: "pet" } };
const GUEST = { hydrated: true, currentUser: null };
const SESSIONS = [PARENT, CHILD, PET, GUEST];

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function shell(el: HTMLElement): HTMLElement {
  return el.firstElementChild as HTMLElement;
}

/** The centred content column — the shell root's only element child. */
function column(el: HTMLElement): HTMLElement {
  return shell(el).firstElementChild as HTMLElement;
}

function rail(el: HTMLElement): HTMLElement | null {
  return el.querySelector('nav[aria-label="Main"]');
}

beforeEach(() => {
  mockUseAuth.mockReturnValue(PARENT);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("PageShell tiers (audit Phase 4)", () => {
  it("renders no left rail for any role — the dock is the only navigation", () => {
    for (const session of SESSIONS) {
      mockUseAuth.mockReturnValue(session);
      document.body.innerHTML = "";
      const el = render(<PageShell><p>page</p></PageShell>);
      expect(rail(el), `${JSON.stringify(session)} must not get a left rail`).toBeNull();
      expect(el.querySelector("aside"), `${JSON.stringify(session)} must not get a sidebar`).toBeNull();
    }
  });

  it("renders exactly one navigation surface, so the dock cannot be duplicated", () => {
    for (const session of SESSIONS) {
      mockUseAuth.mockReturnValue(session);
      document.body.innerHTML = "";
      const el = render(<PageShell><p>page</p></PageShell>);
      expect(el.querySelectorAll("nav").length, `${JSON.stringify(session)} nav count`).toBe(1);
    }
  });

  it("keeps the dock for every role", () => {
    for (const session of SESSIONS) {
      mockUseAuth.mockReturnValue(session);
      document.body.innerHTML = "";
      const el = render(<PageShell><p>page</p></PageShell>);
      expect(el.querySelector("nav"), `${JSON.stringify(session)} should have the dock`).not.toBeNull();
    }
  });

  it("reserves no width for a rail that no longer exists", () => {
    const el = render(<PageShell><p>page</p></PageShell>);
    expect(el.querySelector("[data-page-rail]")).toBeNull();
    expect(el.innerHTML).not.toContain("md:pl-60");
  });

  it("keeps the content column tiers and the page-settle transition", () => {
    const el = render(<PageShell><p>page</p></PageShell>);
    expect(column(el).className).toContain("max-w-lg");
    expect(column(el).className).toContain("md:max-w-3xl");
    expect(column(el).className).toContain("lg:max-w-none");
    const main = el.querySelector("main")!;
    expect(main.className).toContain("page-settle");
    expect(main.textContent).toBe("page");
  });

  it("applies caller classes and style to the outer shell", () => {
    const el = render(
      <PageShell className="rounded-2xl" style={{ backgroundColor: "transparent" }}>
        <p>page</p>
      </PageShell>,
    );
    expect(shell(el).className).toContain("rounded-2xl");
    expect(shell(el).style.backgroundColor).toBe("transparent");
    expect(shell(el).className).toContain("min-h-screen");
  });

  it("passes surface-specific sync copy through to the banner", () => {
    mockUseAuth.mockReturnValue(GUEST);
    const el = render(
      <PageShell bannerMessage="custom signed-out copy" bannerClassName="mx-3 sm:mx-4 mt-3">
        <p>page</p>
      </PageShell>,
    );
    const banner = el.querySelector('[data-testid="sync-status-banner"]')!;
    expect(banner.textContent).toContain("custom signed-out copy");
    expect(banner.className).toContain("mx-3");
  });

  it("falls back to the generic banner copy when none is given", () => {
    mockUseAuth.mockReturnValue(GUEST);
    const el = render(<PageShell><p>page</p></PageShell>);
    const banner = el.querySelector('[data-testid="sync-status-banner"]')!;
    expect(banner.textContent).toContain("Signed out — showing your saved copy");
  });

  it("defaults to a clipped root with dock clearance under the content", () => {
    const el = render(<PageShell><p>page</p></PageShell>);
    expect(shell(el).className).toContain("overflow-hidden");
    expect(el.querySelector("main")!.className).toContain("pb-32");
  });

  it("lets a page own its column: contentClassName, bottom inset and clip opt-outs", () => {
    const el = render(
      <PageShell
        contentClassName="max-w-lg mx-auto flex flex-col min-h-screen"
        bottomInset={false}
        clip={false}
      >
        <p>page</p>
      </PageShell>,
    );
    const main = el.querySelector("main")!;
    expect(main.className).toContain("max-w-lg");
    expect(main.className).toContain("min-h-screen");
    expect(main.className, "page manages dock clearance itself").not.toContain("pb-32");
    expect(shell(el).className, "document stays the scrollport for sticky").not.toContain("overflow-hidden");
    expect(shell(el).className).toContain("min-h-screen");
  });
});
