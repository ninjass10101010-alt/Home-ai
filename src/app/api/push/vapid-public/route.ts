import { NextResponse } from "next/server";
import { getServiceConfig } from "@/lib/services/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const publicKey = await getServiceConfig("push_notifications", "VAPID_PUBLIC_KEY");
    return NextResponse.json({ ok: true, publicKey: publicKey ?? null });
  } catch {
    return NextResponse.json({ ok: true, publicKey: null });
  }
}
