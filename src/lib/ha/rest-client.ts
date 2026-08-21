import { getHAConfig, HAConfig } from "./config";

export const HA_WATCH_DOMAINS = [
  "light",
  "switch",
  "climate",
  "binary_sensor",
  "lock",
  "person",
  "scene",
  "alarm_control_panel",
  "sensor",
  "automation",
] as const;

export interface HAFilteredState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated: string;
}

interface HARawState {
  entity_id?: unknown;
  state?: unknown;
  attributes?: unknown;
  last_updated?: unknown;
}

export async function fetchHADeviceStates(
  config?: HAConfig
): Promise<HAFilteredState[]> {
  const cfg = config ?? getHAConfig();
  const res = await fetch(`${cfg.haHost}/api/states`, {
    headers: { Authorization: `Bearer ${cfg.haToken}` },
  });
  if (!res.ok) {
    throw new Error(`HA REST fetch failed: ${res.status}`);
  }
  const raw = (await res.json()) as HARawState[];
  const watched = new Set<string>(HA_WATCH_DOMAINS);
  return raw
    .filter((e) => {
      if (typeof e.entity_id !== "string") return false;
      const prefix = e.entity_id.split(".")[0];
      return watched.has(prefix);
    })
    .map((e) => ({
      entity_id: String(e.entity_id),
      state: String(e.state ?? ""),
      attributes:
        e.attributes && typeof e.attributes === "object"
          ? (e.attributes as Record<string, unknown>)
          : {},
      last_updated: String(e.last_updated ?? ""),
    }));
}
