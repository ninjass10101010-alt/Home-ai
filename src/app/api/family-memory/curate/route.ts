import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listRuns, runCurator, undoRun } from "@/lib/memory-curator";

export const dynamic = "force-dynamic";

/** The memory console's API: what changed, run a cleanup, undo a cleanup. */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const runs = await listRuns();
  return NextResponse.json({ ok: true, runs });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const action = String(body?.action ?? "run");
  if (action === "undo") {
    const runId = String(body?.runId ?? "").trim();
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
    const ok = await undoRun(runId);
    return NextResponse.json({ ok });
  }
  const run = await runCurator({ trigger: "manual", dryRun: body?.dryRun === true });
  return NextResponse.json({ ok: true, runId: run.runId, summary: run.summary, changes: run.changes, report: run.report });
}
