import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { listAiProviders, upsertAiProvider, deleteAiProvider } from "@/lib/ai/providers";
import { resetAiTargetsCache, resolveChatTargets } from "@/lib/ai/targets";

export const dynamic = "force-dynamic";

/** One cheap probe per enabled provider — powers the settings status dot.
 *  Keyed providers 401 an unauthenticated /v1/models, so send the key. */
async function probe(baseUrl: string, key?: string | null): Promise<"ok" | "unreachable" | "unknown"> {
  try {
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(4000) });
    return res.ok ? "ok" : "unreachable";
  } catch {
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
        status: p.enabled ? await probe(p.baseUrl, p.apiKey) : "unknown",
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
    console.error("[ai/providers] GET failed:", err);
    return NextResponse.json({ providers: [], active: null, error: "config_store_unreachable" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  try {
    const body = await request.json();
    const provider = await upsertAiProvider({
      id: typeof body.id === "string" && body.id ? body.id : undefined,
      displayName: String(body.displayName ?? ""),
      baseUrl: String(body.baseUrl ?? ""),
      // Empty key on update = "leave unchanged" (the CRUD layer's contract).
      apiKey: body.apiKey == null ? "" : String(body.apiKey),
      models: Array.isArray(body.models) ? body.models : [],
      enabled: body.enabled,
      order: typeof body.order === "number" ? body.order : undefined,
    });
    // Drop the 10-min resolver cache so chat serves the new chain immediately.
    resetAiTargetsCache();
    return NextResponse.json({ provider: { ...provider, apiKey: undefined } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
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
