// @vitest-environment jsdom
// Bug 1 (P1) — `useTheme` wrote a THEME-INDEPENDENT raw hex inline on `<html>`.
// An inline style outranks every `:root[data-theme="…"]` rule, so the light
// theme's accent was permanently replaced by the dark theme's value.
//
// The fix moves the accent palette back into the stylesheet: the provider now
// publishes the accent IDENTITY as `data-accent` and lets `globals.css` resolve
// `--color-accent-<id>` per theme. These tests lock that seam down in jsdom
// (which is enough here, because the bug lives entirely in what the provider
// writes — the resulting colours are verified numerically in
// `theme-token-contrast.test.ts`).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { THEME_STORAGE_KEY, type ThemeConfig } from "@/lib/theme-config";
import { warmGlassAccentOptions } from "@/lib/design-tokens";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const preset = (id: string) => warmGlassAccentOptions.find((option) => option.id === id)!;

/** Exactly what AppearanceSection writes when the family picks a preset. */
function presetConfig(id: string, mode: ThemeConfig["mode"]): ThemeConfig {
  const accent = preset(id);
  return {
    mode,
    accentColor: accent.id,
    accentHex: { selected: accent.hex, glow: accent.glow, button: accent.hex, border: accent.glow },
    contrastBoost: false,
    reduceMotion: false,
  };
}

async function mount(config: ThemeConfig) {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config));
  const host = document.createElement("div");
  document.body.appendChild(host);
  let api: ReturnType<typeof useTheme> | null = null;
  function Probe() {
    api = useTheme();
    return null;
  }
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });
  await act(async () => {});
  const html = document.documentElement;
  return {
    api: api!,
    html,
    inline: (name: string) => html.style.getPropertyValue(name),
    unmount: () => act(() => root.unmount()),
  };
}

describe("ThemeProvider publishes the accent, not a raw hex", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-contrast");
    document.documentElement.removeAttribute("style");
    localStorage.clear();
  });

  it("exposes the accent identity as data-accent", async () => {
    const { html, unmount } = await mount(presetConfig("violet", "light"));
    expect(html.getAttribute("data-accent")).toBe("violet");
    unmount();
  });

  it("never inlines a raw hex for a preset accent, so the light theme can win", async () => {
    for (const theme of ["light", "dark"] as const) {
      for (const option of warmGlassAccentOptions) {
        const { html, inline, unmount } = await mount(presetConfig(option.id, theme));
        expect({ theme, accent: option.id, selected: inline("--color-accent-selected") }).toEqual({
          theme,
          accent: option.id,
          selected: "",
        });
        // Every preset target stays on the CSS derivation too — including the
        // rgb triple, which the CSS layer owns per theme.
        expect({ theme, accent: option.id, button: inline("--color-accent-button") }).toEqual({
          theme,
          accent: option.id,
          button: "",
        });
        expect(inline("--color-accent-glow")).toBe("");
        expect(inline("--color-accent-border")).toBe("");
        expect(inline("--color-text-on-accent")).toBe("");
        expect(inline("--color-accent-selected-rgb")).toBe("");
        expect(html.getAttribute("data-accent")).toBe(option.id);
        unmount();
      }
    }
  });

  it("keeps data-accent and data-theme in step when the family flips the mode", async () => {
    const { api, html, unmount } = await mount(presetConfig("mint", "light"));
    expect(html.getAttribute("data-theme")).toBe("light");
    expect(html.getAttribute("data-accent")).toBe("mint");
    await act(async () => api.setMode("dark"));
    expect(html.getAttribute("data-theme")).toBe("dark");
    expect(html.getAttribute("data-accent")).toBe("mint");
    expect(html.style.getPropertyValue("--color-accent-selected")).toBe("");
    unmount();
  });

  it("still honours a hand-picked custom accent, and publishes its rgb triple", async () => {
    const config = presetConfig("violet", "light");
    config.accentHex = { selected: "#ff00aa", glow: "rgba(255,0,170,0.28)", button: "#ff00aa", border: "rgba(255,0,170,0.28)" };
    const { html, inline, unmount } = await mount(config);
    // A custom colour has no per-theme counterpart, so it stays inline — but
    // only the custom targets, and the rgb triple follows it (this is the
    // token PhotoMemoriesWidget / HomeAssistantWidget read).
    expect(inline("--color-accent-selected")).toBe("#ff00aa");
    expect(inline("--color-accent-selected-rgb")).toBe("255, 0, 170");
    expect(inline("--color-accent-button")).toBe("#ff00aa");
    expect(html.getAttribute("data-accent")).toBe("violet");
    unmount();
  });

  it("drops the inline override again once the accent returns to its preset value", async () => {
    const config = presetConfig("coral", "dark");
    config.accentHex = { selected: "#123456", glow: "rgba(18,52,86,0.28)", button: "#123456", border: "rgba(18,52,86,0.28)" };
    const { api, html, inline, unmount } = await mount(config);
    expect(inline("--color-accent-selected")).toBe("#123456");

    await act(async () => {
      api.setAccentColor("coral");
      const accent = preset("coral");
      api.setAccentHex("selected", accent.hex);
      api.setAccentHex("glow", accent.glow);
      api.setAccentHex("button", accent.hex);
      api.setAccentHex("border", accent.glow);
    });
    expect(html.style.getPropertyValue("--color-accent-selected")).toBe("");
    expect(html.style.getPropertyValue("--color-accent-button")).toBe("");
    expect(html.getAttribute("data-accent")).toBe("coral");
    unmount();
  });

  it("reflects the contrast boost on <html> so the token layer can win the cascade", async () => {
    const { api, html, unmount } = await mount(presetConfig("nori", "dark"));
    expect(html.hasAttribute("data-contrast")).toBe(false);
    await act(async () => api.setContrastBoost(true));
    expect(html.getAttribute("data-contrast")).toBe("boost");
    await act(async () => api.setContrastBoost(false));
    expect(html.hasAttribute("data-contrast")).toBe(false);
    unmount();
  });
});