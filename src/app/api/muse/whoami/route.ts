import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest } from "@/lib/muse/auth";
import { readMuseRow } from "@/lib/muse/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The token was already signature-verified by authorizeMuseRequest; decoding
// its (base64url JSON) payload to recover `exp` is safe and avoids a second
// verifier API just for introspection.
function tokenExpiresAt(token: string | null): string | undefined {
  if (!token) return undefined;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return new Date(payload.exp * 1000).toISOString();
  } catch {
    // ignore — expiresAt is advisory
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const header = request.headers.get("authorization") || "";
  const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? null;
  const row = await readMuseRow();

  return NextResponse.json({
    ok: true,
    enabled: true,
    admin: auth.adm,
    scopes: ["tools"],
    expiresAt: tokenExpiresAt(token),
    lastUsedAt: row?.lastUsedAt ?? null,
  });
}
