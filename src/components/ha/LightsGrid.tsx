"use client";

import EmptyState from "@/components/ui/EmptyState";
import SoftButton from "@/components/ui/SoftButton";
import { entitiesByDomain, entityFriendlyName, useHACall, type HAState } from "@/hooks/useHAState";
import { formatRoomName } from "./RoomCard";

interface LightsGridProps {
  states: HAState[];
  onRefresh?: () => Promise<void>;
}

export default function LightsGrid({ states, onRefresh }: LightsGridProps) {
  const { calling, callService } = useHACall();

  const lightEntities = entitiesByDomain(states, "light");
  const domain = lightEntities.length > 0 ? "light" : "switch";
  const lights = lightEntities.length > 0 ? lightEntities : entitiesByDomain(states, "switch");
  const anyOn = lights.some((l) => l.state === "on");

  const toggle = async (entityId: string) => {
    const ok = await callService(domain, "toggle", { entity_id: entityId });
    if (ok) await onRefresh?.();
  };

  const turnAllOff = async () => {
    const ok = await callService(domain, "turn_off", { entity_id: lights.map((l) => l.entity_id) });
    if (ok) await onRefresh?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">{lights.length} light{lights.length === 1 ? "" : "s"}</p>
        {anyOn && (
          <SoftButton size="sm" variant="secondary" disabled={calling} onClick={turnAllOff}>
            Turn all off
          </SoftButton>
        )}
      </div>

      {lights.length === 0 ? (
        <EmptyState title="No lights found" description="Connect lights to Home Assistant to control them here." icon="💡" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lights.map((light) => {
            const area =
              typeof light.attributes?.area_id === "string" && light.attributes.area_id.length > 0
                ? formatRoomName(light.attributes.area_id as string)
                : null;
            const isOn = light.state === "on";
            const name = entityFriendlyName(light);
            return (
              <button
                key={light.entity_id}
                type="button"
                aria-label={`Toggle ${name}`}
                disabled={calling}
                onClick={() => toggle(light.entity_id)}
                className="tap flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4 text-left backdrop-blur-xl transition-colors hover:bg-[var(--color-surface-0)]/45 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-primary">{name}</span>
                  {area && <span className="mt-0.5 block truncate text-xs text-text-muted">{area}</span>}
                </span>
                <span
                  className={`inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-semibold ${
                    isOn ? "border-emerald-300/25 text-emerald-400" : "border-white/10 text-text-secondary"
                  }`}
                >
                  {isOn ? "On" : "Off"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
