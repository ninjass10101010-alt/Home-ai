"use client";

import Modal from "@/components/ui/Modal";
import Chip from "@/components/ui/Chip";
import ListRow from "@/components/ui/ListRow";
import SoftButton from "@/components/ui/SoftButton";
import { entitiesByDomain, entityFriendlyName, useHACall, type HAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";
import { formatRoomName } from "./RoomCard";

const OPEN_SENSOR_CLASSES = new Set(["door", "window", "motion"]);

interface RoomSheetProps {
  room: string | null;
  states: HAState[];
  onClose: () => void;
  onRefresh?: () => Promise<void>;
}

export default function RoomSheet({ room, states, onClose, onRefresh }: RoomSheetProps) {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { calling, callService } = useHACall();

  if (!room) return null;

  const roomStates = states.filter((s) => {
    const area = typeof s.attributes?.area_id === "string" && s.attributes.area_id.length > 0 ? s.attributes.area_id : "Other";
    return area === room;
  });

  const toggleables = [...entitiesByDomain(roomStates, "light"), ...entitiesByDomain(roomStates, "switch")];
  const climate = entitiesByDomain(roomStates, "climate")[0];
  const openSensors = roomStates.filter(
    (s) =>
      s.entity_id.startsWith("binary_sensor.") &&
      s.state === "on" &&
      typeof s.attributes?.device_class === "string" &&
      OPEN_SENSOR_CLASSES.has(s.attributes.device_class as string)
  );

  const attrs = climate?.attributes ?? {};
  const target = typeof attrs.temperature === "number" ? (attrs.temperature as number) : 21;

  const toggle = async (entityId: string) => {
    const domain = entityId.split(".")[0];
    const ok = await callService(domain, "toggle", { entity_id: entityId });
    if (ok) await onRefresh?.();
  };

  const setTarget = async (temperature: number) => {
    if (!climate) return;
    const ok = await callService("climate", "set_temperature", { entity_id: climate.entity_id, temperature });
    if (ok) await onRefresh?.();
  };

  const name = formatRoomName(room);

  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      description="Room controls"
      footer={<SoftButton variant="secondary" onClick={onClose} className="flex-1">Close</SoftButton>}
    >
      <div className="space-y-4">
        {toggleables.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">Lights</div>
            {toggleables.map((entity) => (
              <ListRow
                key={entity.entity_id}
                title={entityFriendlyName(entity)}
                onClick={readOnly ? undefined : () => toggle(entity.entity_id)}
                aria-label={`Toggle ${entityFriendlyName(entity)}`}
                trailing={
                  <Chip size="sm" tone={entity.state === "on" ? "success" : "neutral"}>
                    {entity.state === "on" ? "On" : "Off"}
                  </Chip>
                }
              />
            ))}
          </div>
        )}

        {climate && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">Climate</div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-3">
              <span className="text-sm font-semibold text-text-primary">
                {typeof attrs.current_temperature === "number" ? `${Math.round(attrs.current_temperature as number)}°` : "--"}
                <span className="ml-2 text-xs font-medium text-text-secondary">{String(attrs.hvac_mode ?? climate.state)}</span>
              </span>
              <span className="flex items-center gap-2">
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
              </span>
            </div>
          </div>
        )}

        {openSensors.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">Open sensors</div>
            <div className="flex flex-wrap gap-1.5">
              {openSensors.map((sensor) => (
                <Chip key={sensor.entity_id} size="sm" tone="danger">
                  {entityFriendlyName(sensor)}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
