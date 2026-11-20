import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { COMPOSIO_TOOLKITS, deleteConnectedAccount } from "@/lib/google/composio";
import {
  disconnectGoogle,
  readConnectionSnapshot,
  TASKS_SNAPSHOT_KEY,
} from "@/lib/google/connection-state";
import { invalidateGoogleIntegrationOperation } from "@/lib/google/integration-operation";
import { clearCalendarCache } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Toolkit = (typeof COMPOSIO_TOOLKITS)[keyof typeof COMPOSIO_TOOLKITS];

const YOUTUBE_TOOLKIT: Toolkit = (COMPOSIO_TOOLKITS.YOUTUBE ?? "youtube") as Toolkit;
const YOUTUBE_KEY = "google_composio_youtube";

function snapshotKeyFor(toolkit: Toolkit): string | undefined {
  if (toolkit === COMPOSIO_TOOLKITS.TASKS) return TASKS_SNAPSHOT_KEY;
  if (toolkit === YOUTUBE_TOOLKIT) return YOUTUBE_KEY;
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown error";
}

export async function POST(req: NextRequest) {
  const gate = await authorizeAdminRequest(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error ?? "unauthorized" },
      { status: gate.status ?? 401 },
    );
  }

  let body: Record<string, unknown> = {};
  const raw = await req.text().catch(() => "");
  if (raw.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  }

  const requested = body.toolkit;
  if (
    requested !== undefined &&
    requested !== COMPOSIO_TOOLKITS.CALENDAR &&
    requested !== COMPOSIO_TOOLKITS.TASKS &&
    requested !== YOUTUBE_TOOLKIT
  ) {
    return NextResponse.json({ ok: false, error: "invalid_toolkit" }, { status: 400 });
  }
  const toolkit: Toolkit =
    requested === COMPOSIO_TOOLKITS.TASKS
      ? COMPOSIO_TOOLKITS.TASKS
      : requested === YOUTUBE_TOOLKIT
        ? YOUTUBE_TOOLKIT
        : COMPOSIO_TOOLKITS.CALENDAR;
  const key = snapshotKeyFor(toolkit);

  let connectedAccountId: string | null = null;
  try {
    const snapshot = await readConnectionSnapshot(key);
    connectedAccountId = snapshot.connectedAccountId;
  } catch (error) {
    console.warn("[google/composio/disconnect] snapshot read failed:", errorMessage(error));
    return NextResponse.json({ ok: false, error: "google_state_unavailable" }, { status: 503 });
  }

  let remoteRevoked = !connectedAccountId;
  if (connectedAccountId) {
    try {
      await deleteConnectedAccount(connectedAccountId);
      remoteRevoked = true;
    } catch (error) {
      console.warn("[google/composio/disconnect] remote delete failed:", errorMessage(error));
      remoteRevoked = false;
    }
  }

  let localRevoked = false;
  try {
    await disconnectGoogle(key);
    localRevoked = true;
    if (toolkit === COMPOSIO_TOOLKITS.CALENDAR) {
      invalidateGoogleIntegrationOperation();
      await clearCalendarCache();
    }
  } catch (error) {
    console.warn("[google/composio/disconnect]", errorMessage(error));
    return NextResponse.json(
      {
        ok: false,
        outcome: "failed",
        remoteRevoked,
        localRevoked,
        error: "Local disconnect failed",
      },
      { status: 500 },
    );
  }

  if (!remoteRevoked) {
    return NextResponse.json({
      ok: true,
      outcome: "local_only",
      remoteRevoked: false,
      localRevoked: true,
      warning: "Google access may remain until the connection is removed from Composio.",
    });
  }

  return NextResponse.json({
    ok: true,
    outcome: "disconnected",
    remoteRevoked: true,
    localRevoked: true,
  });
}
