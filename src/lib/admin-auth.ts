import { verifyPinAgainstAnyMember } from "./server-auth";

// Gate for the destructive /api/admin/* routes (update, restart, containers,
// version). Three trusted credentials, all fail-closed:
//
//   1. Authorization: Bearer $ADMIN_SECRET — for trusted internal callers
//                     (the chat tool handlers self-fetch these routes).
//                     Server-only env; never exposed to the browser.
//   2. Session cookie — a signed httpOnly consuela_session cookie whose
//                     payload has role !== "child". Used by the browser UI:
//                     middleware already gates /api/** on the same cookie,
//                     so no PIN ever needs to reach the client.
//   3. x-admin-pin  — a family-member PIN verified against PocketBase
//                     (kept for non-session callers). Members with role
//                     "child" are rejected even with a valid PIN: deploying
//                     code / restarting containers is an adults-only action.
//
// When NEITHER applies, every request is rejected.

export interface AdminAuthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function authorizeAdminRequest(request: Request): Promise<AdminAuthResult> {
  const bearer = `Bearer ${process.env.ADMIN_SECRET || ""}`;
  if (process.env.ADMIN_SECRET && request.headers.get("authorization") === bearer) {
    return { ok: true };
  }

  // Valid signed session cookie from the browser UI — adults only.
  const { verifySession, SESSION_COOKIE } = await import("./session");
  const session = await verifySession(
    request instanceof Request ? request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] : undefined
  );
  if (session) {
    if (session.role === "child") return { ok: false, status: 403, error: "adult_only" };
    return { ok: true };
  }

  const pin = request.headers.get("x-admin-pin");
  if (!pin) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const member = await verifyPinAgainstAnyMember(pin);
  if (!member) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (member.role === "child") {
    return { ok: false, status: 403, error: "adult_only" };
  }
  return { ok: true };
}
