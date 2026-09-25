// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const theme = {
    mode: "system",
    accentColor: "nori",
    accentHex: {
      selected: "#3b82f6",
      glow: "rgba(59,130,246,0.28)",
      button: "#2563eb",
      border: "rgba(59,130,246,0.35)",
    },
    contrastBoost: false,
  };
  const fog = {
    enabled: true,
    highlightColor: "#c8a86a",
    lowlightColor: "#4a5a8e",
    speed: 0.5,
    blurFactor: 0.35,
  };
  const themeApi = {
    theme,
    setMode: vi.fn(),
    setAccentColor: vi.fn(),
    setContrastBoost: vi.fn(),
    setAccentHex: vi.fn(),
  };
  const fogApi = {
    config: fog,
    setEnabled: vi.fn(),
    setHighlightColor: vi.fn(),
    setLowlightColor: vi.fn(),
    setSpeed: vi.fn(),
    setBlurFactor: vi.fn(),
    resetConfig: vi.fn(),
  };
  return { theme, fog, themeApi, fogApi };
});

vi.mock("@/hooks/useTheme", () => ({ useTheme: () => mocks.themeApi }));
vi.mock("@/hooks/useFogConfig", () => ({ useFogConfig: () => mocks.fogApi }));

import AppearanceSettingsSection from "@/components/settings/AppearanceSettingsSection";
import { warmGlassAccentOptions } from "@/lib/design-tokens";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sourceFiles = [
  "src/components/settings/AppearanceSettingsSection.tsx",
  "src/components/settings/AppearanceSection.tsx",
  "src/components/settings/FogSection.tsx",
].map((file) => readFileSync(resolve(__dirname, "../..", file), "utf8"));
const borderSources = [
  ["AppearanceSection", sourceFiles[1]],
  ["FogSection", sourceFiles[2]],
] as const;
const forbiddenColorUtilities = [
  /(?:border|bg|text|ring|shadow)-(?:white|black)(?:\/|\b)/i,
  /(?:border|bg|text|ring|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+|\/|\b)/i,
  /(?:border|bg|text|ring|shadow)-\[(?:#|rgba?\(|hsla?\()/i,
] as const;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<AppearanceSettingsSection />));
  return host;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  expect(button, `Button not found: ${text}`).toBeTruthy();
  return button as HTMLButtonElement;
}

function radioByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const radio = Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((candidate) => candidate.textContent?.trim() === text);
  expect(radio, `Radio not found: ${text}`).toBeTruthy();
  return radio as HTMLButtonElement;
}

function directCards(scope: HTMLElement) {
  return Array.from(scope.children).filter((child) => child.classList.contains("widget-card")) as HTMLElement[];
}

const customWriteCases = [
  { target: "Selected", targetId: "selected", input: "#a1b2c3", expected: ["selected", "#a1b2c3"] },
  { target: "Button", targetId: "button", input: "#102030", expected: ["button", "#102030"] },
  { target: "Glow", targetId: "glow", input: "#789abc", expected: ["glow", "rgba(120,154,188,0.28)"] },
  { target: "Border", targetId: "border", input: "#c0ffee", expected: ["border", "rgba(192,255,238,0.35)"] },
] as const;

const targetFallbackCases = [
  { target: "Selected", expected: "#3b82f6" },
  { target: "Button", expected: "#2563eb" },
  { target: "Glow", expected: "#3b82f6" },
  { target: "Border", expected: "#3b82f6" },
] as const;

beforeEach(() => {
  mocks.theme.mode = "system";
  mocks.theme.accentColor = "nori";
  mocks.theme.accentHex.selected = "#3b82f6";
  mocks.theme.accentHex.glow = "rgba(59,130,246,0.28)";
  mocks.theme.accentHex.button = "#2563eb";
  mocks.theme.accentHex.border = "rgba(59,130,246,0.35)";
  mocks.theme.contrastBoost = false;
  mocks.fog.enabled = true;
  mocks.fog.highlightColor = "#c8a86a";
  mocks.fog.lowlightColor = "#4a5a8e";
  mocks.fog.speed = 0.5;
  mocks.fog.blurFactor = 0.35;
  mocks.themeApi.setMode.mockReset();
  mocks.themeApi.setAccentColor.mockReset();
  mocks.themeApi.setContrastBoost.mockReset();
  mocks.themeApi.setAccentHex.mockReset();
  mocks.fogApi.setEnabled.mockReset();
  mocks.fogApi.setHighlightColor.mockReset();
  mocks.fogApi.setLowlightColor.mockReset();
  mocks.fogApi.setSpeed.mockReset();
  mocks.fogApi.setBlurFactor.mockReset();
  mocks.fogApi.resetConfig.mockReset();
  mocks.themeApi.setMode.mockImplementation((value) => { mocks.theme.mode = value; });
  mocks.themeApi.setAccentColor.mockImplementation((value) => { mocks.theme.accentColor = value; });
  mocks.themeApi.setContrastBoost.mockImplementation((value) => { mocks.theme.contrastBoost = value; });
  mocks.themeApi.setAccentHex.mockImplementation((target, value) => { mocks.theme.accentHex[target as keyof typeof mocks.theme.accentHex] = value; });
  mocks.fogApi.setEnabled.mockImplementation((value) => { mocks.fog.enabled = value; });
  mocks.fogApi.setHighlightColor.mockImplementation((value) => { mocks.fog.highlightColor = value; });
  mocks.fogApi.setLowlightColor.mockImplementation((value) => { mocks.fog.lowlightColor = value; });
  mocks.fogApi.setSpeed.mockImplementation((value) => { mocks.fog.speed = value; });
  mocks.fogApi.setBlurFactor.mockImplementation((value) => { mocks.fog.blurFactor = value; });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

describe("AppearanceSettingsSection", () => {
  it("renders two sibling cards with flat shared controls and Home background copy", () => {
    const element = render();
    const section = element.querySelector<HTMLElement>("[data-settings-appearance]")!;
    const cards = directCards(section);

    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("Theme & accent");
    expect(cards[1].textContent).toContain("Home background");
    expect(element.textContent).not.toMatch(/Cloud Background|cloud background/i);
    expect(element.querySelectorAll(".glass-subtle")).toHaveLength(0);
    expect(element.querySelectorAll(".toggle-knob")).toHaveLength(2);
    expect(element.querySelectorAll('[role="radiogroup"]')).toHaveLength(2);
  });

  it("keeps display mode wired to Auto, Day, and Night", () => {
    const element = render();
    act(() => radioByText(element, "Day").click());
    expect(mocks.themeApi.setMode).toHaveBeenCalledWith("light");
    act(() => radioByText(element, "Night").click());
    expect(mocks.themeApi.setMode).toHaveBeenCalledWith("dark");
    act(() => radioByText(element, "Auto").click());
    expect(mocks.themeApi.setMode).toHaveBeenCalledWith("system");
  });

  it.each(warmGlassAccentOptions)("applies the $label preset to all four accent targets", (accent) => {
    const element = render();
    const preset = element.querySelector<HTMLButtonElement>(`button[aria-label="Use ${accent.label} accent"]`);
    expect(preset).toBeTruthy();
    if (!preset) return;
    act(() => preset.click());

    expect(mocks.themeApi.setAccentColor).toHaveBeenCalledTimes(1);
    expect(mocks.themeApi.setAccentColor).toHaveBeenCalledWith(accent.id);
    expect(mocks.themeApi.setAccentHex.mock.calls).toEqual([
      ["selected", accent.hex],
      ["glow", accent.glow],
      ["button", accent.hex],
      ["border", accent.glow],
    ]);
  });

  it("reads a distinct stored value for every custom target", () => {
    mocks.theme.accentHex.selected = "#102030";
    mocks.theme.accentHex.button = "#405060";
    mocks.theme.accentHex.glow = "rgba(17,34,51,0.28)";
    mocks.theme.accentHex.border = "rgba(68,85,102,0.35)";
    const element = render();

    for (const [target, expected] of [
      ["Selected", "#102030"],
      ["Button", "#405060"],
      ["Glow", "#112233"],
      ["Border", "#445566"],
    ] as const) {
      act(() => radioByText(element, target).click());
      expect((element.querySelector(`input[aria-label="Custom ${target.toLowerCase()} accent color"]`) as HTMLInputElement).value).toBe(expected);
    }
  });

  it("uses the six-digit color value from a valid alpha-capable hex", () => {
    mocks.theme.accentHex.selected = "#10203040";
    const element = render();
    const input = element.querySelector<HTMLInputElement>('input[aria-label="Custom selected accent color"]');
    expect(input).toBeTruthy();
    if (input) expect(input.value).toBe("#102030");
  });

  it("accepts only exact RGB, RRGGBB, and RRGGBBAA hex forms", async () => {
    const appearanceModule = await import("@/components/settings/AppearanceSection") as {
      normalizeHex?: (value: unknown) => string | null;
    };
    expect(appearanceModule.normalizeHex?.("#AbC")).toBe("#aabbcc");
    expect(appearanceModule.normalizeHex?.("#A1b2C3")).toBe("#a1b2c3");
    expect(appearanceModule.normalizeHex?.("#A1b2C3d4")).toBe("#a1b2c3d4");
    expect(appearanceModule.normalizeHex?.("#1234567")).toBeNull();
    expect(appearanceModule.normalizeHex?.("#12")).toBeNull();
    expect(appearanceModule.normalizeHex?.("a1b2c3")).toBeNull();
    expect(appearanceModule.normalizeHex?.(" #A1b2C3 ")).toBeNull();
    expect(appearanceModule.normalizeHex?.(null)).toBeNull();
    expect(appearanceModule.normalizeHex?.(42)).toBeNull();
    expect(appearanceModule.normalizeHex?.({})).toBeNull();
    expect(appearanceModule.normalizeHex?.([])).toBeNull();
  });

  it.each(customWriteCases)("writes a custom $target value through only its matching target", ({ target, input, expected }) => {
    const element = render();
    act(() => radioByText(element, target).click());
    const colorInput = element.querySelector<HTMLInputElement>(`input[aria-label="Custom ${target.toLowerCase()} accent color"]`);
    expect(colorInput).toBeTruthy();
    if (!colorInput) return;
    act(() => setInputValue(colorInput, input));
    expect(mocks.themeApi.setAccentHex).toHaveBeenCalledTimes(1);
    expect(mocks.themeApi.setAccentHex).toHaveBeenCalledWith(...expected);
  });

  it.each(targetFallbackCases)("uses the $target default after an invalid seven-digit stored value", ({ target, expected }) => {
    mocks.theme.accentHex.selected = "#1234567";
    mocks.theme.accentHex.button = "#1234567";
    mocks.theme.accentHex.glow = "#1234567";
    mocks.theme.accentHex.border = "#1234567";
    const element = render();
    act(() => radioByText(element, target).click());
    const input = element.querySelector<HTMLInputElement>(`input[aria-label="Custom ${target.toLowerCase()} accent color"]`);
    expect(input).toBeTruthy();
    if (input) expect(input.value).toBe(expected);
  });

  it("uses the shared Toggle for high contrast and preserves its accessible label", () => {
    const element = render();
    const toggle = element.querySelector<HTMLInputElement>('input[aria-label="High contrast"]');
    expect(toggle).toBeTruthy();
    if (!toggle) return;
    act(() => toggle.click());
    expect(mocks.themeApi.setContrastBoost).toHaveBeenCalledWith(true);
  });

  it("wires every enabled Home background control and reset action", () => {
    const element = render();
    const highlight = element.querySelector<HTMLInputElement>("#fog-highlight-color");
    const lowlight = element.querySelector<HTMLInputElement>("#fog-lowlight-color");
    const speed = element.querySelector<HTMLInputElement>("#fog-speed");
    const blur = element.querySelector<HTMLInputElement>("#fog-blur");
    expect(highlight).toBeTruthy();
    expect(lowlight).toBeTruthy();
    expect(speed).toBeTruthy();
    expect(blur).toBeTruthy();
    if (!highlight || !lowlight || !speed || !blur) return;
    expect(element.querySelector('label[for="fog-highlight-color"]')).not.toBeNull();
    expect(element.querySelector('label[for="fog-lowlight-color"]')).not.toBeNull();

    act(() => setInputValue(highlight, "#abcdef"));
    act(() => setInputValue(lowlight, "#fedcba"));
    act(() => setInputValue(speed, "1.2"));
    act(() => setInputValue(blur, "0.8"));
    act(() => buttonByText(element, "Reset to defaults").click());

    expect(mocks.fogApi.setHighlightColor).toHaveBeenCalledWith("#abcdef");
    expect(mocks.fogApi.setLowlightColor).toHaveBeenCalledWith("#fedcba");
    expect(mocks.fogApi.setSpeed).toHaveBeenCalledWith(1.2);
    expect(mocks.fogApi.setBlurFactor).toHaveBeenCalledWith(0.8);
    expect(mocks.fogApi.resetConfig).toHaveBeenCalledTimes(1);
  });

  it("hides background details when disabled without changing the config key owner", () => {
    mocks.fog.enabled = false;
    const element = render();
    const toggle = element.querySelector<HTMLInputElement>('input[aria-label="Enable animated fog"]');
    expect(toggle).toBeTruthy();
    if (!toggle) return;
    expect(toggle.checked).toBe(false);
    expect(element.querySelector("#fog-speed")).toBeNull();
    act(() => toggle.click());
    expect(mocks.fogApi.setEnabled).toHaveBeenCalledWith(true);
  });

  it.each(borderSources)("uses only tokenized color utilities throughout %s", (_name, source) => {
    expect(source).toContain("border-[var(--color-border)]");
    expect(source).not.toContain("border-white/10");
    for (const pattern of forbiddenColorUtilities) expect(source).not.toMatch(pattern);
  });

  it("keeps the focused components free of nested Surface cards, local Toggle copies, raw colors, and tiny text", () => {
    const source = sourceFiles.join("\n");
    expect(source).not.toMatch(/components\/ui\/Surface/);
    expect(source).not.toMatch(/function\s+Toggle\s*\(/);
    expect(source).not.toMatch(/text-\[(10|11)px\]/);
    expect(source).not.toMatch(/lucide-react|Cloud Background|cloud background/i);
    expect(source).not.toMatch(/localStorage|FOG_STORAGE_KEY|THEME_STORAGE_KEY/);
  });
});
