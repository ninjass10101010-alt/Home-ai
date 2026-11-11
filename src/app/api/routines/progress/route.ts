import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { localTodayISO } from "@/lib/local-date";
import { DEFAULT_ACCOUNTABILITY_STATE } from "@/types/routines";
import { sanitizeDailyRoutineProgress } from "@/lib/routine-rules";
import {
  ROUTINE_ACCOUNTABILITY_KEY,
  applyRoutineProgressAction,
  authorizeRoutineParentWrite,
  ensureRoutineAccountability,
  excuseMissedRoutineEntry,
  readOptionalSessionActor,
  readRoutinesDoc,
  readStateRecord,
  routineProgressKey,
  sanitizeAccountabilityState,
  writeStateRecord,
} from "@/lib/routine-service";

export const dynamic = "force-dynamic";

function resolveDateParam(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return localTodayISO();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = resolveDateParam(searchParams.get("date"));
  const todayISO = localTodayISO();

  try {
    const payload = await withAdmin(async (pb) => {
      const progRec = await readStateRecord(pb, routineProgressKey(date));
      const progress = sanitizeDailyRoutineProgress(progRec?.value, date);
      const { settings } = await readRoutinesDoc(pb);
      const existingAcc = sanitizeAccountabilityState(
        (await readStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY))?.value ??
          DEFAULT_ACCOUNTABILITY_STATE,
      );
      return { progress, settings, existingAcc };
    });
    const acc =
      (await ensureRoutineAccountability().catch(() => null)) ??
      payload.existingAcc;

    return NextResponse.json({
      ok: true,
      date,
      todayISO,
      progress: payload.progress,
      settings: payload.settings,
      accountability: acc,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed_to_read_progress" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const actor = await readOptionalSessionActor(req);
  if (actor.sessionError) {
    return NextResponse.json(
      { ok: false, error: actor.sessionError.error },
      { status: actor.sessionError.status },
    );
  }
  if (actor.signedIn && !actor.isParent) {
    return NextResponse.json(
      { ok: false, error: "use_post_action_for_member_progress" },
      { status: 403 },
    );
  }

  const date = resolveDateParam(typeof body.date === "string" ? body.date : undefined);
  const progress = sanitizeDailyRoutineProgress(body.progress, date);

  try {
    await withAdmin(async (pb) => {
      await writeStateRecord(pb, routineProgressKey(date), progress);
    });
    return NextResponse.json({ ok: true, date, progress });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed_to_save_progress" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const actor = await readOptionalSessionActor(req);
  if (actor.sessionError) {
    return NextResponse.json(
      { ok: false, error: actor.sessionError.error },
      { status: actor.sessionError.status },
    );
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";

  try {
    if (action === "excuse_missed") {
      const auth = await authorizeRoutineParentWrite(req, body);
      if (!auth.ok) {
        return NextResponse.json(
          { ok: false, error: auth.error || "unauthorized" },
          { status: auth.status || 401 },
        );
      }
      const res = await excuseMissedRoutineEntry({
        entryId: typeof body.entryId === "string" ? body.entryId : undefined,
        date: typeof body.date === "string" ? body.date : undefined,
        routineId: typeof body.routineId === "string" ? body.routineId : undefined,
        memberName: typeof body.memberName === "string" ? body.memberName : undefined,
        excusedBy: auth.member?.name || "Parent",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: res.error || "excuse_failed" },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        entry: res.entry,
        accountability: res.accountability,
        ...(res.weekData ? { weekData: res.weekData } : {}),
      });
    }

    if (action === "approve_routine" || action === "send_back_routine") {
      const auth = await authorizeRoutineParentWrite(req, body);
      if (!auth.ok) {
        return NextResponse.json(
          { ok: false, error: auth.error || "unauthorized" },
          { status: auth.status || 401 },
        );
      }
      const dateISO = resolveDateParam(typeof body.date === "string" ? body.date : undefined);
      const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
      const targetMemberName =
        typeof body.memberName === "string" ? body.memberName.trim() : "";
      if (!routineId || !targetMemberName) {
        return NextResponse.json(
          { ok: false, error: "routine_and_member_required" },
          { status: 400 },
        );
      }
      const res = await applyRoutineProgressAction({
        action,
        dateISO,
        routineId,
        targetMemberName,
        actor,
        parentMember: auth.member,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: res.error || "action_failed" },
          { status: res.status || 400 },
        );
      }
      return NextResponse.json({
        ok: true,
        date: dateISO,
        progress: res.progress,
        accountability: res.accountability,
        completion: res.completion,
        pointsDelta: res.pointsDelta ?? 0,
        ...(res.weekData ? { weekData: res.weekData } : {}),
      });
    }

    if (
      action === "toggle_step" ||
      action === "complete_routine" ||
      action === "uncomplete_routine"
    ) {
      const dateISO = resolveDateParam(typeof body.date === "string" ? body.date : undefined);
      const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
      const stepId = typeof body.stepId === "string" ? body.stepId.trim() : undefined;
      const requestedMember =
        typeof body.memberName === "string" ? body.memberName.trim() : "";

      let targetMemberName = requestedMember;
      if (actor.signedIn && !actor.isParent && actor.member) {
        targetMemberName =
          requestedMember &&
          requestedMember.toLowerCase() !== actor.member.name.toLowerCase()
            ? requestedMember
            : actor.member.name;
      } else if (!targetMemberName && actor.member) {
        targetMemberName = actor.member.name;
      }

      if (!routineId || !targetMemberName) {
        return NextResponse.json(
          { ok: false, error: "routine_and_member_required" },
          { status: 400 },
        );
      }

      const res = await applyRoutineProgressAction({
        action,
        dateISO,
        routineId,
        stepId,
        targetMemberName,
        actor,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: res.error || "action_failed" },
          { status: res.status || 400 },
        );
      }
      return NextResponse.json({
        ok: true,
        date: dateISO,
        progress: res.progress,
        accountability: res.accountability,
        completion: res.completion,
        pointsDelta: res.pointsDelta ?? 0,
        ...(res.weekData ? { weekData: res.weekData } : {}),
      });
    }

    // Legacy raw progress POST fallback (for non-session kiosk tests/older callers)
    if (body.progress !== undefined) {
      if (actor.signedIn && !actor.isParent) {
        return NextResponse.json(
          { ok: false, error: "use_action_payload" },
          { status: 403 },
        );
      }
      const date = resolveDateParam(typeof body.date === "string" ? body.date : undefined);
      const progress = sanitizeDailyRoutineProgress(body.progress, date);
      await withAdmin(async (pb) => {
        await writeStateRecord(pb, routineProgressKey(date), progress);
      });
      return NextResponse.json({ ok: true, date, progress });
    }

    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed_to_update_progress" },
      { status: 500 },
    );
  }
}
