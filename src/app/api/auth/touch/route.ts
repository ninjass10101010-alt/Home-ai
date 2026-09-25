import { NextRequest, NextResponse } from "next/server";
import { requireLiveSession } from "@/lib/server-auth";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { sessionTtlSeconds, type SessionIdentity } from "@/lib/session-policy";

export const dynamic = "force-dynamic";

export type AuthTouchResponse = {
  ok: true;
  member: SessionIdentity;
  expiresIn: number;
};

export async function POST(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json(
      { error: live.error },
      { status: live.status },
    );
  }

  const expiresIn = sessionTtlSeconds(live.identity.role);
  const token = await signSession(live.identity);
  const response = NextResponse.json({
    ok: true,
    member: live.identity,
    expiresIn,
  } satisfies AuthTouchResponse);
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(live.identity.role),
  );
  return response;
}
