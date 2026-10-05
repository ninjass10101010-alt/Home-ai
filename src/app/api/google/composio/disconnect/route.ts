import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { deleteConnectedAccount } from "@/lib/google/composio";
import { disconnectGoogle, readConnectionSnapshot } from "@/lib/google/connection-state";
import { invalidateGoogleIntegrationOperation } from "@/lib/google/integration-operation";
import { clearCalendarCache } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  let connectedAccountId: string | null = null;
  try {
    const snapshot = await readConnectionSnapshot();
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
    await disconnectGoogle();
    localRevoked = true;
    invalidateGoogleIntegrationOperation();
    await clearCalendarCache();
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
