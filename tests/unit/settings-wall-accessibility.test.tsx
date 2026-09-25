// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const authState = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

const dbState = vi.hoisted(() => ({ refreshCaches: vi.fn(), patchMemberLocal: vi.fn() }));
vi.mock("@/db", () => ({ db: dbState }));

import Modal from "@/components/ui/Modal";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import PageHeader from "@/components/patterns/PageHeader";
import ProfileSheet from "@/components/profile/ProfileSheet";
import KidProfileSheet from "@/components/modes/kid/KidProfileSheet";
import MemberPickerModal from "@/components/auth/MemberPickerModal";

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
const layoutSource = readFileSync(resolve(__dirname, "../../src/app/layout.tsx"), "utf8");
const launcherSource = readFileSync(resolve(__dirname, "../../src/components/settings/SettingsLauncher.tsx"), "utf8");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

let root: Root | null = null;
let element: HTMLElement | null = null;

function render(ui: ReactElement) {
  if (!root) {
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
  }
  act(() => root!.render(ui));
  return element!;
}

beforeEach(() => {
  authState.logout.mockReset();
  dbState.refreshCaches.mockReset();
  dbState.patchMemberLocal.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  root = null;
  element = null;
  document.body.innerHTML = "";
});

describe("settings wall accessibility", () => {
  it("uses a same-element launcher selector and a responsive wall height", () => {
    const heightRule = css.match(/html\[data-wall="true"\]\s+\[data-settings-surface\]\.settings-launcher\s*\{[^}]*\}/)?.[0] ?? "";
    expect(heightRule).toContain("min-height: clamp(18rem, 40vw, 27.5rem)");
    expect(heightRule).not.toContain("settings-dialog");
    expect(heightRule).not.toContain("settings-launcher-card");

    const launcher = document.createElement("nav");
    launcher.className = "settings-launcher";
    launcher.dataset.settingsSurface = "true";
    expect(launcher.matches("[data-settings-surface].settings-launcher")).toBe(true);

    const surface = document.createElement("div");
    surface.dataset.settingsSurface = "true";
    surface.innerHTML = [
      '<button id="button"></button>',
      '<a id="link" href="/settings/me"></a>',
      '<span id="role-button" role="button"></span>',
      '<span id="role-radio" role="radio"></span>',
      '<input id="visible-input" />',
      '<select id="select"><option>One</option></select>',
      '<textarea id="textarea"></textarea>',
      '<label id="toggle-label"><input class="sr-only" type="checkbox" /><span>Toggle</span></label>',
      '<label id="nested-label"><span><input class="sr-only" type="checkbox" /></span></label>',
      '<input id="hidden-input" class="sr-only" type="checkbox" />',
    ].join("");
    const visibleControls = Array.from(surface.querySelectorAll(
      'button, a, [role="button"], [role="radio"], input:not(.sr-only), select, textarea, label:has(> input.sr-only)',
    ));
    expect(visibleControls.map((control) => control.id)).toEqual([
      "button",
      "link",
      "role-button",
      "role-radio",
      "visible-input",
      "select",
      "textarea",
      "toggle-label",
    ]);
    expect(visibleControls).not.toContain(surface.querySelector("#hidden-input"));
  });

  it("scopes wall controls to visible interactive targets with width and Toggle labels", () => {
    const wallStart = css.indexOf('html[data-wall="true"] [data-settings-surface].settings-launcher');
    expect(wallStart).toBeGreaterThanOrEqual(0);
    const wallSettingsCss = css.slice(wallStart);
    expect(wallSettingsCss).toContain('input:not(.sr-only)');
    expect(wallSettingsCss).toContain('[role="button"]');
    expect(wallSettingsCss).toContain('[role="radio"]');
    expect(wallSettingsCss).toContain("label:has(> input.sr-only)");
    expect(wallSettingsCss).not.toContain("label:has(input.sr-only)");
    expect(wallSettingsCss).toMatch(/html\[data-wall="true"\][^{]*\.settings-wall-target[^{]*\{[^{}]*display:\s*inline-flex[^{}]*align-items:\s*center/);
    expect(wallSettingsCss).toMatch(/html\[data-wall="true"\][^{]*\.settings-wall-target[^{]*\{[^{}]*min-height:\s*64px[^{}]*min-width:\s*64px/);
    expect(wallSettingsCss).toMatch(/min-height:\s*64px/);
    expect(wallSettingsCss).toMatch(/min-width:\s*64px/);
    expect(wallSettingsCss).not.toMatch(/\[data-settings-surface\][^{}]*\.settings-dialog[^{}]*min-height:\s*clamp/);
    expect(wallSettingsCss).not.toMatch(/\[data-settings-surface\][^{}]*\.settings-launcher-card[^{}]*min-height:\s*clamp/);
  });

  it("does not override widget-card or existing flex-link display in the wall scope", () => {
    const wallStart = css.indexOf('html[data-wall="true"] [data-settings-surface].settings-launcher');
    expect(wallStart).toBeGreaterThanOrEqual(0);
    const wallSettingsCss = css.slice(wallStart);
    expect(wallSettingsCss.match(/display:\s*inline-flex/g) ?? []).toHaveLength(1);
    expect(wallSettingsCss.match(/align-items:\s*center/g) ?? []).toHaveLength(1);
    expect(wallSettingsCss).toMatch(/html\[data-wall="true"\]\s+\.settings-wall-target[^{]*\{[^{}]*display:\s*inline-flex[^{}]*align-items:\s*center/);

    const surface = document.createElement("div");
    surface.dataset.settingsSurface = "true";
    const launcherCard = document.createElement("a");
    launcherCard.className = "widget-card";
    const flexLink = document.createElement("a");
    flexLink.className = "flex";
    surface.append(launcherCard, flexLink);

    expect(launcherCard.matches("a.widget-card")).toBe(true);
    expect(flexLink.matches("a.flex")).toBe(true);
    expect(launcherCard.classList.contains("settings-wall-target")).toBe(false);
    expect(flexLink.classList.contains("settings-wall-target")).toBe(false);
    expect(launcherCard.getAttribute("style")).toBeNull();
    expect(flexLink.getAttribute("style")).toBeNull();
  });

  it("keeps the launcher server-safe and string-only", () => {
    expect(launcherSource).not.toMatch(/^"use client";/);
    expect(launcherSource).toContain("Partial<Record<SettingsSectionId, string>>");
  });

  it("keeps the shared Modal default unchanged and applies an opt-in panel class", () => {
    render(
      <Modal open onClose={() => {}} title="Default panel">
        <p>Default body</p>
      </Modal>,
    );
    const defaultPanel = document.body.querySelector('[role="dialog"]')!;
    const defaultClass = defaultPanel.className;

    render(
      <Modal open onClose={() => {}} title="Settings panel" panelClassName="settings-dialog">
        <p>Settings body</p>
      </Modal>,
    );
    const settingsPanel = document.body.querySelector('[role="dialog"]')!;

    expect(defaultClass).not.toContain("settings-dialog");
    expect(settingsPanel.className).toContain("settings-dialog");
    expect(settingsPanel.className).toContain("material-thick");
  });

  it("marks the settings confirmation primitive with the wall dialog seam", () => {
    render(
      <SettingsConfirmDialog
        open
        title="Reset setting?"
        confirmLabel="Reset"
        busy={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(document.body.querySelector('[role="dialog"]')!.className).toContain("settings-dialog");
  });

  it("lets profile and member dialogs opt into the settings panel seam", () => {
    render(
      <ProfileSheet
        open
        onClose={() => {}}
        member={{ id: 1, name: "Alex", role: "parent", emoji: "😊", color: "green", avatarSize: "md", glow: false }}
        panelClassName="settings-dialog"
      />,
    );
    expect(document.body.querySelector('[role="dialog"]')!.className).toContain("settings-dialog");
    const fullSettingsLink = document.body.querySelector('a[href="/settings"]')!;
    expect(fullSettingsLink.className).toContain("settings-wall-target");

    render(
      <KidProfileSheet
        open
        onClose={() => {}}
        member={{ name: "Aurora", color: "violet", emoji: "🌈" }}
        panelClassName="settings-dialog"
      />,
    );
    expect(document.body.querySelector('[role="dialog"]')!.className).toContain("settings-dialog");

    render(
      <MemberPickerModal
        open
        members={[{ name: "Aurora", emoji: "🌈" }]}
        onSelect={() => {}}
        onClose={() => {}}
        panelClassName="settings-dialog"
      />,
    );
    expect(document.body.querySelector('[role="dialog"]')!.className).toContain("settings-dialog");
  });

  it("keeps the shared member picker description backward compatible", () => {
    render(
      <MemberPickerModal
        open
        members={[{ name: "Aurora", emoji: "🌈" }]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      "Pick your face — little kids sign right in. Others enter their PIN.",
    );
  });

  it("keeps a real 64px back link for focused settings", () => {
    const element = render(
      <PageHeader title="Appearance" backHref="/settings" backLabel="Back to Settings" />,
    );
    const back = element.querySelector('a[href="/settings"]')!;

    expect(back).toBeTruthy();
    expect(back.getAttribute("aria-label")).toBe("Back to Settings");
    expect(back.className).toContain("min-h-16");
  });

  it("allows browser zoom by removing the root maximum scale", () => {
    expect(layoutSource).not.toMatch(/maximumScale\s*:\s*1/);
  });

  it("keeps wall sizing limited to the launcher and scoped controls", () => {
    expect(css).toMatch(/html\[data-wall="true"\]\s+\[data-settings-surface\]\.settings-launcher[^{]*\{[^{}]*min-height:\s*clamp/);
    expect(css).toContain('html[data-wall="true"] [data-settings-surface] :is(');
    expect(css).toContain('html[data-wall="true"] .settings-dialog :is(');
    expect(css).toMatch(/min-height:\s*64px/);
    expect(css).toMatch(/min-width:\s*64px/);
  });
});
