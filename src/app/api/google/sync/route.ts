import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { syncCalendar, listCalendars } from "@/lib/google/calendar";
import {
  isGoogleConnected,
  GoogleAuthError,
  mapGoogleAuthError,
  readConnectionSnapshot,
} from "@/lib/google/connection-state";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function googleAuthResponse(error: unknown): NextResponse {
  const mapped = mapGoogleAuthError(error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}

function googleStateUnavailableResponse(): NextResponse {
  return googleAuthResponse(
    new GoogleAuthError("unavailable", "Google connection state unavailable"),
  );
}

async function readAccountEmail(): Promise<string | null> {
  try {
    const snapshot = await readConnectionSnapshot();
    return snapshot.accountEmail ?? null;
  } catch {
    throw new GoogleAuthError("unavailable", "Google connection state unavailable");
  }
}

export async function POST(req: NextRequest) {
  const gate = await authorizeAdminRequest(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error ?? "unauthorized" },
      { status: gate.status ?? 401 },
    );
  }
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const resource = body.resource === undefined ? "all" : body.resource;
  if (resource !== "calendar" && resource !== "tasks" && resource !== "all") {
    return NextResponse.json({ ok: false, error: "invalid_resource" }, { status: 400 });
  }

  let connected: boolean;
  try {
    connected = await isGoogleConnected();
  } catch (error) {
    if (error instanceof GoogleAuthError) return googleAuthResponse(error);
    return googleStateUnavailableResponse();
  }
  if (!connected) {
    return NextResponse.json(
      { ok: false, code: "no_grant", error: "Google account is not connected" },
      { status: 409 },
    );
  }

  try {
    await ensureGoogleCollections();

    const result: any = { ok: true };
    let partialFailure = false;
    let skippedFailure: { status: number; error: string } | null = null;
    let taskFailure: { status: number; error: string; partial: boolean } | null = null;

    if (resource === "calendar" || resource === "all") {
      const c = await syncCalendar();
      if (c && "skipped" in c) {
        result.calendar = { skipped: true, reason: c.reason };
        skippedFailure = { status: 409, error: "calendar_sync_skipped" };
      } else {
        result.calendar = { events: c.events, deleted: c.deleted, perCalendar: c.perCalendar };
        if (Array.isArray(c.perCalendar) && c.perCalendar.some((entry: any) => entry?.ok === false)) {
          partialFailure = true;
        }
      }
    }

    if (resource === "tasks" || resource === "all") {
      try {
        const { syncTasks } = await import("@/lib/google/tasks");
        const t = await syncTasks();
        if ("skipped" in t) {
          result.tasks = { skipped: true, reason: t.reason };
        } else {
          result.tasks = { tasks: t.tasks, deleted: t.deleted };
        }
      } catch (e: any) {
        if (e instanceof GoogleAuthError) throw e;
        result.tasks = { skipped: true, reason: e?.message || "Tasks sync failed" };
        taskFailure = { status: 502, error: "tasks_sync_failed", partial: true };
      }
    }

    const accountEmail = await readAccountEmail();
    if (accountEmail) {
      result.account_email = accountEmail;
    }

    if (skippedFailure) {
      return NextResponse.json({
        ...result,
        ok: false,
        skipped: true,
        error: skippedFailure.error,
      }, { status: skippedFailure.status });
    }
    if (taskFailure) {
      return NextResponse.json({
        ...result,
        ok: false,
        skipped: result.tasks?.skipped === true,
        partial: taskFailure.partial,
        error: taskFailure.error,
      }, { status: taskFailure.status });
    }
    if (partialFailure) {
      return NextResponse.json({
        ...result,
        ok: false,
        partial: true,
        error: "calendar_partial_failure",
      }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof GoogleAuthError) {
      return googleAuthResponse(e);
    }
    console.error("[google/sync]", e);
    return NextResponse.json(
      { ok: false, code: "unknown", error: e?.message || "Sync failed" },
      { status: 500 },
    );
  }
}
