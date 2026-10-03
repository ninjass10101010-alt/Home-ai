import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listAiProviders, normalizeBaseUrl } from "@/lib/ai/providers";
import {
  resolveEgressTarget,
  redactUpstreamText,
  type EgressErrorCode,
} from "@/lib/ai/provider-egress";

export const dynamic = "force-dynamic";

// Human sentences — the Settings card shows `error` verbatim. `code` is the
// stable machine-readable half.
const EGRESS_MESSAGES: Record<EgressErrorCode, string> = {
  base_url_required: "Enter the provider's API base URL.",
  invalid_base_url: "That isn't a usable http(s) address — check the base URL.",
  provider_not_found: "That provider is no longer saved — reload the list and try again.",
  provider_endpoint_unusable: "This provider has no usable saved address. Edit it and save a new one.",
  stored_key_endpoint_conflict:
    "The saved key for this provider only works with its own endpoint. Enter the key for the new endpoint, or add it as a separate provider.",
};

/** Server-side model listing — the provider API key never reaches the browser.
 *  Body: { providerId?, baseUrl, apiKey? }.
 *
 *  KEY BINDING: a STORED key is only ever sent to the endpoint its own provider
 *  record defines. `baseUrl` is honoured for a named provider only when it
 *  matches that endpoint (so the client need not echo it at all), and a
 *  different host is reachable ONLY together with the caller's own key. A
 *  posted key is used for unsaved drafts and is never persisted. */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  try {
    const body = await request.json();
    const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
    // The provider list is read ONLY when a stored provider is named, so an
    // unsaved draft never causes a store read (and the plaintext key of any
    // stored provider is only ever decrypted for its own endpoint).
    const target = resolveEgressTarget({
      providerId,
      requestedBaseUrl: normalizeBaseUrl(String(body.baseUrl ?? "")),
      postedApiKey: String(body.apiKey ?? ""),
      providers: providerId ? await listAiProviders() : [],
    });
    if (!target.ok) {
      return NextResponse.json(
        { error: EGRESS_MESSAGES[target.error], code: target.error },
        { status: target.status }
      );
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (target.key) headers.Authorization = `Bearer ${target.key}`;

    const res = await fetch(`${target.baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Providers echo the offending credential back (sometimes masked) — the
      // body is read only to be redacted.
      const detail = redactUpstreamText((await res.text().catch(() => "")).slice(0, 2000));
      console.warn(
        `[ai/models] listing failed via ${target.keySource} key: ${res.status} ${detail || res.statusText}`
      );
      return NextResponse.json(
        {
          error: detail
            ? `Provider returned ${res.status} — ${detail}`
            : `provider returned ${res.status}`,
          code: "provider_error",
          status: res.status,
        },
        { status: 400 }
      );
    }
    const data = await res.json();
    // OpenAI `{ data: [...] }` or a bare array both parse; strings coerce.
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const models = raw
      .map((m: any) => (typeof m === "string" ? { id: m } : { id: String(m?.id ?? "") }))
      .filter((m: { id: string }) => m.id);
    return NextResponse.json({ models });
  } catch (err) {
    const detail = redactUpstreamText(err);
    console.warn(`[ai/models] listing threw: ${detail}`);
    return NextResponse.json({ error: detail || "could not list models", code: "listing_failed" }, { status: 400 });
  }
}
