import { NextRequest, NextResponse } from "next/server";
import { listActiveKidGoals, setKidGoal, getTwoWeekCycle } from "@/lib/goals";
import { authorizeParentPinRequest } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const goals = await listActiveKidGoals(dateParam || new Date());
    const cycle = getTwoWeekCycle(dateParam || new Date());

    return NextResponse.json({
      ok: true,
      cycle,
      goals,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to list goals" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyRecord = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const auth = await authorizeParentPinRequest(request, bodyRecord);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error === "adult_only" ? "Only parents can set kid goals" : "Parent PIN required" },
        { status: auth.status ?? 401 }
      );
    }

    const { member, targetPoints, reward, bonusPoints, cycleStart } = body ?? {};

    if (!member || typeof targetPoints !== "number" || targetPoints < 1) {
      return NextResponse.json(
        { ok: false, error: "A valid member name and targetPoints (>0) are required" },
        { status: 400 }
      );
    }

    const updated = await setKidGoal(member, targetPoints, {
      reward,
      bonusPoints,
      cycleStart,
    });

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Failed to persist goal in PocketBase" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      goal: updated,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
