import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { readMuseRow, ensureMuseRow, rotateKey } from "@/lib/muse/store";

// Adult-gated key rotation. Generation uses node:crypto — never the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rotating installs a fresh key AND bumps the identity version, so every live
// bearer token dies instantly (token verification compares the token's version
// against the live row). The plaintext key is returned to this caller exactly
// once and never stored — only its SHA-256 hash is.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  await ensureMuseRow();
  const { key } = await rotateKey();
  const row = await readMuseRow();

  return NextResponse.json({
    ok: true,
    key,
    keyPrefix: row?.keyPrefix ?? key.slice(0, 8),
    version: row?.version ?? 1,
  });
}
