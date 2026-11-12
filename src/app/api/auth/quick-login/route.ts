import { NextRequest, NextResponse } from "next/server";
import { findMemberByName, sanitizeMember } from "@/lib/server-auth";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { isSessionRole } from "@/lib/session-policy";
import { sessionCookieSecure } from "../login/route";

export const dynamic = "force-dynamic";

// 1-tap PIN-free sign-in for ALL household members (parent, child, pet).
// Sensitive actions (task/routine creation, approvals, explicit music unlock,
// dashboard & system edits) enforce an action-level Parent PIN server-side so
// effortless profile switching never weakens household controls. Unknown roles
// or a failed roster read still fail closed.
export async function POST(request: NextRequest) {
  try {
    const { memberName } = await request.json();
    if (!memberName) {
      return NextResponse.json({ error: "memberName is required" }, { status: 400 });
    }
    if (!process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
    }
    const member = await findMemberByName(String(memberName));
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (!isSessionRole(String(member.role || "").trim().toLowerCase())) {
      return NextResponse.json({ error: "pin_required" }, { status: 403 });
    }
    const normalizedRole = String(member.role).trim().toLowerCase();
    const token = await signSession({ memberId: member.id, name: member.name, role: normalizedRole });
    const res = NextResponse.json({ success: true, member: sanitizeMember(member) });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: sessionCookieSecure(),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("[auth/quick-login] failed:", err instanceof Error ? err.message : String(err));
    // A PB read failure or bad body never signs anyone in — fail closed.
    return NextResponse.json({ error: "pin_required" }, { status: 403 });
  }
}
