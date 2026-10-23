import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { retryFamilyEventGoogle } from "@/lib/calendar/event-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params?: Promise<{ id?: string }> };

async function resolveId(request: NextRequest, context?: Ctx): Promise<string> {
  if (context?.params) {
    const p = await context.params;
    if (p?.id) return p.id;
  }
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  // pathname .../events/:id/retry-google
  return parts[parts.length - 2] ?? "";
}

export async function POST(request: NextRequest, context?: Ctx) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  }
  const id = await resolveId(request, context);
  try {
    return NextResponse.json({ ok: true, ...(await retryFamilyEventGoogle(id)) });
  } catch (error) {
    if ((error as { status?: number })?.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found", message: "Event not found." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "google_retry_failed", message: "Google Calendar couldn't save this event." },
      { status: 503 },
    );
  }
}
