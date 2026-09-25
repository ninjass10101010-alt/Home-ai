import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { getRecentOutcomes, summarizeOutcomes } from "@/lib/ai/health";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  return NextResponse.json({
    outcomes: getRecentOutcomes(20),
    summary: summarizeOutcomes(),
  });
}
