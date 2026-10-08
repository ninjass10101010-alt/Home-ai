import { NextRequest, NextResponse } from "next/server";
import { requireLiveSession } from "@/lib/server-auth";
import {
  cancelTaskCommandQueueRow,
  listTaskCommandQueueState,
} from "@/lib/task-command-queue-server";
import { isRecord } from "@/lib/task-operation-contract";

export const dynamic = "force-dynamic";

/**
 * The queue-status surface: the family's banners render from these rows, so
 * any signed-in device can see (and a parent or the original actor can
 * cancel) a command that is waiting for the family server — across devices,
 * reloads and reboots.
 *
 * GET  — pending rows, recent failures, and terminal markers still inside
 *        their retention window. PB failures answer 503 so the client keeps
 *        its local view instead of mistaking an outage for an empty queue.
 * DELETE — cancel one pending row by operation id. Only the member who
 *        queued it or a parent may cancel; cancelling an already-terminal row
 *        is a no-op success (the family's intent was already served).
 */
export async function GET(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ ok: false, error: live.error, rows: [] }, { status: live.status });
  }
  let rows;
  try {
    rows = await listTaskCommandQueueState();
  } catch {
    return NextResponse.json(
      { ok: false, error: "queue_unavailable", rows: [] },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, rows });
}

export async function DELETE(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ ok: false, error: live.error }, { status: live.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const operationId = isRecord(body) && typeof body.operationId === "string" ? body.operationId.trim() : "";
  if (!operationId) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  let result;
  try {
    result = await cancelTaskCommandQueueRow(
      operationId,
      live.identity.memberId,
      live.identity.role === "parent",
    );
  } catch {
    return NextResponse.json({ ok: false, error: "queue_unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
