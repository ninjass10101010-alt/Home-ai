import { NextResponse } from "next/server";
import { revokeGoogleToken } from "@/lib/google/device-auth";
import { getStoredTokens, revokeTokens } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const tokens = await getStoredTokens();
    if (tokens && !tokens.revoked_at) {
      await revokeGoogleToken(tokens.access_token).catch(() => false);
      if (tokens.refresh_token) {
        await revokeGoogleToken(tokens.refresh_token).catch(() => false);
      }
    }
    await revokeTokens();
    return NextResponse.json({ ok: true, disconnected: true });
  } catch (e: any) {
    console.error("[google/device-revoke]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Disconnect failed" },
      { status: 500 },
    );
  }
}
