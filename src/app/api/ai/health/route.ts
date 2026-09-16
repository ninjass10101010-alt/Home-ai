import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { getRecentOutcomes, summarizeOutcomes } from "@/lib/ai/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/health — recent chat-request outcomes for the AI Models card.
 * Session-gated like GET /api/ai/providers (a signed-in child sees metadata
 * only — never message text, same contract as the providers keyPreview).
 */
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    outcomes: getRecentOutcomes(20),
    summary: summarizeOutcomes(),
  });
}
