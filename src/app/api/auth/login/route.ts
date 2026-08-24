import { NextRequest, NextResponse } from "next/server";
import { verifyPinFromPB, sanitizeMember } from "@/lib/server-auth";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

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
    if (!process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "SESSION_SECRET not configured" }, { status: 500 });
    }
    const token = await signSession({ memberId: member.id, name: member.name, role: member.role });
    const res = NextResponse.json({ success: true, member: sanitizeMember(member) });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
