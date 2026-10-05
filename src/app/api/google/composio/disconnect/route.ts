import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { deleteConnectedAccount } from "@/lib/google/composio";
import { disconnectGoogle, readConnectionSnapshot } from "@/lib/google/connection-state";
import { invalidateGoogleIntegrationOperation } from "@/lib/google/integration-operation";
import { clearDirectGoogleCache } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    console.error("[google/composio/disconnect] snapshot read failed", error);
  }

  let remoteRevoked = !connectedAccountId;
  if (connectedAccountId) {
    try {
      await deleteConnectedAccount(connectedAccountId);
      remoteRevoked = true;
    } catch (error) {
      console.error("[google/composio/disconnect] remote delete failed", error);
      remoteRevoked = false;
    }
  }

  let localRevoked = false;
  try {
    await disconnectGoogle();
    localRevoked = true;
    invalidateGoogleIntegrationOperation();
    await clearDirectGoogleCache();
  } catch (error) {
    console.error("[google/composio/disconnect]", error);
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
