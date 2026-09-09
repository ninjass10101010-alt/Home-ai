import { NextRequest, NextResponse } from "next/server";
import { findMemberByName, sanitizeMember } from "@/lib/server-auth";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { PIN_FREE_MAX_AGE } from "@/lib/task-utils";
import { sessionCookieSecure } from "../login/route";

export const dynamic = "force-dynamic";

// PIN-free sign-in for under-10 children (spec 2026-09-09). Eligibility is
// decided HERE, server-side, against the PB member record — never from a
// client-supplied flag. Missing age, age >= PIN_FREE_MAX_AGE, non-child role,
// or a failed roster read all fail closed to the normal PIN path. The points
// blast radius is already capped: kid task completions land in pendingApproval
// (parent-awarded) and claims/rewards still require the kid's PIN.
function ageOf(member: any): number | null {
  const n = Number(member?.age);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
    const age = ageOf(member);
    if (member.role !== "child" || age === null || age >= PIN_FREE_MAX_AGE) {
      return NextResponse.json({ error: "pin_required" }, { status: 403 });
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
    console.error("[auth/quick-login] failed:", err);
    // A PB read failure or bad body never signs anyone in — the client falls
    // back to the PIN modal. 403 (not 500) so the UI reason stays "PIN".
    return NextResponse.json({ error: "pin_required" }, { status: 403 });
  }
}
