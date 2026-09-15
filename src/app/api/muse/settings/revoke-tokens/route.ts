import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { readMuseRow, ensureMuseRow, revokeTokens } from "@/lib/muse/store";

// Adult-gated token revocation. Tokens are stateless HMACs, so "revoke" bumps
// the identity version: every live token fails verification as `revoked`. The
// key itself is unchanged, so the same key can mint a fresh token immediately.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  await ensureMuseRow();
  await revokeTokens();
  const row = await readMuseRow();

  return NextResponse.json({ ok: true, version: row?.version ?? 1 });
}
