"use client";

import { useState } from "react";
import Surface from "@/components/ui/Surface";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { useTheme } from "@/hooks/useTheme";
import { warmGlassAccentOptions } from "@/lib/design-tokens";
import { defaultAccentHex, type AccentTarget } from "@/lib/theme-config";

function normalizeHex(hex: string) {
  const clean = hex.trim().replace("#", "");
  if (clean.length === 3) return `#${clean.split("").map((c) => c + c).join("").toLowerCase()}`;
  return `#${clean.slice(0, 6).toLowerCase()}`;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex);
  const m = normalized.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return "59,130,246";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

export default function AppearanceSection() {
  const { theme, setMode, setAccentColor, setContrastBoost, setAccentHex } = useTheme();
  const [accentTarget, setAccentTarget] = useState<AccentTarget>("selected");
  const [customHex, setCustomHex] = useState(defaultAccentHex[accentTarget]);

  const setTargetColor = (target: AccentTarget, value: string) => {
    const hex = normalizeHex(value);
    if (target === "glow") setAccentHex("glow", `rgba(${hexToRgb(hex)},0.28)`);
    else if (target === "border") setAccentHex("border", `rgba(${hexToRgb(hex)},0.35)`);
    else setAccentHex(target, hex);
    setCustomHex(hex);
  };

  return (
    <div className="space-y-5">
      <SegmentedControl
        aria-label="Display mode"
        value={theme.mode}
        onChange={(value) => setMode(value as "light" | "dark" | "system")}
        options={[
          { id: "system", label: "Auto" },
          { id: "light", label: "Day" },
          { id: "dark", label: "Night" },
        ]}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {warmGlassAccentOptions.map((accent) => (
          <button
            key={accent.id}
            type="button"
            onClick={() => {
              setAccentColor(accent.id);
              setAccentHex("selected", accent.hex);
              setAccentHex("glow", accent.glow);
              setAccentHex("button", accent.hex);
              setAccentHex("border", accent.glow);
            }}
            className={`rounded-2xl border p-3 text-left transition ${
              theme.accentColor === accent.id
                ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10"
                : "border-white/10 bg-[var(--color-surface-0)]/30"
            }`}
          >
            <div className="h-10 rounded-xl" style={{ background: accent.hex }} />
            <div className="mt-2 text-xs font-semibold text-text-primary">{accent.label}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Surface variant="glass-subtle" radius="xl" padding="sm">
          <h4 className="mb-3 text-sm font-bold text-text-primary">Accent target</h4>
          <SegmentedControl
            aria-label="Accent target"
            value={accentTarget}
            onChange={(value) => {
              setAccentTarget(value as AccentTarget);
              setCustomHex(value === "glow" || value === "border" ? "#3b82f6" : defaultAccentHex[value as AccentTarget]);
            }}
            options={[
              { id: "selected", label: "Selected" },
              { id: "glow", label: "Glow" },
              { id: "button", label: "Button" },
              { id: "border", label: "Border" },
            ]}
          />
          <div className="mt-4 flex items-center gap-3">
            <input
              type="color"
              value={normalizeHex(customHex)}
              onChange={(event) => setTargetColor(accentTarget, event.target.value)}
              className="h-12 w-12 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] p-1"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary">Custom accent</div>
              <div className="text-xs text-text-muted">Live updates the selected target.</div>
            </div>
          </div>
        </Surface>
        <Surface variant="glass-subtle" radius="xl" padding="sm">
          <label className="flex items-center justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text-primary">High contrast</span>
              <span className="block text-xs text-text-muted mt-0.5">Boosts text and border contrast for easier reading.</span>
            </span>
            <Toggle checked={theme.contrastBoost} onCheckedChange={setContrastBoost} />
          </label>
        </Surface>
      </div>
    </div>
  );
}

function Toggle({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} className="sr-only peer" />
      <span className={`relative h-7 w-12 shrink-0 rounded-full border transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-selected)] peer-focus-visible:ring-offset-2 ${checked ? "bg-[var(--color-accent-selected)] border-[var(--color-accent-selected)]" : "bg-[var(--color-surface-3)] border-white/10"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "left-6" : "left-1"}`} />
      </span>
    </label>
  );
}
