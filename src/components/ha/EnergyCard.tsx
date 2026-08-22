"use client";

import SectionCard from "@/components/patterns/SectionCard";
import { useHAState, type HAState } from "@/hooks/useHAState";

function numericState(e: HAState): number | null {
  const n = Number(e.state);
  return Number.isFinite(n) ? n : null;
}

/** Live energy snapshot: biggest current power draw (W) + summed energy
 * sensors (kWh) when present. Graceful empty state until the family adds a
 * smart plug or clamp. Read-only by nature. */
export default function EnergyCard({ className }: { className?: string }) {
  const { states } = useHAState();

  const powerSensors = states.filter(
    (s) =>
      s.entity_id.startsWith("sensor.") &&
      s.attributes?.device_class === "power" &&
      numericState(s) !== null
  );
  const energySensors = states.filter(
    (s) =>
      s.entity_id.startsWith("sensor.") &&
      s.attributes?.device_class === "energy" &&
      numericState(s) !== null
  );

  if (powerSensors.length === 0 && energySensors.length === 0) {
    return (
      <SectionCard title="Energy" icon="⚡" tone="#22d3ee" compact centeredHeader className={className}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm text-text-secondary">Add a smart plug to see live energy ⚡</p>
          <p className="text-xs text-text-muted">Power and usage sensors from Home Assistant show up here.</p>
        </div>
      </SectionCard>
    );
  }

  const biggest = powerSensors
    .map((s) => ({ sensor: s, watts: numericState(s)! }))
    .sort((a, b) => b.watts - a.watts)[0];
  const totalKwh = energySensors.reduce((sum, s) => sum + numericState(s)!, 0);

  return (
    <SectionCard title="Energy" icon="⚡" tone="#22d3ee" compact centeredHeader className={className}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
        {biggest ? (
          <>
            <div className="text-4xl font-bold text-text-primary">
              {Math.round(biggest.watts).toLocaleString()}<span className="ml-1">W</span>
            </div>
            <p className="text-xs text-text-secondary">
              right now · {typeof biggest.sensor.attributes?.friendly_name === "string" ? biggest.sensor.attributes.friendly_name : biggest.sensor.entity_id}
              {powerSensors.length > 1 ? ` (+${powerSensors.length - 1} more)` : ""}
            </p>
          </>
        ) : null}
        {totalKwh > 0 && (
          <p className="text-xs text-text-muted">{totalKwh.toFixed(1)} kWh tracked</p>
        )}
      </div>
    </SectionCard>
  );
}
