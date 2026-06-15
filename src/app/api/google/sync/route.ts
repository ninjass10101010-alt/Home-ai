import { NextRequest, NextResponse } from "next/server";
import { syncCalendar, listCalendars } from "@/lib/google/calendar";
import { isGoogleConnected, GoogleAuthError } from "@/lib/google/oauth-client";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { getStoredTokens } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { resource?: "calendar" | "tasks" | "all" } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const resource = body.resource || "all";

  if (!(await isGoogleConnected())) {
    return NextResponse.json(
      { ok: false, code: "no_grant", error: "Google account is not connected" },
      { status: 409 },
    );
  }

  try {
    await ensureGoogleCollections();

    const result: any = { ok: true };

    if (resource === "calendar" || resource === "all") {
      const c = await syncCalendar();
      result.calendar = { events: c.events, deleted: c.deleted };
    }

    if (resource === "tasks" || resource === "all") {
      const tokens = await getStoredTokens();
      const hasTasksScope = tokens?.scope?.includes("googleapis.com/auth/tasks");
      if (!hasTasksScope) {
        result.tasks = {
          skipped: true,
          reason:
            "Google Tasks scope is not granted. Add https://www.googleapis.com/auth/tasks to GOOGLE_OAUTH_SCOPES and reconnect (requires a Web OAuth client with a public redirect URI; Device Flow does not allow Tasks).",
        };
      } else {
        try {
          const { syncTasks } = await import("@/lib/google/tasks");
          const t = await syncTasks();
          result.tasks = { tasks: t.tasks, deleted: t.deleted };
        } catch (e: any) {
          result.tasks = { skipped: true, reason: e?.message || "Tasks sync failed" };
        }
      }
    }

    const tokens = await getStoredTokens();
    if (tokens) {
      result.account_email = tokens.account_email;
    }

    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof GoogleAuthError) {
      const status = e.code === "no_grant" ? 409 : 401;
      return NextResponse.json(
        { ok: false, code: e.code, error: e.message },
        { status },
      );
    }
    console.error("[google/sync]", e);
    return NextResponse.json(
      { ok: false, code: "unknown", error: e?.message || "Sync failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const connected = await isGoogleConnected();
    if (!connected) {
      return NextResponse.json({ ok: true, connected: false });
    }
    const calendars = await listCalendars().catch(() => []);
    return NextResponse.json({ ok: true, connected: true, calendars });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Sync check failed" },
      { status: 500 },
    );
  }
}
