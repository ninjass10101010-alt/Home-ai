import { NextRequest, NextResponse } from "next/server";
import { findMemberByName, sanitizeMember } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const member = await findMemberByName(session.name);
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ member: sanitizeMember(member) });
}
