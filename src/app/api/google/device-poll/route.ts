import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { isDeviceAttemptActive, withDeviceAttemptCommit } from "@/lib/google/device-attempts";
import { pollForToken, fetchAccountEmail } from "@/lib/google/device-auth";
import { saveTokens } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PollBody {
  attempt_id?: string;
  device_code?: string;
  interval?: number;
}

export async function POST(req: NextRequest) {
  const gate = await authorizeAdminRequest(req);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error ?? "unauthorized" },
      { status: gate.status ?? 401 },
    );
  }
  let body: PollBody;
  try {
    body = (await req.json()) as PollBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { attempt_id, device_code, interval } = body;
  if (!attempt_id || typeof attempt_id !== "string" || !device_code || typeof device_code !== "string") {
    return NextResponse.json(
      { ok: false, error: "attempt_id and device_code are required" },
      { status: 400 },
    );
  }
  if (!isDeviceAttemptActive(attempt_id, device_code)) {
    return NextResponse.json(
      { ok: false, code: "attempt_invalidated", error: "Google connection attempt is no longer active" },
      { status: 409 },
    );
  }

  try {
    const result = await pollForToken(device_code, Math.max(5, interval || 5));
    if (!isDeviceAttemptActive(attempt_id, device_code)) {
      return NextResponse.json(
        { ok: false, code: "attempt_invalidated", error: "Google connection attempt is no longer active" },
        { status: 409 },
      );
    }

    if (result.status === "pending") {
      return NextResponse.json({
        ok: true,
        status: "pending",
        error: result.error,
        next_interval: result.interval,
      });
    }

    if (result.status === "denied") {
      return NextResponse.json({
        ok: true,
        status: "denied",
        error: "access_denied",
      });
    }

    if (result.status === "expired") {
      return NextResponse.json({
        ok: true,
        status: "expired",
        error: "expired_token",
      });
    }

    if (result.status === "complete") {
      const t = result.tokens;
      const refreshToken = t.refresh_token;
      if (!refreshToken) {
        return NextResponse.json(
          {
            ok: false,
            code: "no_refresh_token",
            error:
              "Google did not return a refresh token. This usually means the account was already granted access previously. Disconnect the app at https://myaccount.google.com/permissions and try again.",
          },
          { status: 400 },
        );
      }

      const resolvedAccountEmail = await fetchAccountEmail(t.access_token);
      const committed = await withDeviceAttemptCommit(attempt_id, async () => {
        if (!isDeviceAttemptActive(attempt_id, device_code)) return null;
        await saveTokens({
          access_token: t.access_token,
          refresh_token: refreshToken,
          scope: t.scope,
          token_type: t.token_type,
          expires_in: t.expires_in,
          account_email: resolvedAccountEmail,
        });
        return { account_email: resolvedAccountEmail };
      });
      if (!committed) {
        return NextResponse.json(
          { ok: false, code: "attempt_invalidated", error: "Google connection attempt is no longer active" },
          { status: 409 },
        );
      }
      const account_email = committed.account_email;

      return NextResponse.json({
        ok: true,
        status: "complete",
        account_email,
        scope: t.scope,
        expires_in: t.expires_in,
      });
    }

    return NextResponse.json(
      { ok: false, error: "Unexpected poll result" },
      { status: 500 },
    );
  } catch (e: any) {
    console.error("[google/device-poll]", e);
    return NextResponse.json(
      { ok: false, code: "unknown", error: e?.message || "Poll failed" },
      { status: 500 },
    );
  }
}
