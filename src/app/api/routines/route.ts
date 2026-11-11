import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import {
  DEFAULT_ACCOUNTABILITY_STATE,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_ROUTINES,
  type FamilyRoutine,
} from "@/types/routines";
import {
  sanitizeRoutine,
  sanitizeRoutineSettings,
} from "@/lib/routine-rules";
import {
  authorizeRoutineParentWrite,
  ensureRoutineAccountability,
  ROUTINE_SETTINGS_KEY,
  ROUTINES_STATE_KEY,
  readRoutinesDoc,
  writeStateRecord,
} from "@/lib/routine-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await withAdmin(async (pb) => {
      const { routines, settings } = await readRoutinesDoc(pb);
      return { routines, settings };
    });
    const accountability = await ensureRoutineAccountability().catch(
      () => DEFAULT_ACCOUNTABILITY_STATE,
    );

    return NextResponse.json({
      ok: true,
      routines: data.routines,
      settings: data.settings,
      accountability,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed_to_read_routines" },
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

  const auth = await authorizeRoutineParentWrite(req, body);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || "unauthorized" },
      { status: auth.status || 401 },
    );
  }

  try {
    if (!Array.isArray(body.routines)) {
      return NextResponse.json(
        { ok: false, error: "routines_array_required" },
        { status: 400 },
      );
    }

    const result = await withAdmin(async (pb) => {
      const current = await readRoutinesDoc(pb);
      const nextSettings =
        body.settings !== undefined
          ? sanitizeRoutineSettings(body.settings)
          : current.settings ?? { ...DEFAULT_ROUTINE_SETTINGS };

      const cleanRoutines: FamilyRoutine[] = (body.routines as unknown[])
        .map((r) => sanitizeRoutine(r, nextSettings))
        .filter((r): r is FamilyRoutine => r !== null);

      await writeStateRecord(pb, ROUTINES_STATE_KEY, cleanRoutines);
      if (body.settings !== undefined) {
        await writeStateRecord(pb, ROUTINE_SETTINGS_KEY, nextSettings);
      }

      return { routines: cleanRoutines, settings: nextSettings };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed_to_save_routines" },
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

  const auth = await authorizeRoutineParentWrite(req, body);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || "unauthorized" },
      { status: auth.status || 401 },
    );
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";

  try {
    if (action === "update_settings") {
      const result = await withAdmin(async (pb) => {
        const current = await readRoutinesDoc(pb);
        const nextSettings = sanitizeRoutineSettings(body.settings);
        await writeStateRecord(pb, ROUTINE_SETTINGS_KEY, nextSettings);
        return { routines: current.routines, settings: nextSettings };
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "upsert_routine") {
      const result = await withAdmin(async (pb) => {
        const current = await readRoutinesDoc(pb);
        const sanitized = sanitizeRoutine(body.routine, current.settings);
        if (!sanitized) return null;
        const baseRoutines = current.routines ?? DEFAULT_ROUTINES;
        const exists = baseRoutines.some((r) => r.id === sanitized.id);
        const withCreated: FamilyRoutine = exists
          ? sanitized
          : { ...sanitized, createdAt: sanitized.createdAt || new Date().toISOString() };
        const nextRoutines = exists
          ? baseRoutines.map((r) => (r.id === withCreated.id ? withCreated : r))
          : [...baseRoutines, withCreated];
        await writeStateRecord(pb, ROUTINES_STATE_KEY, nextRoutines);
        return { routine: withCreated, routines: nextRoutines, settings: current.settings };
      });
      if (!result) {
        return NextResponse.json({ ok: false, error: "invalid_routine" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "delete_routine") {
      const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
      if (!routineId) {
        return NextResponse.json({ ok: false, error: "routine_id_required" }, { status: 400 });
      }
      const result = await withAdmin(async (pb) => {
        const current = await readRoutinesDoc(pb);
        const nextRoutines = current.routines.filter((r) => r.id !== routineId);
        await writeStateRecord(pb, ROUTINES_STATE_KEY, nextRoutines);
        return { routines: nextRoutines, settings: current.settings };
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (Array.isArray(body.routines)) {
      const result = await withAdmin(async (pb) => {
        const current = await readRoutinesDoc(pb);
        const nextSettings =
          body.settings !== undefined
            ? sanitizeRoutineSettings(body.settings)
            : current.settings;
        const cleanRoutines = (body.routines as unknown[])
          .map((r) => sanitizeRoutine(r, nextSettings))
          .filter((r): r is FamilyRoutine => r !== null);
        await writeStateRecord(pb, ROUTINES_STATE_KEY, cleanRoutines);
        if (body.settings !== undefined) {
          await writeStateRecord(pb, ROUTINE_SETTINGS_KEY, nextSettings);
        }
        return { routines: cleanRoutines, settings: nextSettings };
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed_to_save_routines" },
      { status: 500 },
    );
  }
}
