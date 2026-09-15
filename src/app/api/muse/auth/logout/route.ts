import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MUSE tokens are stateless HMACs with NO server-side session store, so there
// is nothing to delete here — logout is a deliberate no-op and the caller
// simply discards its token. To invalidate every outstanding token at once,
// an operator bumps the identity version via store.revokeTokens() (or
// rotateKey()); the next request then fails verification as `revoked`.
export async function POST() {
  return NextResponse.json({ ok: true });
}
