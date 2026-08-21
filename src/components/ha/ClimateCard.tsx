"use client";

import EmptyState from "@/components/ui/EmptyState";
import SoftButton from "@/components/ui/SoftButton";
import { entitiesByDomain, entityFriendlyName, useHACall, type HAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

interface ClimateCardProps {
  states: HAState[];
  onRefresh?: () => Promise<void>;
}

const HVAC_MODES = ["heat", "cool", "off"] as const;

export default function ClimateCard({ states, onRefresh }: ClimateCardProps) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { calling, callService } = useHACall();

  const climate = entitiesByDomain(states, "climate")[0];

  if (!climate) {
    return (
      <EmptyState title="No climate data" description="Connect a thermostat to Home Assistant to see indoor conditions here." icon="🌡️" />
    );
  }

  const attrs = climate.attributes ?? {};
  const currentTemp = typeof attrs.current_temperature === "number" ? (attrs.current_temperature as number) : NaN;
  const humidity =
    typeof attrs.current_humidity === "number"
      ? (attrs.current_humidity as number)
      : typeof attrs.humidity === "number"
        ? (attrs.humidity as number)
        : null;
  const target = typeof attrs.temperature === "number" ? (attrs.temperature as number) : Number.isFinite(currentTemp) ? currentTemp : 21;
  const mode = typeof attrs.hvac_mode === "string" ? (attrs.hvac_mode as string) : climate.state;

  const setMode = async (hvacMode: string) => {
    const ok = await callService("climate", "set_hvac_mode", { entity_id: climate.entity_id, hvac_mode: hvacMode });
    if (ok) await onRefresh?.();
  };

  const setTarget = async (temperature: number) => {
    const ok = await callService("climate", "set_temperature", { entity_id: climate.entity_id, temperature });
    if (ok) await onRefresh?.();
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/30 p-5 backdrop-blur-xl">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{entityFriendlyName(climate)}</p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div>
          <div className="text-5xl font-bold text-text-primary">{Number.isFinite(currentTemp) ? `${Math.round(currentTemp)}°` : "--"}</div>
          <p className="mt-1 text-sm text-text-secondary">{mode}</p>
          {humidity !== null && <p className="mt-0.5 text-xs text-text-muted">Humidity {Math.round(humidity)}%</p>}
        </div>
        <div className="flex items-center gap-2 pb-1">
          {readOnly ? (
            <span className="text-sm font-semibold tabular-nums text-text-secondary">Target {Math.round(target)}°</span>
          ) : (
            <>
              <SoftButton size="sm" variant="secondary" disabled={calling} onClick={() => setTarget(target - 1)} aria-label="Decrease target temperature">
                −
              </SoftButton>
              <span className="text-sm font-semibold tabular-nums text-text-secondary">{Math.round(target)}°</span>
              <SoftButton size="sm" variant="secondary" disabled={calling} onClick={() => setTarget(target + 1)} aria-label="Increase target temperature">
                +
              </SoftButton>
            </>
          )}
        </div>
      </div>
      {!readOnly && (
        <div className="mt-4 flex gap-2">
          {HVAC_MODES.map((hvacMode) => (
            <SoftButton
              key={hvacMode}
              size="sm"
              variant={mode === hvacMode ? "primary" : "secondary"}
              disabled={calling}
              onClick={() => setMode(hvacMode)}
              aria-label={`Set mode ${hvacMode}`}
              className="flex-1"
            >
              {hvacMode.charAt(0).toUpperCase() + hvacMode.slice(1)}
            </SoftButton>
          ))}
        </div>
      )}
    </div>
  );
}
