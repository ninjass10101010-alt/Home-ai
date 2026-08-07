"use client";

import { useFogConfig } from "@/hooks/useFogConfig";
import SoftButton from "@/components/ui/SoftButton";
import Toggle from "@/components/ui/Toggle";

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
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-secondary">Highlight color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fog.config.highlightColor}
                  onChange={(e) => fog.setHighlightColor(e.target.value)}
                  className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                />
                <span className="truncate text-[11px] text-text-muted">{fog.config.highlightColor}</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-secondary">Lowlight color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fog.config.lowlightColor}
                  onChange={(e) => fog.setLowlightColor(e.target.value)}
                  className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                />
                <span className="truncate text-[11px] text-text-muted">{fog.config.lowlightColor}</span>
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">
              Speed — {fog.config.speed.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={fog.config.speed}
              onChange={(e) => fog.setSpeed(parseFloat(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)]"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-text-muted">
              <span>Still</span>
              <span>Fast</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">
              Blur — {fog.config.blurFactor.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={fog.config.blurFactor}
              onChange={(e) => fog.setBlurFactor(parseFloat(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)]"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-text-muted">
              <span>Sharp</span>
              <span>Soft</span>
            </div>
          </div>
          <SoftButton variant="secondary" onClick={fog.resetConfig} className="w-full">
            Reset to defaults
          </SoftButton>
        </>
      )}
    </div>
  );
}
