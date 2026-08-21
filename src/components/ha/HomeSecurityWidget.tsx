"use client";

import Link from "next/link";
import SectionCard from "@/components/patterns/SectionCard";
import Chip from "@/components/ui/Chip";
import SoftButton from "@/components/ui/SoftButton";
import { entitiesByDomain, entityFriendlyName, useHACall, useHAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

const OPEN_SENSOR_CLASSES = new Set(["door", "window", "motion", "smoke", "gas", "moisture"]);

export default function HomeSecurityWidget({ className }: { className?: string }) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { states } = useHAState();
  const { calling, callService } = useHACall();

  const people = entitiesByDomain(states, "person");
  const homeCount = people.filter((p) => p.state === "home").length;

  const openSensors = states.filter(
    (s) =>
      s.entity_id.startsWith("binary_sensor.") &&
      s.state === "on" &&
      typeof s.attributes?.device_class === "string" &&
      OPEN_SENSOR_CLASSES.has(s.attributes.device_class as string)
  );

  const alarm = states.find((s) => s.entity_id.startsWith("alarm_control_panel."));

  const armHome = async () => {
    if (!alarm) return;
    await callService("alarm_control_panel", "alarm_arm_home", { entity_id: alarm.entity_id });
  };

  const disarm = async () => {
    if (!alarm) return;
    await callService("alarm_control_panel", "alarm_disarm", { entity_id: alarm.entity_id });
  };

  return (
    <SectionCard
      title="Home Security"
      icon="🛡️"
      tone="#f43f5e"
      compact
      centeredHeader
      className={className}
      footer={
        <Link href="/ha" className="tap-sm text-xs font-semibold widget-accent-text">
          Open Home controls →
        </Link>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wide text-text-muted">Presence</div>
          {people.length === 0 ? (
            <p className="text-xs text-text-muted">No presence data yet</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {people.map((person) => {
                  const first = entityFriendlyName(person).split(" ")[0];
                  const status = person.state === "home" ? "home" : "away";
                  return (
                    <Chip key={person.entity_id} size="sm" tone="neutral">
                      👤 {first} · {status}
                    </Chip>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-text-secondary">{homeCount} home</p>
            </>
          )}
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wide text-text-muted">Sensors</div>
          {openSensors.length === 0 ? (
            <Chip size="sm" tone="success">Doors &amp; windows closed</Chip>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {openSensors.slice(0, 4).map((sensor) => (
                <Chip key={sensor.entity_id} size="sm" tone="danger">
                  {entityFriendlyName(sensor)}
                </Chip>
              ))}
              {openSensors.length > 4 && <Chip size="sm" tone="danger">+{openSensors.length - 4} more</Chip>}
            </div>
          )}
        </div>
        {alarm && (
          <div className="flex items-center justify-between gap-2">
            <Chip size="sm" tone={alarm.state === "disarmed" ? "success" : "danger"}>{alarm.state}</Chip>
            {!readOnly &&
              (alarm.state === "disarmed" ? (
                <SoftButton size="sm" variant="secondary" loading={calling} onClick={armHome}>
                  Arm home
                </SoftButton>
              ) : alarm.state === "armed_home" || alarm.state === "armed_away" ? (
                <SoftButton size="sm" variant="secondary" loading={calling} onClick={disarm}>
                  Disarm
                </SoftButton>
              ) : null)}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
