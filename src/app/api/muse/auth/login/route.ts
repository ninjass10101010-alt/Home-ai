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

// Fixed sha256 hex constant compared against when there is no usable stored
// hash. This keeps the digest + timingSafeEqual on every path (no-row,
// disabled, wrong key) so a caller cannot time-distinguish them.
const DUMMY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// Constant-time compare over the two SHA-256 digests. Unequal lengths can
// only mean a malformed stored hash, which can never be a match.
function keyMatches(providedKey: string, storedHash: string): boolean {
  const a = Buffer.from(hashMuseKey(providedKey), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Rejections on the unauthenticated surface must NOT touch PocketBase: the
// audit helper does a create + 500-row read + prune loop per call, which an
// attacker could amplify. Emit a bounded console line with the ip + key
// prefix only — never the key, never the Authorization header.
function tooMany(error: "locked" | "rate_limited", ip: string, keyPrefix: string) {
  console.warn(`[muse/login] ${error}`, { ip, keyPrefix });
  return NextResponse.json({ error }, { status: 429 });
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
  const keyPrefix = key.slice(0, 8);

  if (isLoginLocked(ip)) {
    return tooMany("locked", ip, keyPrefix);
  }
  if (!checkLoginLimit(ip)) {
    return tooMany("rate_limited", ip, keyPrefix);
  }

  try {
    const row = await readMuseRow();
    // Unknown row, disabled identity, and wrong key all collapse to the same
    // 401 so a caller can never tell whether the key exists. The comparison is
    // unconditional (DUMMY_HASH when there is no row) for uniform timing.
    if (!row || !row.enabled || !keyMatches(key, row.keyHash ?? DUMMY_HASH)) {
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
