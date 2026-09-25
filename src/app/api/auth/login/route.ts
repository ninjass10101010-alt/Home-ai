import { NextRequest, NextResponse } from "next/server";
import { verifyPinFromPB, sanitizeMember } from "@/lib/server-auth";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { isSessionRole } from "@/lib/session-policy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { memberName, pin } = await request.json();
    if (!memberName || !pin) {
      return NextResponse.json({ error: "memberName and pin are required" }, { status: 400 });
    }
    const member = await verifyPinFromPB(String(memberName), String(pin));
    if (!member) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }
    if (!isSessionRole(member.role)) {
      return NextResponse.json({ error: "unsupported_role" }, { status: 403 });
    }
    if (!process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
    }
    const token = await signSession({ memberId: member.id, name: member.name, role: member.role });
    const res = NextResponse.json({ success: true, member: sanitizeMember(member) });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(member.role));
    return res;
  } catch (err) {
    console.error("[auth/login] failed:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
