import fs from "node:fs";
import path from "node:path";
import { withKeyedLock } from "@/lib/keyed-lock";
import { withAdmin } from "@/lib/pb-auth";
import { getHAConfig, type HAConfig } from "./config";
import { haSynthesize } from "./voice";

export interface HASpeaker {
  entityId: string;
  name: string;
  state: string;
  deviceClass: string | null;
  isGroup: boolean;
}

export type SpeakerBroadcastCategory =
  | "chat"
  | "routines"
  | "calendar"
  | "weather"
  | "emergency"
  | "general";

export interface SpeakerBroadcastConfig {
  enabled: boolean;
  entities: string[];
  announceChat: boolean;
  announceRoutines: boolean;
  announceCalendar: boolean;
  announceWeather: boolean;
  volume: number | null;
}

export interface SpeakerAnnounceResult {
  ok: boolean;
  attempted: number;
  delivered: number;
  failed: number;
  errors: string[];
  mediaUrl?: string;
}

export const DEFAULT_SPEAKER_BROADCAST_CONFIG: SpeakerBroadcastConfig = {
  enabled: false,
  entities: [],
  announceChat: true,
  announceRoutines: true,
  announceCalendar: true,
  announceWeather: true,
  volume: null,
};

const SNAPSHOT_COLLECTION = "consuela_data_snapshots";
const SNAPSHOT_KEY = "speaker_broadcast_config";
const CONFIG_LOCK = "speaker-broadcast-config";
const CACHE_TTL_MS = 15_000;
const HA_TIMEOUT_MS = 10_000;

let cachedConfig: { value: SpeakerBroadcastConfig; expiresAt: number } | null = null;

export function resetSpeakerConfigCacheForTests(): void {
  cachedConfig = null;
}

function isPrivateIPv4Host(hostHeader: string): boolean {
  const withoutPort = hostHeader.trim().replace(/:\d+$/, "");
  const m = withoutPort.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return false;
  if (a === 192 && b === 168) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Resolves a LAN HTTP base URL that Google Cast / Home Assistant speakers can
 * fetch directly on the local network (rejecting mDNS `.local`, Tailscale `.ts.net`,
 * or loopback hosts that speakers cannot reach).
 */
export function resolveLanMediaBaseUrl(requestHost?: string | null): string | null {
  const envUrl = process.env.CONSUELA_LAN_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  const trimmed = requestHost?.trim();
  if (!trimmed) return null;
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(trimmed) && isPrivateIPv4Host(trimmed)) {
    return `http://${trimmed}`;
  }
  return null;
}

function normalizeEntities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed.startsWith("media_player.") || trimmed.length <= "media_player.".length) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sanitizeConfig(raw: unknown): SpeakerBroadcastConfig {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawVol = obj.volume;
  const volume =
    typeof rawVol === "number" && Number.isFinite(rawVol)
      ? Math.round(Math.min(1, Math.max(0.1, rawVol)) * 100) / 100
      : null;

  return {
    enabled: obj.enabled === true,
    entities: normalizeEntities(obj.entities),
    announceChat: obj.announceChat !== false,
    announceRoutines: obj.announceRoutines !== false,
    announceCalendar: obj.announceCalendar !== false,
    announceWeather: obj.announceWeather !== false,
    volume,
  };
}

export async function listHASpeakers(config?: HAConfig): Promise<HASpeaker[]> {
  const cfg = config ?? (await getHAConfig());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HA_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.haHost.replace(/\/+$/, "")}/api/states`, {
      headers: { Authorization: `Bearer ${cfg.haToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HA states fetch failed (${res.status})`);
    }
    const states = (await res.json()) as Array<{
      entity_id?: unknown;
      state?: unknown;
      attributes?: Record<string, unknown>;
    }>;

    const speakers: HASpeaker[] = [];
    for (const row of states) {
      if (typeof row?.entity_id !== "string" || !row.entity_id.startsWith("media_player.")) {
        continue;
      }
      const attrs =
        row.attributes && typeof row.attributes === "object" ? row.attributes : {};
      const friendlyName =
        typeof attrs.friendly_name === "string" && attrs.friendly_name.trim()
          ? attrs.friendly_name.trim()
          : row.entity_id.replace(/^media_player\./, "").replace(/_/g, " ");
      const isGroup = Array.isArray(attrs.group_members) || Array.isArray(attrs.entity_id);
      const deviceClass = typeof attrs.device_class === "string" ? attrs.device_class : null;

      speakers.push({
        entityId: row.entity_id,
        name: friendlyName,
        state: typeof row.state === "string" ? row.state : "unknown",
        deviceClass,
        isGroup,
      });
    }

    return speakers.sort((a, b) => {
      if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getSpeakerBroadcastConfig(): Promise<SpeakerBroadcastConfig> {
  if (cachedConfig && Date.now() < cachedConfig.expiresAt) {
    return cachedConfig.value;
  }
  try {
    const loaded = await withAdmin(async (pb) => {
      const rows = (await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${SNAPSHOT_KEY}"`,
      })) as Array<{ data?: unknown }>;
      return rows[0]?.data ? sanitizeConfig(rows[0].data) : { ...DEFAULT_SPEAKER_BROADCAST_CONFIG };
    });
    cachedConfig = { value: loaded, expiresAt: Date.now() + CACHE_TTL_MS };
    return loaded;
  } catch {
    return { ...DEFAULT_SPEAKER_BROADCAST_CONFIG };
  }
}

export async function saveSpeakerBroadcastConfig(
  patch: Partial<SpeakerBroadcastConfig>
): Promise<SpeakerBroadcastConfig> {
  return withKeyedLock(CONFIG_LOCK, () =>
    withAdmin(async (pb) => {
      const rows = (await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${SNAPSHOT_KEY}"`,
      })) as Array<{ id: string; data?: unknown }>;

      const current = rows[0]?.data
        ? sanitizeConfig(rows[0].data)
        : { ...DEFAULT_SPEAKER_BROADCAST_CONFIG };
      const next = sanitizeConfig({ ...current, ...patch });
      const payload = {
        key: SNAPSHOT_KEY,
        data: next,
        updated_at: new Date().toISOString(),
      };

      if (rows[0]) {
        await pb.collection(SNAPSHOT_COLLECTION).update(rows[0].id, payload, { requestKey: null });
      } else {
        await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
      }
      cachedConfig = { value: next, expiresAt: Date.now() + CACHE_TTL_MS };
      return next;
    })
  );
}

export function shouldAnnounceCategory(
  config: SpeakerBroadcastConfig,
  category: SpeakerBroadcastCategory
): boolean {
  if (!config.enabled || config.entities.length === 0) return false;
  switch (category) {
    case "emergency":
      return true;
    case "routines":
      return config.announceRoutines;
    case "calendar":
      return config.announceCalendar;
    case "weather":
      return config.announceWeather;
    case "chat":
    case "general":
    default:
      return config.announceChat;
  }
}

async function callHAService(
  cfg: HAConfig,
  domain: string,
  service: string,
  body: Record<string, unknown>
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HA_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.haHost.replace(/\/+$/, "")}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.haToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`HA ${domain}.${service} failed (${res.status}): ${detail.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function announceToSpeakers(opts: {
  message: string;
  category?: SpeakerBroadcastCategory;
  voiceKey?: string | null;
  audioUrl?: string | null;
  lanBaseUrl?: string | null;
  targetEntities?: string[];
  volume?: number | null;
  force?: boolean;
}): Promise<SpeakerAnnounceResult> {
  const category = opts.category ?? "general";
  const config = await getSpeakerBroadcastConfig();
  const targets = opts.targetEntities?.length
    ? normalizeEntities(opts.targetEntities)
    : config.entities;

  if ((!opts.force && !shouldAnnounceCategory(config, category)) || targets.length === 0) {
    return { ok: false, attempted: 0, delivered: 0, failed: 0, errors: [] };
  }

  let mediaUrl = "";
  let mediaContentType = "music";

  const validVoiceKey =
    typeof opts.voiceKey === "string" && /^[a-z0-9_]+$/.test(opts.voiceKey) ? opts.voiceKey : null;
  if (validVoiceKey && opts.lanBaseUrl) {
    const filePath = path.resolve(process.cwd(), "public/sounds/voices", `${validVoiceKey}.mp3`);
    if (fs.existsSync(filePath)) {
      mediaUrl = `${opts.lanBaseUrl.replace(/\/+$/, "")}/sounds/voices/${validVoiceKey}.mp3`;
      mediaContentType = "audio/mpeg";
    }
  }

  if (!mediaUrl && opts.audioUrl) {
    mediaUrl = opts.audioUrl;
    mediaContentType = "music";
  }

  if (!mediaUrl) {
    const syn = await haSynthesize(opts.message);
    mediaUrl = syn.url;
    mediaContentType = "music";
  }

  const cfg = await getHAConfig();
  const desiredVolume =
    typeof config.volume === "number" && Number.isFinite(config.volume)
      ? Math.min(1, Math.max(0.1, config.volume))
      : typeof opts.volume === "number" && Number.isFinite(opts.volume)
        ? Math.min(1, Math.max(0.1, opts.volume))
        : null;

  const outcomes = await Promise.allSettled(
    targets.map(async (entityId) => {
      if (desiredVolume !== null) {
        await callHAService(cfg, "media_player", "volume_set", {
          entity_id: entityId,
          volume_level: desiredVolume,
        }).catch(() => {});
      }
      await callHAService(cfg, "media_player", "play_media", {
        entity_id: entityId,
        media_content_id: mediaUrl,
        media_content_type: mediaContentType,
        announce: true,
      });
    })
  );

  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];

  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      delivered += 1;
    } else {
      failed += 1;
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      errors.push(`${targets[index]}: ${reason}`);
    }
  });

  return {
    ok: delivered > 0,
    attempted: targets.length,
    delivered,
    failed,
    errors,
    mediaUrl,
  };
}
