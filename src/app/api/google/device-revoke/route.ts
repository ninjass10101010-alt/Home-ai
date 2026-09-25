import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { cancelDeviceAttempt, invalidateAllDeviceAttempts } from "@/lib/google/device-attempts";
import {
  invalidateGoogleIntegrationOperation,
  withGoogleIntegrationOperation,
} from "@/lib/google/integration-operation";
import { revokeGoogleToken } from "@/lib/google/device-auth";
import { clearDirectGoogleCache, getStoredTokensStrict, revokeTokens } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RevokeAction = "cancel" | "disconnect";

async function revokeCanonicalGrant(): Promise<NextResponse> {
  let remoteRevoked = false;
  let localRevoked = false;
  try {
    let tokens: Awaited<ReturnType<typeof getStoredTokensStrict>>;
    try {
      tokens = await getStoredTokensStrict();
    } catch {
      return NextResponse.json(
        { ok: false, outcome: "failed", remoteRevoked: false, localRevoked: false, error: "token_read_failed" },
        { status: 503 },
      );
    }
    if (!tokens || tokens.revoked_at) {
      remoteRevoked = true;
    } else if (tokens.refresh_token) {
      const [, refreshRevoked] = await Promise.all([
        revokeGoogleToken(tokens.access_token).catch(() => false),
        revokeGoogleToken(tokens.refresh_token).catch(() => false),
      ]);
      remoteRevoked = refreshRevoked;
    } else {
      remoteRevoked = await revokeGoogleToken(tokens.access_token).catch(() => false);
    }

    const localResult = await revokeTokens();
    if (localResult === false) {
      return NextResponse.json(
        { ok: false, outcome: "failed", remoteRevoked, localRevoked: false, error: "Local token removal failed" },
        { status: 500 },
      );
    }
    localRevoked = true;
    try {
      await clearDirectGoogleCache();
    } catch {
      return NextResponse.json(
        { ok: false, outcome: "failed", remoteRevoked, localRevoked: true, error: "cache_clear_failed" },
        { status: 500 },
      );
    }

    if (!remoteRevoked) {
      return NextResponse.json({
        ok: true,
        outcome: "local_only",
        remoteRevoked: false,
        localRevoked: true,
        warning: "Google access may remain until it is revoked from the Google account.",
      });
    }

    return NextResponse.json({
      ok: true,
      outcome: "disconnected",
      remoteRevoked: true,
      localRevoked: true,
    });
  } catch (error: any) {
    console.error("[google/device-revoke]", error);
    return NextResponse.json(
      {
        ok: false,
        outcome: "failed",
        remoteRevoked,
        localRevoked,
        error: error?.message || "Disconnect failed",
      },
      { status: 500 },
    );
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
  if (body.action !== "cancel" && body.action !== "disconnect") {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }
  const action: RevokeAction = body.action;
  const attemptId = typeof body.attempt_id === "string" && body.attempt_id.trim() ? body.attempt_id : undefined;

  if (action === "cancel") {
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "attempt_id is required" }, { status: 400 });
    }
    const cancellation = await cancelDeviceAttempt(attemptId, async () => {
      invalidateGoogleIntegrationOperation();
      return withGoogleIntegrationOperation(revokeCanonicalGrant);
    });
    if (!cancellation.shouldClearGrant) {
      return NextResponse.json({ ok: true, outcome: "cancelled", attempt_id: attemptId });
    }
    const response = cancellation.cleanupResult;
    if (!response) return NextResponse.json({ ok: false, error: "cancel_cleanup_unavailable" }, { status: 500 });
    if (response.status >= 400) return response;
    const body = await response.json() as Record<string, unknown>;
    return NextResponse.json({ ...body, outcome: "cancelled", attempt_id: attemptId }, { status: response.status });
  }

  const response = await invalidateAllDeviceAttempts(async () => {
    invalidateGoogleIntegrationOperation();
    return withGoogleIntegrationOperation(revokeCanonicalGrant);
  });
  if (!response) return NextResponse.json({ ok: false, error: "disconnect_cleanup_unavailable" }, { status: 500 });
  return response;
}
