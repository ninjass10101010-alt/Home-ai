import { NextRequest, NextResponse } from "next/server";
import { requestDeviceGrant } from "@/lib/google/device-auth";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  try {
    await ensureGoogleCollections();
    const grant = await requestDeviceGrant();
    return NextResponse.json({
      ok: true,
      device_code: grant.device_code,
      user_code: grant.user_code,
      verification_url: grant.verification_url,
      expires_in: grant.expires_in,
      interval: grant.interval,
      expires_at: Date.now() + grant.expires_in * 1000,
    });
  } catch (e: any) {
    if (
      e?.message?.includes("GOOGLE_CLIENT_ID") ||
      e?.message?.includes("GOOGLE_CLIENT_SECRET")
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "config",
          error: e.message,
        },
        { status: 503 },
      );
    }
    console.error("[google/device-grant]", e);
    return NextResponse.json(
      { ok: false, code: "unknown", error: e?.message || "Failed to start Google sign-in" },
      { status: 500 },
    );
  }
}
