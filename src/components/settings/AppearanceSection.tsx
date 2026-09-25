"use client";

import { useState } from "react";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Toggle from "@/components/ui/Toggle";
import { useTheme } from "@/hooks/useTheme";
import { warmGlassAccentOptions } from "@/lib/design-tokens";
import { defaultAccentHex, type AccentTarget, type ThemeMode } from "@/lib/theme-config";

const ACCENT_COLOR_ID = "settings-accent-color";

export function normalizeHex(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized.slice(1).split("").map((character) => character + character).join("")}`;
  }
  if (/^#[0-9a-f]{6}$/.test(normalized) || /^#[0-9a-f]{8}$/.test(normalized)) {
    return normalized;
  }
  return null;
}

function rgbaToHex(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(?:\d+(?:\.\d+)?|\.\d+))?\s*\)$/i);
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(value: string) {
  const normalized = normalizeHex(value);
  if (!normalized) return null;
  return [1, 3, 5].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16)).join(",");
}

function targetColor(value: unknown, target: AccentTarget) {
  const parsed = typeof value === "string" && value.startsWith("#") ? normalizeHex(value) : rgbaToHex(value);
  if (parsed) return parsed.slice(0, 7);
  const fallback = defaultAccentHex[target];
  const fallbackHex = fallback.startsWith("#") ? normalizeHex(fallback) : rgbaToHex(fallback);
  return (fallbackHex ?? defaultAccentHex.selected).slice(0, 7);
}

export default function AppearanceSection() {
  const { theme, setMode, setAccentColor, setContrastBoost, setAccentHex } = useTheme();
  const [accentTarget, setAccentTarget] = useState<AccentTarget>("selected");

  const setTargetColor = (target: AccentTarget, value: unknown) => {
    const hex = normalizeHex(value);
    if (!hex) return;
    const color = hex.slice(0, 7);
    const rgb = hexToRgb(color);
    if (!rgb) return;
    if (target === "glow") setAccentHex("glow", `rgba(${rgb},0.28)`);
    else if (target === "border") setAccentHex("border", `rgba(${rgb},0.35)`);
    else setAccentHex(target, color);
  };

  return (
    <div className="space-y-5">
      <SegmentedControl
        aria-label="Display mode"
        value={theme.mode}
        onChange={(value) => setMode(value as ThemeMode)}
        className="w-full min-w-0"
        options={[
          { id: "system", label: "Auto" },
          { id: "light", label: "Day" },
          { id: "dark", label: "Night" },
        ]}
      />

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-text-primary">Accent presets</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {warmGlassAccentOptions.map((accent) => (
            <button
              key={accent.id}
              type="button"
              aria-label={`Use ${accent.label} accent`}
              aria-pressed={theme.accentColor === accent.id}
              title={accent.description}
              onClick={() => {
                setAccentColor(accent.id);
                setAccentHex("selected", accent.hex);
                setAccentHex("glow", accent.glow);
                setAccentHex("button", accent.hex);
                setAccentHex("border", accent.glow);
              }}
              className={`tap-sm min-h-[44px] rounded-2xl border p-3 text-left ${
                theme.accentColor === accent.id
                  ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10"
                  : "border-[var(--color-border)] bg-[var(--color-surface-0)]/30"
              }`}
            >
              <span className="block h-10 rounded-xl" style={{ background: accent.hex }} aria-hidden="true" />
              <span className="mt-2 block text-xs font-semibold text-text-primary">{accent.label}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="border-t-[var(--color-border)] pt-4">
        <h3 className="mb-3 text-sm font-bold text-text-primary">Accent target</h3>
        <SegmentedControl
          compact
          aria-label="Accent target"
          value={accentTarget}
          onChange={(value) => setAccentTarget(value as AccentTarget)}
          className="w-full"
          options={[
            { id: "selected", label: "Selected" },
            { id: "glow", label: "Glow" },
            { id: "button", label: "Button" },
            { id: "border", label: "Border" },
          ]}
        />
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
          <input
            id={ACCENT_COLOR_ID}
            type="color"
            value={targetColor(theme.accentHex[accentTarget], accentTarget)}
            aria-label={`Custom ${accentTarget} accent color`}
            onChange={(event) => setTargetColor(accentTarget, event.target.value)}
            className="h-11 min-h-[44px] w-11 min-w-[44px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1"
          />
          <label htmlFor={ACCENT_COLOR_ID} className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text-primary">Custom accent</span>
            <span className="block text-xs text-text-muted">Live updates the selected target.</span>
          </label>
        </div>
      </div>

      <div className="border-t-[var(--color-border)] pt-4">
        <Toggle
          checked={theme.contrastBoost}
          onCheckedChange={setContrastBoost}
          label="High contrast"
          description="Boosts text and border contrast for easier reading."
        />
      </div>
    </div>
  );
}
