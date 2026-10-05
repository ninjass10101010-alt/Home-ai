import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import {
  ComposioError,
  COMPOSIO_TOOLKITS,
  createConnectedAccountLink,
} from "@/lib/google/composio";
import { TASKS_SNAPSHOT_KEY, writeConnectionSnapshot } from "@/lib/google/connection-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Toolkit = (typeof COMPOSIO_TOOLKITS)[keyof typeof COMPOSIO_TOOLKITS];

function snapshotKeyFor(toolkit: Toolkit): string | undefined {
  return toolkit === COMPOSIO_TOOLKITS.TASKS ? TASKS_SNAPSHOT_KEY : undefined;
}

function composioErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ComposioError)) return null;
  const status =
    error.code === "not_configured" ? 503 : error.code === "auth_failed" ? 401 : 502;
  return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
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
    requested !== COMPOSIO_TOOLKITS.TASKS
  ) {
    return NextResponse.json({ ok: false, error: "invalid_toolkit" }, { status: 400 });
  }
  const toolkit: Toolkit =
    requested === COMPOSIO_TOOLKITS.TASKS ? COMPOSIO_TOOLKITS.TASKS : COMPOSIO_TOOLKITS.CALENDAR;

  try {
    await ensureGoogleCollections();
    const link = await createConnectedAccountLink(toolkit);
    await writeConnectionSnapshot(
      {
        connectedAccountId: link.connectedAccountId,
        status: "INITIATED",
        accountEmail: null,
        connectedAt: null,
        lastVerifiedAt: null,
      },
      snapshotKeyFor(toolkit),
    );
    return NextResponse.json({
      ok: true,
      toolkit,
      auth_url: link.redirectUrl,
      connected_account_id: link.connectedAccountId,
      expires_at: link.expiresAt,
    });
  } catch (error) {
    const mapped = composioErrorResponse(error);
    if (mapped) return mapped;
    console.error("[google/composio/setup]", error);
    return NextResponse.json(
      { ok: false, code: "google_state_unavailable", error: "Google connection state unavailable" },
      { status: 503 },
    );
  }
}
