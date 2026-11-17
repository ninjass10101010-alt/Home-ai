"use client";

import EmptyState from "@/components/ui/EmptyState";
import SoftButton from "@/components/ui/SoftButton";
import { controllableLights, entityFriendlyName, useHACall, type HAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";
import { formatRoomName } from "./RoomCard";

interface LightsGridProps {
  states: HAState[];
  onRefresh?: () => Promise<void>;
}

export default function LightsGrid({ states, onRefresh }: LightsGridProps) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { calling, callService } = useHACall();

  const lights = controllableLights(states);
  const anyOn = lights.some((l) => l.state === "on");

  const toggle = async (entityId: string) => {
    const entityDomain = entityId.split(".")[0] || "light";
    const ok = await callService(entityDomain, "toggle", { entity_id: entityId });
    if (ok) await onRefresh?.();
  };

  const turnAllOff = async () => {
    const byDomain = new Map<string, string[]>();
    for (const item of lights) {
      const dom = item.entity_id.split(".")[0] || "light";
      const ids = byDomain.get(dom) ?? [];
      ids.push(item.entity_id);
      byDomain.set(dom, ids);
    }
    let ok = true;
    for (const [dom, ids] of byDomain.entries()) {
      const res = await callService(dom, "turn_off", { entity_id: ids });
      if (!res) ok = false;
    }
    if (ok) await onRefresh?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">{lights.length} light{lights.length === 1 ? "" : "s"}</p>
        {!readOnly && anyOn && (
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
                disabled={!readOnly && calling}
                onClick={readOnly ? undefined : () => toggle(light.entity_id)}
                className={`flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4 text-left backdrop-blur-xl transition-colors ${
                  readOnly
                    ? "cursor-default"
                    : "tap hover:bg-[var(--color-surface-0)]/45 disabled:pointer-events-none disabled:opacity-50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-primary">{name}</span>
                  {area && <span className="mt-0.5 block truncate text-xs text-text-muted">{area}</span>}
                </span>
                <span
                  className={`inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-semibold ${
                    isOn ? "border-[var(--color-accent-mint)]/25 text-[var(--color-accent-mint)]" : "border-white/10 text-text-secondary"
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
