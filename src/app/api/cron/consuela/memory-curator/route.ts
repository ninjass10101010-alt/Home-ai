import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runCurator } from "@/lib/memory-curator";

export const dynamic = "force-dynamic";

/**
 * The weekly cleanup. Bearer-gated by CRON_SECRET like every cron route.
 * The deterministic phase runs here; the LLM review phase runs in the parent
 * API (it needs a parent to approve the proposals).
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const run = await runCurator({ trigger: "scheduled" });
  return NextResponse.json({ ok: true, runId: run.runId, summary: run.summary, changes: run.changes.length });
}
