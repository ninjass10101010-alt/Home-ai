"use client";

import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import EmptyState from "@/components/ui/EmptyState";
import { entitiesByDomain, useHACall, useHAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

export default function HomeClimateWidget({ className }: { className?: string }) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { states, refresh } = useHAState();
  const { calling, callService } = useHACall();

  const climate = entitiesByDomain(states, "climate")[0];

  if (!climate) {
    return (
      <SectionCard title="Home Climate" icon="🌡️" tone="#22d3ee" compact centeredHeader className={className}>
        <EmptyState title="No climate data" description="Connect a thermostat to Home Assistant to see indoor conditions here." icon="🌡️" flat />
      </SectionCard>
    );
  }

  const attrs = climate.attributes ?? {};
  const currentTemp = typeof attrs.current_temperature === "number" ? (attrs.current_temperature as number) : NaN;
  const humidity = typeof attrs.current_humidity === "number" ? (attrs.current_humidity as number) : null;
  const target = typeof attrs.temperature === "number" ? (attrs.temperature as number) : Number.isFinite(currentTemp) ? currentTemp : 21;
  const hvacMode = typeof attrs.hvac_mode === "string" ? (attrs.hvac_mode as string) : climate.state;

  const setTarget = async (temperature: number) => {
    const ok = await callService("climate", "set_temperature", { entity_id: climate.entity_id, temperature });
    if (ok) await refresh();
  };

  return (
    <SectionCard title="Home Climate" icon="🌡️" tone="#22d3ee" compact centeredHeader className={className}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
        <div className="text-4xl font-bold text-text-primary">{Number.isFinite(currentTemp) ? `${Math.round(currentTemp)}°` : "--"}</div>
        <p className="text-xs text-text-secondary">{hvacMode}</p>
        {humidity !== null && <p className="text-[11px] text-text-muted">Humidity {Math.round(humidity)}%</p>}
        <div className="mt-2 flex items-center gap-2">
          {readOnly ? (
            <span className="text-xs font-semibold tabular-nums text-text-secondary">Target {Math.round(target)}°</span>
          ) : (
            <>
              <SoftButton size="sm" variant="secondary" disabled={calling} onClick={() => setTarget(target - 1)} aria-label="Decrease target temperature">
                −
              </SoftButton>
              <span className="text-xs font-semibold tabular-nums text-text-secondary">{Math.round(target)}°</span>
              <SoftButton size="sm" variant="secondary" disabled={calling} onClick={() => setTarget(target + 1)} aria-label="Increase target temperature">
                +
              </SoftButton>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
