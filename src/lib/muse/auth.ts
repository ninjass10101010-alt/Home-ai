// Request-time authorization for the MUSE tool surface (Task 8 / B2).
//
// A MUSE caller proves identity with `Authorization: Bearer <muse-token>`
// (minted by /api/muse/auth/login). The token is checked against the LIVE
// singleton row, so disabling the identity or bumping its version revokes
// outstanding tokens. Admin is the row's CURRENT `adminEnabled` toggle — the
// token's `adm` claim (a mint-time snapshot, kept for diagnostics) does not
// gate it, so turning the operator toggle on grants admin to agents that are
// already connected and turning it off revokes admin immediately.

import type { NextRequest } from "next/server";
import { verifyMuseToken } from "./token";
import { readMuseRow, touchMuseUsage } from "./store";
import { checkKeyLimit } from "./ratelimit";

export type MuseAuthResult =
  | { ok: true; adm: boolean }
  | { ok: false; status: number; error: string };

/**
 * Best-effort client IP for rate limiting + usage stamps.
 *
 * Trust model: `x-forwarded-for` is only authoritative when the dashboard sits
 * behind a reverse proxy that overwrites/strips it. The direct deployment is
 * exposed as `http://<nas>:3000` to any LAN client, where a caller can forge
 * XFF freely — so it is ADVISORY there, not authoritative. That is acceptable
 * because this is DoS control, not brute-force control: MUSE keys are 256-bit
 * random and the in-process maps are hard-capped (see ./ratelimit.ts), so
 * forged-IP churn cannot grow memory without bound. We keep XFF as the source
 * rather than pretending it is trustworthy.
 */
export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function authorizeMuseRequest(request: NextRequest): Promise<MuseAuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  let row;
  try {
    row = await readMuseRow();
  } catch {
    // PB unreachable — fail closed with no information leak.
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!row) return { ok: false, status: 401, error: "unauthorized" };

  const result = verifyMuseToken(token, {
    currentVersion: row.version,
    enabled: row.enabled,
  });
  if (!result.ok) {
    if (result.reason === "disabled") {
      return { ok: false, status: 403, error: "muse_disabled" };
    }
    return { ok: false, status: 401, error: "unauthorized" };
  }

  // Admin is the LIVE operator toggle, not a token capability (2026-09-18):
  // an agent that connected while admin was off gains the admin tools the
  // moment the toggle is switched on, with no re-login or key rotation.
  const adm = row.adminEnabled;

  // Per-key budget AFTER verification, keyed by the row's key prefix and rate.
  // A 429 here is console-only — never a PocketBase write.
  if (!checkKeyLimit(row.keyPrefix, row.rateLimitPerMin)) {
    console.warn("[muse/auth] rate_limited", {
      ip: clientIp(request),
      keyPrefix: row.keyPrefix,
    });
    return { ok: false, status: 429, error: "rate_limited" };
  }

  void touchMuseUsage(clientIp(request));
  return { ok: true, adm };
}
