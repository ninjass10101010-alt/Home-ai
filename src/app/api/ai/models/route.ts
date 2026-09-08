import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listAiProviders, normalizeBaseUrl } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/** Server-side model listing — the provider API key never reaches the browser.
 *  Body: { providerId?: string, baseUrl: string, apiKey?: string }.
 *  providerId wins for the key (posted keys are used for unsaved drafts and
 *  are never persisted). */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  try {
    const body = await request.json();
    let key: string | null = String(body.apiKey ?? "").trim() || null;
    const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
    if (!baseUrl) return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });

    if (body.providerId && !key) {
      const stored = (await listAiProviders()).find((p) => p.id === body.providerId);
      key = stored?.apiKey ?? null;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `provider returned ${res.status}` }, { status: 400 });
    }
    const data = await res.json();
    // OpenAI `{ data: [...] }` or a bare array both parse; strings coerce.
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const models = raw
      .map((m: any) => (typeof m === "string" ? { id: m } : { id: String(m?.id ?? "") }))
      .filter((m: { id: string }) => m.id);
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
