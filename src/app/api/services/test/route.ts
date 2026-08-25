import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { runServiceTest } from "@/lib/services/tests";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { service } = await request.json();
    if (typeof service !== "string" || !service) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const result = await runServiceTest(service);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ ok: false, detail: "test_failed", ms: 0 }, { status: 500 });
  }
}
