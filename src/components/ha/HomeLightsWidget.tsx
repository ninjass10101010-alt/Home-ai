"use client";

import SectionCard from "@/components/patterns/SectionCard";
import HomeWidgetIcon from "@/components/ui/HomeWidgetIcon";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import ListRow from "@/components/ui/ListRow";
import { controllableLights, entityFriendlyName, useHACall, useHAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

export default function HomeLightsWidget({ className }: { className?: string }) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { states, refresh } = useHAState();
  const { calling, callService } = useHACall();

  const lights = controllableLights(states);
  const visible = lights.slice(0, 3);
  const anyOn = lights.some((l) => l.state === "on");

  const toggle = async (entityId: string) => {
    const entityDomain = entityId.split(".")[0] || "light";
    const ok = await callService(entityDomain, "toggle", { entity_id: entityId });
    if (ok) await refresh();
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
    if (ok) await refresh();
  };

  return (
    <SectionCard
      title="Home Lights"
      icon={<HomeWidgetIcon variant="lights" state={anyOn ? "on" : "default"} size="lg" />}
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
