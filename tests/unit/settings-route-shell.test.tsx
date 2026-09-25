// @vitest-environment jsdom
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/settings/me",
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  view: vi.fn(),
  pageShellRenders: 0,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  usePathname: () => mocks.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/ui/PageShell", () => ({
  default: ({ children }: { children: ReactNode }) => {
    mocks.pageShellRenders += 1;
    return <div data-testid="page-shell">{children}</div>;
  },
}));

vi.mock("@/components/settings/SettingsSectionView", () => ({
  default: ({ section, children }: { section: string; children: ReactNode }) => {
    mocks.view({ section });
    return <div data-testid="section-view">{children}</div>;
  },
}));

vi.mock("@/components/settings/routes/MeSettingsRoute", () => ({ default: () => <div data-route-component="me" /> }));
vi.mock("@/components/settings/routes/FamilySettingsRoute", () => ({ default: () => <div data-route-component="family" /> }));
vi.mock("@/components/settings/routes/SafetySettingsRoute", () => ({ default: () => <div data-route-component="safety" /> }));
vi.mock("@/components/settings/routes/AppearanceSettingsRoute", () => ({ default: () => <div data-route-component="appearance" /> }));
vi.mock("@/components/settings/routes/HomeSettingsRoute", () => ({ default: () => <div data-route-component="home" /> }));
vi.mock("@/components/settings/routes/SystemSettingsRoute", () => ({ default: () => <div data-route-component="system" /> }));

import SettingsNotFound from "@/app/settings/not-found";
import SettingsLayout from "@/app/settings/layout";
import SettingsSectionPage from "@/app/settings/[section]/page";
import AppearanceSettingsPage from "@/app/settings/appearance/page";
import FamilySettingsPage from "@/app/settings/family/page";
import HomeSettingsPage from "@/app/settings/home/page";
import MeSettingsPage from "@/app/settings/me/page";
import SafetySettingsPage from "@/app/settings/safety/page";
import SystemSettingsPage from "@/app/settings/system/page";

const mountedRoots: Root[] = [];

function mount(ui: ReactElement) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return { element, root };
}

describe("settings route shell", () => {
  beforeEach(() => {
    mocks.pathname = "/settings/me";
    mocks.view.mockClear();
    mocks.notFound.mockClear();
    mocks.pageShellRenders = 0;
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it.each([
    { Page: MeSettingsPage, section: "me" },
    { Page: FamilySettingsPage, section: "family" },
    { Page: SafetySettingsPage, section: "safety" },
    { Page: AppearanceSettingsPage, section: "appearance" },
    { Page: HomeSettingsPage, section: "home" },
    { Page: SystemSettingsPage, section: "system" },
  ])("renders one isolated route section for $section", ({ Page, section }) => {
    const { element } = mount(<Page />);

    expect(mocks.view).toHaveBeenCalledWith({ section });
    expect(element.querySelector(`[data-route-component="${section}"]`)).toBeTruthy();
    expect(element.querySelectorAll("[data-route-component]")).toHaveLength(1);
  });

  it("keeps the former dynamic route slot as a not-found fallback", () => {
    expect(() => SettingsSectionPage()).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("resets the persistent error boundary when the pathname changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function RouteChild() {
      if (shouldThrow) throw new Error("route render failed");
      return <p>Route content</p>;
    }

    const { element, root } = mount(
      <SettingsLayout>
        <RouteChild />
      </SettingsLayout>,
    );
    expect(element.querySelector("h1")?.textContent).toContain("Settings");
    expect(element.querySelector("section")).toBeTruthy();
    expect(element.querySelector('a[href="/settings"]')).toBeTruthy();

    shouldThrow = false;
    mocks.pathname = "/settings/family";
    act(() => {
      root.render(
        <SettingsLayout>
          <RouteChild />
        </SettingsLayout>,
      );
    });

    expect(element.textContent).toContain("Route content");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not double-wrap the not-found PageShell", () => {
    const { element } = mount(
      <SettingsLayout>
        <SettingsNotFound />
      </SettingsLayout>,
    );

    expect(mocks.pageShellRenders).toBe(1);
    expect(element.querySelectorAll('[data-testid="page-shell"]')).toHaveLength(1);
  });
});
