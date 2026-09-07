import { getServiceConfig } from "@/lib/services/config";

// Dashboard-owned LLM fallback chain (2026-09-07). When the Hermes gateway is
// unreachable, chat falls back to a user-editable OpenAI-compatible provider
// (default: b.ai free tier). Configured via Settings → Services & Keys →
// "AI Fallback Models" — resolution order is the standard PB override →
// .env → null ( getServiceConfig ). The key lives ONLY in PB (encrypted) or
// env — never committed.

export interface FallbackChain {
  baseUrl: string;
  key: string | null;
  models: string[];
}

export interface FallbackTarget {
  url: string;
  key: string | null;
  model: string;
}

export async function resolveFallbackChain(): Promise<FallbackChain | null> {
  // Route appends /v1/chat/completions, so a user-pasted ".../v1" base is
  // normalized to the host root (either paste form works).
  const baseUrl = (await getServiceConfig("ai_fallback", "FALLBACK_API_URL"))
    ?.trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  const key = (await getServiceConfig("ai_fallback", "FALLBACK_API_KEY"))?.trim() || null;
  const modelsRaw = (await getServiceConfig("ai_fallback", "FALLBACK_MODELS"))?.trim() || "";
  const models = modelsRaw.split(",").map((m) => m.trim()).filter(Boolean);
  if (!baseUrl || models.length === 0) return null;
  return { baseUrl, key, models };
}

// 10-minute cache — mirrors the Hermes config cache so a chat burst doesn't
// hit PB for the chain on every request.
const CHAIN_TTL_MS = 10 * 60 * 1000;
let cachedChain: { chain: FallbackChain | null; at: number } | null = null;

/** Ordered OpenAI-compatible targets for the chat loops (first model first). */
export async function buildFallbackTargets(): Promise<FallbackTarget[]> {
  if (cachedChain && Date.now() - cachedChain.at < CHAIN_TTL_MS) {
    return (cachedChain.chain?.models ?? []).map((model) => ({
      url: cachedChain!.chain!.baseUrl,
      key: cachedChain!.chain!.key,
      model,
    }));
  }
  const chain = await resolveFallbackChain();
  cachedChain = { chain, at: Date.now() };
  if (!chain) return [];
  return chain.models.map((model) => ({ url: chain.baseUrl, key: chain.key, model }));
}

/** Test seam — clears the TTL cache. */
export function resetFallbackChainCacheForTests(): void {
  cachedChain = null;
}
