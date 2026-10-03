import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { getRecentOutcomes, summarizeOutcomes, type ChatOutcomeRecord } from "@/lib/ai/health";
import { redactUpstreamText } from "@/lib/ai/provider-egress";

export const dynamic = "force-dynamic";

/** `reason` is a free-text failure class assembled upstream — the chat route
 *  builds it from the PROVIDER's error body, and providers routinely echo the
 *  rejected credential back (sometimes masked). This panel is parent-facing, so
 *  the body is redacted on the way out even though the buffer itself is
 *  metadata-only by contract. */
function safeOutcome(record: ChatOutcomeRecord): ChatOutcomeRecord {
  if (typeof record.reason !== "string" || record.reason === "") return record;
  return { ...record, reason: redactUpstreamText(record.reason, 160) };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  const summary = summarizeOutcomes();
  return NextResponse.json({
    outcomes: getRecentOutcomes(20).map(safeOutcome),
    summary: {
      ...summary,
      lastFailure: summary.lastFailure ? safeOutcome(summary.lastFailure) : null,
    },
  });
}
