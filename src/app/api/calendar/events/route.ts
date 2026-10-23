import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import {
  EventValidationError,
  createFamilyEvent,
  type EventInput,
} from "@/lib/calendar/event-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  }

  let body: EventInput;
  try {
    body = (await request.json()) as EventInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: "validation", field: "body", message: "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const result = await createFamilyEvent(body);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof EventValidationError) {
      return NextResponse.json(
        { ok: false, error: "validation", field: error.field, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "event_save_failed", message: "Event wasn't saved. Try again." },
      { status: 503 },
    );
  }
}
