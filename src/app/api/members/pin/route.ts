import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { isMemberPinAvailable, verifyPinForMemberId, findOrCreateMemberRecord, withMemberAdminOperation } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actorPin, newPin } = body || {};
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (typeof actorPin !== "string" || !actorPin) {
      return NextResponse.json({ error: "actorPin is required" }, { status: 400 });
    }
    if (typeof newPin !== "string" || !/^\d{4}$/.test(newPin)) {
      return NextResponse.json({ error: "New PIN must be exactly 4 digits" }, { status: 400 });
    }

    const result = await withMemberAdminOperation(async () => {
      const actor = await verifyPinForMemberId(session.memberId, actorPin);
      if (!actor) return { invalid: true as const };
      if (!await isMemberPinAvailable(newPin, session.memberId)) return { collision: true as const };
      const member = await withAdmin((pb) => findOrCreateMemberRecord(pb, actor, { pin: newPin }));
      return { invalid: false as const, collision: false as const, member };
    });
    if (result.invalid) return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    if (result.collision) return NextResponse.json({ error: "pin_collision" }, { status: 409 });
    if (!result.member) return NextResponse.json({ error: "Member is not live" }, { status: 401 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Member PIN API error:", error);
    return NextResponse.json({ error: "Failed to change PIN" }, { status: 500 });
  }
}
