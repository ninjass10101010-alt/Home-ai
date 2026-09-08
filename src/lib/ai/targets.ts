// Dashboard-owned LLM chain resolver (2026-09-07). The first target is THE
// brain; every later target is a fallback tried in order. Resolution:
//   1. consuela_ai_providers (enabled, by order — models in order)
//   2. legacy FALLBACK_* rows in consuela_service_config, then env FALLBACK_*
//      (kept so the current config survives the cutover with zero migration —
//      getServiceConfig is registry-whitelisted and Task 6 removes those
//      pairs, so the legacy read goes straight to PB here)
//   3. AI_PROVIDER_* env (fresh installs)
// 10-minute TTL cache — mirrors the old Hermes config cache so a chat burst
// hits PB once.

import { withAdmin } from "@/lib/pb-auth";
import { decryptSecret } from "@/lib/secret-box";
import { listAiProviders } from "@/lib/ai/providers";

export interface AiTarget {
  url: string;
  key: string | null;
  model: string;
  provider: string;
  fallback: boolean;
}

const CHAIN_TTL_MS = 10 * 60 * 1000;
// An EMPTY result isn't a stable config — it's usually a PB blip. Don't pin
// "no brain" for 10 minutes or a just-configured provider stays invisible.
const EMPTY_TTL_MS = 30_000;
let cached: { targets: AiTarget[]; at: number } | null = null;

/** Production cache invalidation — call after a provider is saved/deleted so
 *  chat picks the new chain up immediately (distinct from the test seam). */
export function resetAiTargetsCache(): void {
  cached = null;
}

export function resetAiTargetsForTests(): void {
  cached = null;
}

function splitModels(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/** Legacy bootstrap — reads the retired ai_fallback service-config rows
 *  directly (the pair left the Settings registry; getServiceConfig would
 *  reject it). Falls back to env, mirroring the old resolver contract. */
async function readLegacyFallback(): Promise<{ url: string | null; key: string | null; models: string[] }> {
  let url: string | null = null;
  let key: string | null = null;
  let modelsRaw: string | null = null;
  try {
    const rows = (await withAdmin(async (pb) =>
      pb.collection("consuela_service_config").getFullList({
        requestKey: null,
        filter: 'service = "ai_fallback"',
      })
    )) as any[];
    for (const row of rows) {
      if (row.key === "FALLBACK_API_URL") url = row.value ?? null;
      if (row.key === "FALLBACK_MODELS") modelsRaw = row.value ?? null;
      if (row.key === "FALLBACK_API_KEY") {
        const plain = row.value ? decryptSecret(row.value) : null;
        key = plain ?? null;
      }
    }
  } catch (err) {
    console.warn("[ai/targets] legacy fallback read failed:", (err as Error).message);
  }
  return {
    url: url || process.env.FALLBACK_API_URL || null,
    key: key ?? process.env.FALLBACK_API_KEY ?? null,
    models: splitModels(modelsRaw || process.env.FALLBACK_MODELS),
  };
}

async function resolveUncached(): Promise<AiTarget[]> {
  const providers = await listAiProviders();
  const enabled = providers.filter((p) => p.enabled && p.models.length > 0);
  if (enabled.length > 0) {
    const targets: AiTarget[] = [];
    for (const p of enabled) {
      for (const model of p.models) {
        targets.push({
          url: p.baseUrl,
          key: p.apiKey,
          model,
          provider: p.displayName,
          fallback: targets.length > 0,
        });
      }
    }
    return targets;
  }

  const legacy = await readLegacyFallback();
  if (legacy.url && legacy.models.length > 0) {
    const base = legacy.url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    return legacy.models.map((model, i) => ({
      url: base,
      key: legacy.key,
      model,
      provider: "fallback",
      fallback: i > 0,
    }));
  }

  const envUrl = process.env.AI_PROVIDER_URL?.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  const envModels = splitModels(process.env.AI_PROVIDER_MODELS);
  if (envUrl && envModels.length > 0) {
    return envModels.map((model, i) => ({
      url: envUrl,
      key: process.env.AI_PROVIDER_KEY ?? null,
      model,
      provider: "env",
      fallback: i > 0,
    }));
  }

  return [];
}

export async function resolveChatTargets(): Promise<AiTarget[]> {
  if (cached && Date.now() - cached.at < (cached.targets.length === 0 ? EMPTY_TTL_MS : CHAIN_TTL_MS)) {
    return cached.targets;
  }
  const targets = await resolveUncached();
  cached = { targets, at: Date.now() };
  return targets;
}
