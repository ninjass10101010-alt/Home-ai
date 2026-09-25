import { NextRequest, NextResponse } from "next/server";
import { createDeviceAttempt } from "@/lib/google/device-attempts";
import { requestDeviceGrant } from "@/lib/google/device-auth";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await authorizeAdminRequest(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error ?? "unauthorized" },
      { status: gate.status ?? 401 },
    );
  }
  try {
    await ensureGoogleCollections();
    const grant = await requestDeviceGrant();
    const attemptId = await createDeviceAttempt(grant.device_code);
    return NextResponse.json({
      ok: true,
      attempt_id: attemptId,
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
