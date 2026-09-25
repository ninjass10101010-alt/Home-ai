// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; children?: ReactNode }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}));

import SettingsLauncher from "@/components/settings/SettingsLauncher";
import { settingsSectionsForRole } from "@/lib/settings-sections";

const launcherSource = readFileSync(resolve(__dirname, "../../src/components/settings/SettingsLauncher.tsx"), "utf8");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function mount(ui: ReactElement) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  roots.push(root);
  act(() => root.render(ui));
  return element;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("SettingsLauncher", () => {
  it("renders six parent category links with the wall-first card contract", () => {
    const element = mount(<SettingsLauncher sections={settingsSectionsForRole("parent")} />);
    const launcher = element.querySelector("[data-settings-launcher]")!;
    const links = Array.from(launcher.querySelectorAll("a.widget-card"));

    expect(launcher.tagName).toBe("NAV");
    expect(launcher.querySelectorAll("ul > li")).toHaveLength(6);
    expect(launcher.matches("[data-settings-surface].settings-launcher")).toBe(true);
    expect(launcher.className).toContain("settings-launcher");
    expect(launcher.getAttribute("data-settings-surface")).toBe("true");
    expect(launcher.querySelector("[data-settings-launcher-grid]")!.className).toContain("settings-launcher-grid");

    expect(links).toHaveLength(6);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/settings/me",
      "/settings/family",
      "/settings/safety",
      "/settings/appearance",
      "/settings/home",
      "/settings/system",
    ]);
    expect(launcher.querySelector("[data-settings-launcher-grid]")!.className).toContain("grid-cols-1");
    expect(launcher.querySelector("[data-settings-launcher-grid]")!.className).toContain("sm:grid-cols-2");
    for (const link of links) {
       expect(link.getAttribute("data-prefetch")).toBe("false");
      expect(link.className).toContain("min-h-44");
      expect(link.querySelector("h2")?.textContent).toBeTruthy();
      expect(link.querySelector("[data-settings-icon]")?.getAttribute("aria-hidden")).toBe("true");
      expect(link.querySelector("[data-settings-status]")).toBeTruthy();
      expect(link.querySelector("[data-settings-chevron]")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(links[0].querySelector("h2")?.textContent).toBe("Me");
  });

  it("uses the already filtered non-parent list without re-expanding it", () => {
    const element = mount(<SettingsLauncher sections={settingsSectionsForRole("child")} />);
    const links = Array.from(element.querySelectorAll("a.widget-card"));

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/settings/me",
      "/settings/safety",
      "/settings/appearance",
    ]);
    expect(element.textContent).not.toContain("Family");
    expect(element.textContent).not.toContain("Connections & System");
  });

  it("uses per-section status overrides while retaining descriptions for untouched sections", () => {
    const element = mount(
      <SettingsLauncher
        sections={settingsSectionsForRole("parent")}
        statusOverrides={{ home: "🧱 Wall on", family: "3 people" }}
      />,
    );

    const home = element.querySelector('a[href="/settings/home"]')!;
    const homeStatus = home.querySelector("[data-settings-status]")!;
    expect(homeStatus.textContent).toBe("🧱 Wall on");
    expect(homeStatus.textContent).not.toContain("Layout and wall display");
    expect(element.textContent).toContain("3 people");
    expect(element.textContent).toContain("Integrations, data, and updates");
    expect(element.textContent).toContain("Emergency contacts and alerts");
  });

  it("keeps the launcher server-safe and status overrides string-only", () => {
    expect(launcherSource).toContain('prefetch={false}');
    expect(launcherSource).not.toMatch(/^"use client";/);
    expect(launcherSource).toContain("type SettingsStatusOverrides = Partial<Record<SettingsSectionId, string>>");
  });
});
