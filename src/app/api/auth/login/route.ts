import { NextRequest, NextResponse } from "next/server";
import { verifyPinFromPB, sanitizeMember } from "@/lib/server-auth";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export const dynamic = "force-dynamic";

// The dashboard is served over plain HTTP on the LAN (http://192.168.0.28:3000).
// Browsers refuse to send Secure cookies over http, so a hardcoded
// `secure: NODE_ENV === "production"` silently killed every session-gated call
// in the NAS deployment (recipes wouldn't save, chat tools 401'd, etc.).
// Default stays secure in production; set SESSION_COOKIE_SECURE=false for
// HTTP-only LAN deployments.
export function sessionCookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false";
}

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
      secure: sessionCookieSecure(),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("[auth/login] failed:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
