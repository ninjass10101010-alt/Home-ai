// Request-time authorization for the MUSE tool surface (Task 8 / B2).
//
// A MUSE caller proves identity with `Authorization: Bearer <muse-token>`
// (minted by /api/muse/auth/login). The token is checked against the LIVE
// singleton row, so disabling the identity or bumping its version revokes
// outstanding tokens. Admin is the intersection of the token's `adm` claim
// and the row's current `adminEnabled` — a token minted with admin rights
// stops being admin the moment the toggle is switched off.

import type { NextRequest } from "next/server";
import { verifyMuseToken } from "./token";
import { readMuseRow, touchMuseUsage } from "./store";

export type MuseAuthResult =
  | { ok: true; adm: boolean }
  | { ok: false; status: number; error: string };

/** Best-effort client IP for rate limiting + usage stamps. */
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

  // Both the token claim AND the live row toggle must be true.
  const adm = result.adm && row.adminEnabled;
  void touchMuseUsage(clientIp(request));
  return { ok: true, adm };
}
