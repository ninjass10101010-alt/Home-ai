import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { localTodayISO } from "@/lib/local-date";
import type { DailyRoutineProgress } from "@/types/routines";

export const dynamic = "force-dynamic";

const COLLECTION = "consuela_state";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || localTodayISO();
  const key = `routine_progress:${date}`;

  try {
    const row = await withAdmin(async (pb) => {
      try {
        return await pb.collection(COLLECTION).getFirstListItem(`key="${key}"`);
      } catch {
        return null;
      }
    });

    const progress: DailyRoutineProgress =
      row && typeof (row as any).value === "object" && (row as any).value !== null
        ? (row as any).value
        : { checkedSteps: {}, completedRoutines: {} };

    return NextResponse.json({ ok: true, progress, date });
  } catch (err) {
    console.error("[api/routines/progress:GET]", err);
    return NextResponse.json({
      ok: true,
      progress: { checkedSteps: {}, completedRoutines: {} },
      date,
    });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const date = body?.date || localTodayISO();
    const progress: DailyRoutineProgress = body?.progress ?? { checkedSteps: {}, completedRoutines: {} };
    const key = `routine_progress:${date}`;

    await withAdmin(async (pb) => {
      try {
        const existing = await pb.collection(COLLECTION).getFirstListItem(`key="${key}"`);
        await pb.collection(COLLECTION).update(existing.id, { value: progress });
      } catch {
        await pb.collection(COLLECTION).create({ key, value: progress });
      }
    });

    return NextResponse.json({ ok: true, saved: true, date });
  } catch (err) {
    console.error("[api/routines/progress:PUT]", err);
    return NextResponse.json({ ok: false, error: "failed_to_save" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return PUT(request);
}
