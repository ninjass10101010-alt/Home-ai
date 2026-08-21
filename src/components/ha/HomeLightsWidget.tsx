"use client";

import SectionCard from "@/components/patterns/SectionCard";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import ListRow from "@/components/ui/ListRow";
import { entitiesByDomain, entityFriendlyName, useHACall, useHAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

export default function HomeLightsWidget({ className }: { className?: string }) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { states, refresh } = useHAState();
  const { calling, callService } = useHACall();

  const lightEntities = entitiesByDomain(states, "light");
  const domain = lightEntities.length > 0 ? "light" : "switch";
  const lights = lightEntities.length > 0 ? lightEntities : entitiesByDomain(states, "switch");
  const visible = lights.slice(0, 3);
  const anyOn = lights.some((l) => l.state === "on");

  const toggle = async (entityId: string) => {
    const ok = await callService(domain, "toggle", { entity_id: entityId });
    if (ok) await refresh();
  };

  const turnAllOff = async () => {
    const ok = await callService(domain, "turn_off", { entity_id: lights.map((l) => l.entity_id) });
    if (ok) await refresh();
  };

  return (
    <SectionCard
      title="Home Lights"
      icon="💡"
      tone="#f59e0b"
      compact
      centeredHeader
      className={className}
      footer={
        !readOnly && anyOn ? (
          <Chip size="sm" tone="warning" onClick={turnAllOff} disabled={calling}>
            Turn all off
          </Chip>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {lights.length === 0 ? (
          <EmptyState title="No lights found" description="Connect lights to Home Assistant to control them here." icon="💡" flat />
        ) : (
          visible.map((light) => (
            <ListRow
              key={light.entity_id}
              title={entityFriendlyName(light)}
              onClick={readOnly ? undefined : () => toggle(light.entity_id)}
              trailing={
                <Chip size="sm" tone={light.state === "on" ? "success" : "neutral"}>
                  {light.state === "on" ? "On" : "Off"}
                </Chip>
              }
            />
          ))
        )}
      </div>
    </SectionCard>
  );
}
