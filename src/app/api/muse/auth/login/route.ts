import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { signMuseToken } from "@/lib/muse/token";
import { readMuseRow, hashMuseKey, touchMuseUsage } from "@/lib/muse/store";
import { writeMuseLog } from "@/lib/muse/log";
import {
  checkLoginLimit,
  registerLoginFailure,
  clearLoginFailures,
  isLoginLocked,
} from "@/lib/muse/ratelimit";
import { clientIp } from "@/lib/muse/auth";

// node:crypto (HMAC + sha256) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time compare over the two SHA-256 digests. Unequal lengths can
// only mean a malformed stored hash, which can never be a match.
function keyMatches(providedKey: string, storedHash: string): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashMuseKey(providedKey), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { key?: unknown }).key !== "string" ||
    (body as { key: string }).key.trim().length === 0
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const key = (body as { key: string }).key;

  if (isLoginLocked(ip)) {
    return NextResponse.json({ error: "locked" }, { status: 429 });
  }
  if (!checkLoginLimit(ip)) {
    await writeMuseLog({ kind: "rate_limited", ok: false, ip });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const row = await readMuseRow();
    // Unknown row, disabled identity, and wrong key all collapse to the same
    // 401 so a caller can never tell whether the key exists.
    if (!row || !row.enabled || !keyMatches(key, row.keyHash)) {
      registerLoginFailure(ip);
      await writeMuseLog({
        kind: "auth_fail",
        ok: false,
        ip,
        keyPrefix: row?.keyPrefix,
        detail: "invalid key",
      });
      return NextResponse.json({ error: "invalid_key" }, { status: 401 });
    }

    clearLoginFailures(ip);
    const { token, expiresAt } = signMuseToken({ ver: row.version, adm: row.adminEnabled });
    await writeMuseLog({ kind: "login", ok: true, ip, keyPrefix: row.keyPrefix, detail: "key login" });
    await touchMuseUsage(ip);
    return NextResponse.json({
      token,
      expiresAt,
      scopes: ["tools"],
      admin: row.adminEnabled,
    });
  } catch (err) {
    console.error("[muse/login] failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
