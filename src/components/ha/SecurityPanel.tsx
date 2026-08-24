"use client";

import { useState } from "react";
import Chip from "@/components/ui/Chip";
import SoftButton from "@/components/ui/SoftButton";
import { entitiesByDomain, entityFriendlyName, useAlarmCall, type HAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";
import AlarmPinModal from "./AlarmPinModal";

const OPEN_SENSOR_CLASSES = new Set(["door", "window", "motion"]);

interface SecurityPanelProps {
  states: HAState[];
  onRefresh?: () => Promise<void>;
}

function alarmLabel(state: string): string {
  if (state === "armed_home") return "Armed home";
  if (state === "armed_away") return "Armed away";
  if (state === "armed_night") return "Armed night";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export default function SecurityPanel({ states, onRefresh }: SecurityPanelProps) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { calling, setAlarm } = useAlarmCall();
  const [pendingAction, setPendingAction] = useState<"arm_home" | "disarm" | null>(null);

  const alarm = states.find((s) => s.entity_id.startsWith("alarm_control_panel."));
  const armed = Boolean(alarm && alarm.state !== "disarmed");

  const people = entitiesByDomain(states, "person");
  const homeCount = people.filter((p) => p.state === "home").length;

  const openSensors = states.filter(
    (s) =>
      s.entity_id.startsWith("binary_sensor.") &&
      s.state === "on" &&
      typeof s.attributes?.device_class === "string" &&
      OPEN_SENSOR_CLASSES.has(s.attributes.device_class as string)
  );

  const handlePinSubmit = async (pin: string): Promise<boolean> => {
    if (!alarm || !pendingAction) return false;
    const ok = await setAlarm(pendingAction, alarm.entity_id, pin);
    if (ok) await onRefresh?.();
    return ok;
  };

  return (
    <div className="space-y-4">
      {alarm && (
        <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/30 p-5 backdrop-blur-xl">
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Alarm system</p>
          <p className={`mt-1 text-3xl font-bold ${armed ? "text-rose-400" : "text-emerald-400"}`}>{alarmLabel(alarm.state)}</p>
          <p className="mt-1 text-xs text-text-secondary">{entityFriendlyName(alarm)}</p>
          {!readOnly &&
            (armed ? (
              <SoftButton size="lg" variant="danger" loading={calling} onClick={() => setPendingAction("disarm")} className="mt-4 w-full sm:w-auto">
                Disarm
              </SoftButton>
            ) : (
              <SoftButton size="lg" loading={calling} onClick={() => setPendingAction("arm_home")} className="mt-4 w-full sm:w-auto">
                Arm home
              </SoftButton>
            ))}
        </div>
      )}

      {pendingAction && alarm && !readOnly && (
        <AlarmPinModal
          action={pendingAction}
          onSubmit={handlePinSubmit}
          onClose={() => setPendingAction(null)}
        />
      )}

      <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/30 p-5 backdrop-blur-xl">
        <div className="text-[11px] uppercase tracking-wide text-text-muted">Presence</div>
        {people.length === 0 ? (
          <p className="mt-2 text-xs text-text-muted">No presence data yet</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {people.map((person) => {
                const first = entityFriendlyName(person).split(" ")[0];
                const status = person.state === "home" ? "home" : "away";
                return (
                  <Chip key={person.entity_id} size="sm" tone={person.state === "home" ? "success" : "neutral"}>
                    👤 {first} · {status}
                  </Chip>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-text-secondary">{homeCount} home</p>
          </>
        )}
      </div>

      <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/30 p-5 backdrop-blur-xl">
        <div className="text-[11px] uppercase tracking-wide text-text-muted">Doors &amp; windows</div>
        {openSensors.length === 0 ? (
          <div className="mt-2">
            <Chip size="sm" tone="success">All clear ✓</Chip>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {openSensors.map((sensor) => (
              <Chip key={sensor.entity_id} size="sm" tone="danger">
                {entityFriendlyName(sensor)}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
