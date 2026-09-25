import { NextRequest, NextResponse } from "next/server";
import { requireLiveSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) return NextResponse.json({ error: live.error }, { status: live.status });
  return NextResponse.json({ member: live.identity });
}
