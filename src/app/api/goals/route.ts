import { NextRequest, NextResponse } from "next/server";
import { listActiveKidGoals, setKidGoal, getTwoWeekCycle } from "@/lib/goals";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

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
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    // Role is a CAPABILITY: only parent role may modify goals
    if (!session || session.role !== "parent") {
      return NextResponse.json(
        { ok: false, error: "Only parents can set kid goals" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { member, targetPoints, reward, bonusPoints, cycleStart } = body;

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
