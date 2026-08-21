"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import ListRow from "@/components/ui/ListRow";
import RoomCard from "@/components/ha/RoomCard";
import RoomSheet from "@/components/ha/RoomSheet";
import SecurityPanel from "@/components/ha/SecurityPanel";
import ClimateCard from "@/components/ha/ClimateCard";
import LightsGrid from "@/components/ha/LightsGrid";
import { entitiesByDomain, entityFriendlyName, useHAState, type HAState } from "@/hooks/useHAState";
import { useAuth } from "@/hooks/useAuth";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "security", label: "Security" },
  { id: "climate", label: "Climate" },
  { id: "lights", label: "Lights" },
  { id: "automation", label: "Automation" },
];

// Domains that are not physical room contents — they'd otherwise pile into a
// meaningless "Other" card (people, scenes, whole-house automations).
const NON_ROOM_DOMAINS = new Set(["person", "scene", "automation"]);

export function roomsFor(states: HAState[]): { room: string; states: HAState[] }[] {
  const byRoom = new Map<string, HAState[]>();
  for (const s of states) {
    if (NON_ROOM_DOMAINS.has(s.entity_id.split(".")[0])) continue;
    const area = typeof s.attributes?.area_id === "string" && s.attributes.area_id.length > 0 ? s.attributes.area_id : "Other";
    const list = byRoom.get(area) ?? [];
    list.push(s);
    byRoom.set(area, list);
  }
  return Array.from(byRoom.entries())
    .map(([room, roomStates]) => ({ room, states: roomStates }))
    .sort((a, b) => a.room.localeCompare(b.room));
}

export default function HomeControlsPage() {
  const { currentUser } = useAuth();
  const readOnly = currentUser?.role === "child";
  const { states, loading, error, refresh } = useHAState();
  const [tab, setTab] = useState("overview");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const people = entitiesByDomain(states, "person");
  const rooms = roomsFor(states);
  const automations = entitiesByDomain(states, "automation");

  return (
    <PageShell>
      <div className="px-4 pt-8">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-2xl">🏠</div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-text-primary">Home Controls</h1>
            <p className="text-sm text-text-secondary">Lights, climate, security &amp; automations — live from Home Assistant</p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl options={TABS} value={tab} onChange={setTab} aria-label="Home Assistant tabs" className="flex-1" />
          {readOnly && (
            <Chip size="sm" tone="warning">
              Read-only for kids
            </Chip>
          )}
        </div>

        {loading && states.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-secondary">Connecting to Home Assistant…</p>
        ) : (
          <>
            {tab === "overview" && (
              <div className="space-y-4">
                {error && <Chip tone="warning">Home Assistant offline — showing last known state</Chip>}
                <div className="flex flex-wrap gap-1.5">
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
                <div className="grid gap-3 sm:grid-cols-2">
                  {rooms.map(({ room, states: roomStates }) => (
                    <RoomCard key={room} room={room} states={roomStates} onOpen={() => setSelectedRoom(room)} />
                  ))}
                </div>
              </div>
            )}

            {tab === "security" && <SecurityPanel states={states} onRefresh={refresh} />}

            {tab === "climate" && <ClimateCard states={states} onRefresh={refresh} />}

            {tab === "lights" && <LightsGrid states={states} onRefresh={refresh} />}

            {tab === "automation" && (
              <div className="space-y-2">
                {automations.length === 0 ? (
                  <EmptyState title="No automations" description="Connect automations in Home Assistant to see them here." icon="⚙️" />
                ) : (
                  automations.map((automation) => (
                    <ListRow
                      key={automation.entity_id}
                      title={entityFriendlyName(automation)}
                      subtitle={automation.entity_id}
                      trailing={
                        <Chip size="sm" tone={automation.state === "on" ? "success" : "neutral"}>
                          {automation.state === "on" ? "on" : "off"}
                        </Chip>
                      }
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      <RoomSheet room={selectedRoom} states={states} onClose={() => setSelectedRoom(null)} onRefresh={refresh} />
    </PageShell>
  );
}
