"use client";

import SectionCard from "@/components/patterns/SectionCard";
import Chip from "@/components/ui/Chip";
import SoftButton from "@/components/ui/SoftButton";
import { entitiesByDomain, entityFriendlyName, useHACall, useHAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

const STATE_LABELS: Record<string, string> = {
  cleaning: "Cleaning",
  docked: "Docked",
  paused: "Paused",
  returning: "Returning",
  error: "Error",
  idle: "Idle",
};

function stateTone(state: string): "success" | "warning" | "danger" | "neutral" {
  if (state === "cleaning") return "success";
  if (state === "error") return "danger";
  if (state === "paused" || state === "returning") return "warning";
  return "neutral";
}

export default function VacuumCard({ className }: { className?: string }) {
  const { states } = useHAState();
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { calling, callService } = useHACall();

  const vacuum = entitiesByDomain(states, "vacuum")[0];
  if (!vacuum) return null;

  const attrs = vacuum.attributes ?? {};
  const battery =
    typeof attrs.battery_level === "number"
      ? Math.round(attrs.battery_level as number)
      : typeof attrs.battery === "number"
        ? Math.round(attrs.battery as number)
        : null;
  const label = STATE_LABELS[vacuum.state] ?? vacuum.state;

  const act = async (action: string) => {
    await callService("vacuum", action, { entity_id: vacuum.entity_id });
  };

  return (
    <SectionCard
      title="Robot Vacuum"
      description={entityFriendlyName(vacuum)}
      icon="🤖"
      tone="#10b981"
      compact
      centeredHeader
      className={className}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <Chip size="sm" tone={stateTone(vacuum.state)}>{label}</Chip>
        {battery !== null && (
          <p className="text-xs text-text-secondary">🔋 Battery {battery}%</p>
        )}
        {!readOnly ? (
          <div className="mt-1 flex gap-2">
            <SoftButton
              size="sm"
              disabled={calling}
              onClick={() => act("start")}
              aria-label="Start vacuum cleaning"
            >
              Start
            </SoftButton>
            <SoftButton
              size="sm"
              variant="secondary"
              disabled={calling}
              onClick={() => act("pause")}
              aria-label="Pause vacuum"
            >
              Pause
            </SoftButton>
            <SoftButton
              size="sm"
              variant="secondary"
              disabled={calling}
              onClick={() => act("return_to_base")}
              aria-label="Send vacuum back to dock"
            >
              Dock
            </SoftButton>
          </div>
        ) : (
          <p className="text-xs text-text-muted">Read-only for kids</p>
        )}
      </div>
    </SectionCard>
  );
}
