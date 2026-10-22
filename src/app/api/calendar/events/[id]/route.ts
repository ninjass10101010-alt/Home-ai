import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import {
  EventValidationError,
  deleteFamilyEvent,
  updateFamilyEvent,
  type EventInput,
} from "@/lib/calendar/event-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params?: Promise<{ id?: string }> };

async function resolveId(request: NextRequest, context?: Ctx): Promise<string> {
  if (context?.params) {
    const p = await context.params;
    if (p?.id) return p.id;
  }
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export async function PATCH(request: NextRequest, context?: Ctx) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  }
  const id = await resolveId(request, context);
  try {
    const body = (await request.json()) as EventInput;
    const result = await updateFamilyEvent(id, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof EventValidationError) {
      return NextResponse.json(
        { ok: false, error: "validation", field: error.field, message: error.message },
        { status: 400 },
      );
    }
    if ((error as { status?: number })?.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found", message: "Event not found." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "event_save_failed", message: "Event wasn't saved. Try again." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest, context?: Ctx) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  }
  const id = await resolveId(request, context);
  try {
    const result = await deleteFamilyEvent(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof EventValidationError) {
      return NextResponse.json(
        { ok: false, error: "validation", field: error.field, message: error.message },
        { status: 400 },
      );
    }
    if ((error as { status?: number })?.status === 404) {
      return NextResponse.json({ ok: false, error: "not_found", message: "Event not found." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "event_delete_failed", message: "Event couldn't be deleted. Try again." },
      { status: 503 },
    );
  }
}
