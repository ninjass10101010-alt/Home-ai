"use client";

import { entitiesByDomain, type HAState } from "@/hooks/useHAState";

const OPEN_SENSOR_CLASSES = new Set(["door", "window", "motion"]);

interface RoomCardProps {
  room: string;
  states: HAState[];
  onOpen: () => void;
}

export function formatRoomName(room: string): string {
  const words = room.replace(/[_-]+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return "Other";
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export default function RoomCard({ room, states, onOpen }: RoomCardProps) {
  const toggleables = [...entitiesByDomain(states, "light"), ...entitiesByDomain(states, "switch")];
  const climate = entitiesByDomain(states, "climate")[0];
  const climateTemp =
    climate && typeof climate.attributes?.current_temperature === "number"
      ? Math.round(climate.attributes.current_temperature as number)
      : null;
  const openSensors = states.filter(
    (s) =>
      s.entity_id.startsWith("binary_sensor.") &&
      s.state === "on" &&
      typeof s.attributes?.device_class === "string" &&
      OPEN_SENSOR_CLASSES.has(s.attributes.device_class as string)
  );

  const parts: string[] = [];
  if (toggleables.length > 0) parts.push(`${toggleables.length} light${toggleables.length === 1 ? "" : "s"}`);
  if (climateTemp !== null) parts.push(`${climateTemp}°`);
  if (openSensors.length > 0) parts.push(`${openSensors.length} open`);

  const name = formatRoomName(room);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name} controls`}
      className="tap flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4 text-left backdrop-blur-xl transition-colors hover:bg-[var(--color-surface-0)]/45"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text-primary">{name}</span>
        {parts.length > 0 && <span className="mt-0.5 block truncate text-xs text-text-muted">{parts.join(" · ")}</span>}
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-text-muted">
        <path d="m9 5 7 7-7 7" />
      </svg>
    </button>
  );
}
