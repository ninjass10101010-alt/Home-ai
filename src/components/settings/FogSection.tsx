"use client";

import { useFogConfig } from "@/hooks/useFogConfig";
import SoftButton from "@/components/ui/SoftButton";
import Toggle from "@/components/ui/Toggle";

const HIGHLIGHT_COLOR_ID = "fog-highlight-color";
const LOWLIGHT_COLOR_ID = "fog-lowlight-color";
const SPEED_ID = "fog-speed";
const BLUR_ID = "fog-blur";

export default function FogSection() {
  const fog = useFogConfig();

  return (
    <div className="space-y-4">
      <Toggle
        checked={fog.config.enabled}
        onCheckedChange={fog.setEnabled}
        label="Enable animated fog"
        description="Fullscreen 3D fog + drifting particles on the Home screen."
      />
      {fog.config.enabled && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={HIGHLIGHT_COLOR_ID} className="mb-2 block min-h-[44px] text-xs font-semibold text-text-secondary">
                Highlight color
              </label>
              <div className="flex min-w-0 items-center gap-3">
                <input
                  id={HIGHLIGHT_COLOR_ID}
                  type="color"
                  value={fog.config.highlightColor}
                  onChange={(event) => fog.setHighlightColor(event.target.value)}
                  className="h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1"
                />
                <span className="truncate text-xs text-text-muted">{fog.config.highlightColor}</span>
              </div>
            </div>
            <div className="min-w-0">
              <label htmlFor={LOWLIGHT_COLOR_ID} className="mb-2 block min-h-[44px] text-xs font-semibold text-text-secondary">
                Lowlight color
              </label>
              <div className="flex min-w-0 items-center gap-3">
                <input
                  id={LOWLIGHT_COLOR_ID}
                  type="color"
                  value={fog.config.lowlightColor}
                  onChange={(event) => fog.setLowlightColor(event.target.value)}
                  className="h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1"
                />
                <span className="truncate text-xs text-text-muted">{fog.config.lowlightColor}</span>
              </div>
            </div>
          </div>
          <div>
            <label htmlFor={SPEED_ID} className="mb-2 block min-h-[44px] text-xs font-semibold text-text-secondary">
              Speed — {fog.config.speed.toFixed(1)}
            </label>
            <input
              id={SPEED_ID}
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={fog.config.speed}
              onChange={(event) => fog.setSpeed(Number(event.target.value))}
              className="min-h-[44px] w-full min-w-0 cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)]"
            />
            <div className="mt-1 flex justify-between text-xs text-text-muted">
              <span>Still</span>
              <span>Fast</span>
            </div>
          </div>
          <div>
            <label htmlFor={BLUR_ID} className="mb-2 block min-h-[44px] text-xs font-semibold text-text-secondary">
              Blur — {fog.config.blurFactor.toFixed(2)}
            </label>
            <input
              id={BLUR_ID}
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={fog.config.blurFactor}
              onChange={(event) => fog.setBlurFactor(Number(event.target.value))}
              className="min-h-[44px] w-full min-w-0 cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)]"
            />
            <div className="mt-1 flex justify-between text-xs text-text-muted">
              <span>Sharp</span>
              <span>Soft</span>
            </div>
          </div>
          <SoftButton variant="secondary" onClick={fog.resetConfig} className="w-full">
            Reset to defaults
          </SoftButton>
        </div>
      )}
    </div>
  );
}
