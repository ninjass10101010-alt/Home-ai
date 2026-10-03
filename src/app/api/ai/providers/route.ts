import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { listAiProviders, upsertAiProvider, deleteAiProvider, normalizeBaseUrl } from "@/lib/ai/providers";
import { resolveChatTargets, resetAiTargetsCache } from "@/lib/ai/targets";
import { isSameProviderEndpoint, redactUpstreamText, resolveEgressTarget } from "@/lib/ai/provider-egress";

export const dynamic = "force-dynamic";

/** One cheap probe per enabled provider — powers the settings status dot.
 *  Keyed providers 401 an unauthenticated /v1/models, so send the key — but
 *  ONLY to the provider's own stored endpoint: `resolveEgressTarget` pins the
 *  target to the record, and a refusal degrades to "unreachable" rather than
 *  probing somewhere else. The upstream body is read only to be redacted
 *  (providers echo the rejected credential back). */
async function probe(provider: {
  id: string;
  baseUrl: string;
  apiKey?: string | null;
}): Promise<"ok" | "unreachable" | "unknown"> {
  const target = resolveEgressTarget({ providerId: provider.id, providers: [provider] });
  if (!target.ok) return "unreachable";
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (target.key) headers.Authorization = `Bearer ${target.key}`;
    const res = await fetch(`${target.baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return "ok";
    const detail = redactUpstreamText((await res.text().catch(() => "")).slice(0, 2000));
    console.warn(`[ai/providers] probe ${target.baseUrl} -> ${res.status}: ${detail || res.statusText}`);
    return "unreachable";
  } catch (err) {
    console.warn(`[ai/providers] probe ${target.baseUrl} failed: ${redactUpstreamText(err)}`);
    return "unreachable";
  }
}

// One masked provider row. The decrypted apiKey NEVER leaves this function —
// only a 2-char suffix preview (same hint contract as /api/services/config).
function mask(p: {
  id: string;
  displayName: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  order: number;
  keyPreview?: string | null;
  status?: string;
}) {
  return {
    id: p.id,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    models: p.models,
    enabled: p.enabled,
    order: p.order,
    keyPreview: p.keyPreview ?? null,
    status: p.status ?? "unknown",
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  try {
    const providers = await listAiProviders();
    const withStatus = await Promise.all(
      providers.map(async (p) => ({
        ...p,
        keyPreview: p.apiKey ? p.apiKey.slice(-2) : null,
        apiKey: undefined, // decrypted key NEVER leaves the server
        status: p.enabled ? await probe(p) : "unknown",
      }))
    );
    // The brain shown in Settings must be the chain CHAT actually resolves —
    // this file's old PB-table-only derivation lied whenever the live chain
    // was the legacy FALLBACK_* / AI_PROVIDER_* env chain ("No brain
    // configured" while chat answered fine).
    const targets = await resolveChatTargets();
    const pbUrls = new Set(providers.filter((p) => p.enabled).map((p) => p.baseUrl));
    const envTargets = targets.filter((t) => !pbUrls.has(t.url));
    let envProviders: Array<{
      provider: string;
      baseUrl: string;
      models: string[];
      keyPreview: string | null;
      readOnly: true;
    }> | undefined;
    if (envTargets.length > 0) {
      // Group env-chain targets by provider+url so each shows as ONE
      // read-only pseudo-provider ("fallback" group, "env" group).
      const groups = new Map<string, { baseUrl: string; models: string[]; keyPreview: string | null }>();
      for (const t of envTargets) {
        const key = `${t.provider}::${t.url}`;
        const g = groups.get(key) ?? { baseUrl: t.url, models: [], keyPreview: t.key ? t.key.slice(-2) : null };
        if (!g.models.includes(t.model)) g.models.push(t.model);
        groups.set(key, g);
      }
      envProviders = [...groups.entries()].map(([k, g]) => {
        const [provider] = k.split("::");
        return {
          provider,
          baseUrl: g.baseUrl,
          models: g.models,
          keyPreview: g.keyPreview,
          readOnly: true as const,
        };
      });
    }
    return NextResponse.json({
      providers: withStatus.map(({ apiKey: _drop, ...rest }) => mask(rest)),
      active: targets.length ? { provider: targets[0].provider, model: targets[0].model } : null,
      ...(envProviders ? { envProviders } : {}),
    });
  } catch (err) {
    console.error(`[ai/providers] GET failed: ${redactUpstreamText(err)}`);
    return NextResponse.json({ providers: [], active: null, error: "config_store_unreachable" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" && body.id ? body.id : undefined;
    const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
    const apiKey = body.apiKey == null ? "" : String(body.apiKey);

    // KEY BINDING (2026-10-03): a blank key means "keep the stored key", and the
    // stored key belongs to the endpoint already saved on that provider. Moving
    // a saved key onto a caller-chosen host is the same exfiltration primitive
    // as the models route had, one write away — so an endpoint change has to
    // come with that endpoint's own key. A provider with no stored secret may
    // still move freely, and a store read that cannot confirm the provider
    // fails CLOSED (an unreadable list must not become a skipped check).
    if (id && !apiKey.trim()) {
      const existing = (await listAiProviders()).find((p) => p.id === id);
      if (!existing) {
        return NextResponse.json(
          { error: "Couldn't confirm that saved provider — reload the list and try again.", code: "provider_not_found" },
          { status: 409 }
        );
      }
      // `existing.apiKey` is the DECRYPTED key — only its emptiness is inspected,
      // never its value, and it is never logged or returned.
      if (existing.apiKey && !isSameProviderEndpoint(existing.baseUrl, baseUrl)) {
        return NextResponse.json(
          {
            error:
              "The saved key for this provider only works with its own endpoint. Enter the key for the new endpoint to move it, or add a separate provider.",
            code: "endpoint_change_requires_key",
          },
          { status: 409 }
        );
      }
    }

    const provider = await upsertAiProvider({
      id,
      displayName: String(body.displayName ?? ""),
      baseUrl: String(body.baseUrl ?? ""),
      apiKey,
      models: Array.isArray(body.models) ? body.models : [],
      enabled: body.enabled,
      order: typeof body.order === "number" ? body.order : undefined,
    });
    // Drop the 10-min resolver cache so chat serves the new chain immediately.
    resetAiTargetsCache();
    // Same contract as GET's mask(): the decrypted key never leaves the server.
    const { apiKey: _drop, ...safeProvider } = provider;
    return NextResponse.json({ provider: safeProvider });
  } catch (err) {
    const detail = redactUpstreamText(err);
    console.warn(`[ai/providers] PUT failed: ${detail}`);
    return NextResponse.json({ error: detail || "could not save provider", code: "save_failed" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteAiProvider(id);
  if (ok) resetAiTargetsCache();
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
