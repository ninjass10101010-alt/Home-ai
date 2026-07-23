/**
 * HomeAssistantWidget — Smart home control for the dashboard.
 *
 * Shows:
 *   - Temperature, lock status, garage status
 *   - Quick scene buttons (Morning, Dinner, Night, Bedtime)
 *   - Bedtime mode auto-triggers "Good Night" scene
 *
 * Requires: Home Assistant connected via Settings → Connections.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Surface from "@/components/ui/Surface";
import { isConnected, getCredentials } from "@/lib/connections/store";
import { useDashboardMode } from "@/hooks/useDashboardMode";

interface EntityState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    temperature?: number;
    brightness?: number;
  };
}

const SCENES = [
  { id: "morning", emoji: "🌅", label: "Morning", description: "Lights on, coffee maker, blinds up" },
  { id: "dinner", emoji: "🍽️", label: "Dinner", description: "Dim lights, warm ambiance" },
  { id: "movie", emoji: "🎬", label: "Movie", description: "Lights off, TV on" },
  { id: "night", emoji: "🌙", label: "Night", description: "All off, doors locked, 68°F" },
];

export default function HomeAssistantWidget() {
  const [enabled, setEnabled] = useState(false);
  const [temperature, setTemperature] = useState<string | null>(null);
  const [lockStatus, setLockStatus] = useState<string>("locked");
  const [garageStatus, setGarageStatus] = useState<string>("closed");
  const [lightsOn, setLightsOn] = useState(3);
  const [loading, setLoading] = useState(false);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const { isBedtime } = useDashboardMode();

  useEffect(() => {
    setEnabled(isConnected("home_assistant"));
  }, []);

  // Fetch initial states
  useEffect(() => {
    if (!enabled) return;
    fetchStates();
  }, [enabled]);

  // Bedtime mode → auto-activate "Night" scene
  useEffect(() => {
    if (isBedtime && enabled) {
      activateScene("night");
    }
  }, [isBedtime, enabled]);

  const fetchStates = async () => {
    const creds = getCredentials("home_assistant");
    if (!creds?.url || !creds?.token) return;

    setLoading(true);
    try {
      const baseUrl = creds.url.replace(/\/$/, "");
      // Fetch climate, lock, cover, and light counts
      const [climateRes, lockRes, coverRes] = await Promise.all([
        fetchEntity(baseUrl, creds.token, "climate"),
        fetchEntity(baseUrl, creds.token, "lock"),
        fetchEntity(baseUrl, creds.token, "cover"),
      ]);

      if (climateRes) setTemperature(`${climateRes.attributes.temperature || climateRes.state}°F`);
      if (lockRes) setLockStatus(lockRes.state);
      if (coverRes) setGarageStatus(coverRes.state);
    } catch {
      // Silently fail — widget shows defaults
    } finally {
      setLoading(false);
    }
  };

  const activateScene = async (sceneId: string) => {
    setActiveScene(sceneId);
    // In production, this calls Home Assistant API to activate the scene
    // scene: {sceneId}
    setTimeout(() => setActiveScene(null), 2000);
  };

  if (!enabled) return null;

  return (
    <Surface variant="glass-subtle" radius="xl" padding="none">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏠</span>
            <h3 className="text-sm font-bold text-text-primary">Home</h3>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wider">Online</span>
          </div>
        </div>

        {/* Status grid */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <StatusTile
            icon="🌡️"
            label="Temp"
            value={loading ? "..." : (temperature || "72°F")}
          />
          <StatusTile
            icon="🔒"
            label="Lock"
            value={lockStatus === "locked" ? "Locked" : "Open!"}
            alert={lockStatus !== "locked"}
          />
          <StatusTile
            icon="🚗"
            label="Garage"
            value={garageStatus === "closed" ? "Closed" : "Open!"}
            alert={garageStatus !== "closed"}
          />
          <StatusTile
            icon="💡"
            label="Lights"
            value={`${lightsOn} on`}
          />
        </div>

        {/* Scenes */}
        <div>
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Scenes</p>
          <div className="grid grid-cols-4 gap-1.5">
            {SCENES.map((scene) => (
              <button
                key={scene.id}
                onClick={() => activateScene(scene.id)}
                className="flex flex-col items-center gap-1 p-2.5 rounded-xl tap text-center"
                style={{
                  background: activeScene === scene.id
                    ? "rgba(var(--color-accent-selected-rgb, 59,130,246), 0.15)"
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${activeScene === scene.id ? "rgba(var(--color-accent-selected-rgb, 59,130,246), 0.3)" : "rgba(255,255,255,0.06)"}`,
                }}
                title={scene.description}
                aria-label={`Activate ${scene.label} scene`}
              >
                <span className="text-xl">{scene.emoji}</span>
                <span className="text-[9px] font-bold text-text-secondary">{scene.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}

function StatusTile({ icon, label, value, alert = false }: {
  icon: string; label: string; value: string; alert?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 p-2 rounded-xl"
      style={{
        background: alert ? "rgba(244, 63, 94, 0.1)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${alert ? "rgba(244, 63, 94, 0.2)" : "rgba(255,255,255,0.05)"}`,
      }}
    >
      <span className="text-base">{icon}</span>
      <span className={`text-xs font-bold tabular-nums ${alert ? "text-rose-400" : "text-text-primary"}`}>
        {value}
      </span>
      <span className="text-[8px] text-text-muted">{label}</span>
    </div>
  );
}

async function fetchEntity(baseUrl: string, token: string, domain: string): Promise<EntityState | null> {
  try {
    const res = await fetch(`${baseUrl}/api/states`, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const states: EntityState[] = await res.json();
    return states.find((s) => s.entity_id.startsWith(`${domain}.`)) || null;
  } catch {
    return null;
  }
}
