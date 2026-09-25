import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { runServiceTest } from "@/lib/services/tests";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
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
