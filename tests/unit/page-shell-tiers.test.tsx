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

const PARENT = { currentUser: { role: "parent" } };
const CHILD = { currentUser: { role: "child" } };
const PET = { currentUser: { role: "pet" } };
const GUEST = { currentUser: null };

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function rail(el: HTMLElement): HTMLElement | null {
  return el.querySelector('nav[aria-label="Main"]');
}

function railWrapper(el: HTMLElement): HTMLElement | null {
  return el.querySelector("[data-page-rail]");
}

beforeEach(() => {
  mockUseAuth.mockReturnValue(PARENT);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("PageShell tiers (audit Phase 4)", () => {
  it("renders the desktop rail for a parent on a non-Home route", () => {
    const el = render(<PageShell><p>page</p></PageShell>);
    expect(rail(el)).not.toBeNull();
    expect(railWrapper(el)?.getAttribute("data-page-rail")).toBe("true");
  });

  it("reserves the rail's width so content cannot slide under it", () => {
    const el = render(<PageShell><p>page</p></PageShell>);
    const wrapper = railWrapper(el)!;
    // The rail is `w-60` and the shell offset is `md:pl-60` — they must agree.
    expect(rail(el)?.closest("aside")?.className).toContain("w-60");
    expect(wrapper.className).toContain("md:pl-60");
  });

  it("keeps the dock for every role, and the rail only for a parent", () => {
    for (const session of [CHILD, PET, GUEST]) {
      mockUseAuth.mockReturnValue(session);
      document.body.innerHTML = "";
      const el = render(<PageShell><p>page</p></PageShell>);
      expect(rail(el), `${JSON.stringify(session)} should have no rail`).toBeNull();
      expect(railWrapper(el)?.className ?? "", "no rail means no offset").not.toContain("md:pl-60");
      expect(el.querySelector("nav")).not.toBeNull();
    }
  });

  it("keeps the content column tiers and the page-settle transition", () => {
    const el = render(<PageShell><p>page</p></PageShell>);
    const column = railWrapper(el)!.firstElementChild!;
    expect(column.className).toContain("max-w-lg");
    expect(column.className).toContain("md:max-w-3xl");
    expect(column.className).toContain("lg:max-w-none");
    const main = el.querySelector("main")!;
    expect(main.className).toContain("page-settle");
    expect(main.textContent).toBe("page");
  });

  it("applies caller classes and style to the outer shell", () => {
    const el = render(
      <PageShell className="rounded-t-3xl" style={{ backgroundColor: "transparent" }}>
        <p>page</p>
      </PageShell>,
    );
    const shell = el.firstElementChild as HTMLElement;
    expect(shell.className).toContain("rounded-t-3xl");
    expect(shell.style.backgroundColor).toBe("transparent");
    expect(shell.className).toContain("min-h-screen");
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
    expect((el.firstElementChild as HTMLElement).className).toContain("overflow-hidden");
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
    const root = el.firstElementChild as HTMLElement;
    expect(root.className, "document stays the scrollport for sticky").not.toContain("overflow-hidden");
    expect(root.className).toContain("min-h-screen");
  });
});
