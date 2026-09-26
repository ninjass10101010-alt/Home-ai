import { NextRequest, NextResponse } from "next/server";
import { getTool } from "@/lib/hermes-tools";
import { requireLiveSession, verifyPinAgainstAnyMember } from "@/lib/server-auth";
import { liveMembers } from "@/lib/consuela/live-reads";
import { localWeekStartISO } from "@/lib/local-date";
import { applyWeekLedgerOperation, type LedgerProjection } from "@/lib/ledger-operations";
import {
  mutateSnapshotWithMeta,
  persistSnapshotWeek,
  type SnapshotData,
} from "@/lib/snapshot-tasks";
import { normalizeOperationId } from "@/lib/task-operation-contract";
import type { LedgerOperationInput } from "@/types/tasks";

export const dynamic = "force-dynamic";

const PIN_HEADER = "x-consuela-pin";

// Task 11 — buffer apply for the "Consuela's week" card. Mirrors
// /api/consuela/suggestions/act: a write route, so it requires a PIN
// (header or cookie) verified server-side against PocketBase. Adults-only:
// child AND pet members are rejected with the same `adult_only` error the
// admin routes use (src/lib/admin-auth.ts) — this card plans the family's
// week and writes real calendar events, so a kid's or pet's PIN must never
// authorize it.
type PinAuth = "ok" | "missing" | "adult_only";

async function authorizePin(request: NextRequest): Promise<PinAuth> {
  const pin =
    request.headers.get(PIN_HEADER) || request.cookies.get(PIN_HEADER)?.value || "";
  if (!pin) return "missing";
  const member = await verifyPinAgainstAnyMember(pin);
  if (!member) return "missing";
  if (member.role === "child" || member.role === "pet") return "adult_only";
  return "ok";
}

// Tighter than the act route's allowlist on purpose: the planner surface may
// ONLY ever create a calendar event or apply a PIN-confirmed point adjustment.
// Admin tools, completions, removals and read tools stay excluded.
const ALLOWED_TOOLS = new Set(["add_event", "adjust_points"]);

const MAX_ADJUST_DELTA = 100;
const MAX_ADJUST_REASON_CHARS = 200;

function adjustError(
  error: string,
  status = 400,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function withRepairMarker(data: SnapshotData, operationId: string): SnapshotData {
  const current = Array.isArray(data.pendingProjectionRepairs) ? data.pendingProjectionRepairs : [];
  return {
    ...data,
    pendingProjectionRepairs: [
      ...current.filter((marker) => marker.operationId !== operationId),
      { operationId, taskIds: [], action: "adjust", createdAt: new Date().toISOString() },
    ],
  };
}

async function applyPointAdjustment(
  a: Record<string, unknown>,
  operationId: string,
): Promise<NextResponse> {
  const member = typeof a.member === "string" ? a.member.trim() : "";
  const delta = Number(a.delta);
  const reason = typeof a.reason === "string" ? a.reason.trim() : "";
  if (!member) return adjustError("member required");
  if (!Number.isInteger(delta) || delta === 0 || delta < -MAX_ADJUST_DELTA || delta > MAX_ADJUST_DELTA) {
    return adjustError(`delta must be a whole number of points between -${MAX_ADJUST_DELTA} and ${MAX_ADJUST_DELTA}, never 0`);
  }
  if (!reason) return adjustError("reason required");
  if (reason.length > MAX_ADJUST_REASON_CHARS) {
    return adjustError(`reason must be ${MAX_ADJUST_REASON_CHARS} characters or fewer`);
  }

  const members = await liveMembers();
  if (members === null) return adjustError("family roster unavailable — try again in a moment", 503);
  const search = member.toLowerCase();
  const match = members.find((m: any) => {
    const name = String(m.fullName || m.name || "").toLowerCase();
    return name === search || name.startsWith(search);
  });
  if (!match) return adjustError(`unknown member "${member}" — adjust points for a family member on the roster`);
  const memberName = String(match.fullName || match.name);

  const operation: LedgerOperationInput = {
    operationId,
    source: "planner-adjust",
    action: "adjust",
    entries: [
      {
        type: "adjust",
        member: memberName,
        amount: delta,
        description: reason,
      },
    ],
  };

  const project: LedgerProjection = async ({ pb, weekData }) => {
    const projected = await persistSnapshotWeek(pb, weekData);
    if (projected.ok) return true;
    await mutateSnapshotWithMeta(
      (data) => ({ data: withRepairMarker(data, operationId), result: null }),
      pb,
    ).catch(() => null);
    return false;
  };

  const weekStart = localWeekStartISO();
  let result = await applyWeekLedgerOperation({ weekStart, operation, project });
  if (!result.ok && result.code === "ledger_write_conflict") {
    result = await applyWeekLedgerOperation({ weekStart, operation, project });
  }

  if (!result.ok) {
    if (result.code === "insufficient_balance") {
      const balance = result.weekData.points[memberName] ?? 0;
      return adjustError(
        `${memberName.split(" ")[0]} has ${balance} pts — a ${Math.abs(delta)}-point deduction needs more points.`,
        400,
        { operationId: result.operationId },
      );
    }
    if (result.code === "operation_conflict") {
      return adjustError(
        "That adjustment id was already used for a different change — ask Consuela for a fresh one.",
        409,
        { operationId: result.operationId },
      );
    }
    return adjustError("Points could not be updated just now. Please try again.", 503, {
      operationId: result.operationId,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      member: memberName,
      delta,
      newTotal: result.weekData.points[memberName] ?? 0,
      weekData: result.weekData,
      operationId: result.operationId,
      applied: result.applied,
      duplicate: result.duplicate,
      reconciled: result.reconciled,
    },
    { status: result.reconciled ? 200 : 202 },
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts 24-hour ("14:30") AND 12-hour ("2:30 PM" / "2:30PM") — the calendar
// pages store both shapes.
const TIME_RE = /^\d{1,2}:\d{2}(\s*[AP]M)?$/i;
const TIME_PARTS_RE = /^(\d{1,2}):(\d{2})/;
const MAX_TITLE_CHARS = 120;

// Round-trip through UTC components so "2026-13-45" (regex-shaped but not a
// real day) is rejected instead of silently rolling over to a 2027 date.
function isRealCalendarDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export async function POST(request: NextRequest) {
  const live = await requireLiveSession(request, { requireRole: "parent" });
  if (!live.ok) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }
  const auth = await authorizePin(request);
  if (auth === "missing") {
    return NextResponse.json({ error: "pin required" }, { status: 401 });
  }
  if (auth === "adult_only") {
    return NextResponse.json({ error: "adult_only" }, { status: 401 });
  }
  const { tool, args, operationId } = await request.json().catch(() => ({}));
  if (!tool || !ALLOWED_TOOLS.has(String(tool))) {
    return NextResponse.json({ ok: false, error: "tool not allowed" }, { status: 400 });
  }
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  // adjust_points is a dedicated server-side executor (never a getTool call).
  if (String(tool) === "adjust_points") {
    const id = normalizeOperationId(operationId);
    if (!id) {
      return adjustError("an operation id is required so a retry can never move the points twice");
    }
    return applyPointAdjustment(a, id);
  }
  const title = typeof a.title === "string" ? a.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_CHARS) {
    return NextResponse.json(
      { ok: false, error: `title must be ${MAX_TITLE_CHARS} characters or fewer` },
      { status: 400 }
    );
  }
  const date = typeof a.date === "string" ? a.date.trim() : "";
  if (!DATE_RE.test(date) || !isRealCalendarDate(date)) {
    return NextResponse.json({ ok: false, error: "date must be a real YYYY-MM-DD date" }, { status: 400 });
  }
  const time = a.time === undefined || a.time === null ? "" : String(a.time).trim();
  const timeParts = time ? TIME_PARTS_RE.exec(time) : null;
  if (time && (!TIME_RE.test(time) || !timeParts || Number(timeParts[1]) > 23 || Number(timeParts[2]) > 59)) {
    return NextResponse.json({ ok: false, error: "time must be HH:MM or H:MM AM/PM" }, { status: 400 });
  }
  const def = getTool(String(tool));
  if (!def) {
    return NextResponse.json({ ok: false, error: `Unknown tool: ${tool}` }, { status: 400 });
  }
  try {
    const raw = await def.handler({ ...a, title, date, ...(time ? { time } : {}) });
    let result: unknown = raw;
    try {
      result = JSON.parse(raw);
    } catch {
      // keep raw string result
    }
    // Same success rule as the act route: failure is an `error` key or an
    // explicit `ok: false` (Consuela never reports "Done" on a failed write).
    const parsed = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
    if (!parsed || parsed.error || parsed.ok === false) {
      const message = String(parsed?.error || parsed?.reason || "Action failed");
      return NextResponse.json({ ok: false, error: message, result }, { status: 400 });
    }
    return NextResponse.json({ ok: true, event: parsed.event ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Action failed" }, { status: 400 });
  }
}
