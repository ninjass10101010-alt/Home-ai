import { NextRequest, NextResponse } from "next/server";
import { pollForToken, fetchAccountEmail } from "@/lib/google/device-auth";
import { saveTokens } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PollBody {
  device_code?: string;
  interval?: number;
}

export async function POST(req: NextRequest) {
  let body: PollBody;
  try {
    body = (await req.json()) as PollBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { device_code, interval } = body;
  if (!device_code || typeof device_code !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing device_code" },
      { status: 400 },
    );
  }

  try {
    const result = await pollForToken(device_code, Math.max(5, interval || 5));

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
      if (!t.refresh_token) {
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

      const account_email = t.id_token
        ? await fetchAccountEmail(t.access_token)
        : await fetchAccountEmail(t.access_token);

      await saveTokens({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        scope: t.scope,
        token_type: t.token_type,
        expires_in: t.expires_in,
        account_email,
      });

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
