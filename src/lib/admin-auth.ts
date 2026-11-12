import {
  readSessionCookie,
  requireLiveSession,
  sanitizeMember,
  verifyPinAgainstAnyMember,
  verifyPinFromPB,
  type ServerMember,
} from "./server-auth";

// Gate for the destructive /api/admin/* routes (update, restart, containers,
// version). Three trusted credentials, all fail-closed:
//
//   1. Authorization: Bearer $ADMIN_SECRET — for trusted internal callers
//                     (the chat tool handlers self-fetch these routes).
//                     Server-only env; never exposed to the browser.
//   2. Session cookie — a signed httpOnly consuela_session cookie whose live
//                     PocketBase row has role === "parent". Used by the browser
//                     UI: middleware already gates /api/** on the same cookie,
//                     so no PIN ever needs to reach the client. The signed role
//                     is only a claim — a cookie whose live role drifted, or
//                     whose member is gone, is refused.
//   3. x-admin-pin  — a family-member PIN verified against PocketBase
//                     (kept for non-session callers). Only role "parent" is
//                     accepted even with a valid PIN: deploying code /
//                     restarting containers is an adults-only action.
//
// Both the session branch and the PIN branch are a parent ALLOWLIST, matching
// middleware.ts / the chat route / planner-apply. The roster has a third role
// "pet" (default PIN 0000), so a `role === "child"` denylist would let a pet
// through — every non-parent role (child, pet, unknown) is 403 adult_only.
//
// When none applies, every request is rejected.

export interface AdminAuthResult {
  ok: boolean;
  status?: number;
  error?: string;
  member?: ServerMember;
}

export async function authorizeAdminRequest(request: Request): Promise<AdminAuthResult> {
  const bearer = `Bearer ${process.env.ADMIN_SECRET || ""}`;
  if (process.env.ADMIN_SECRET && request.headers.get("authorization") === bearer) {
    return { ok: true };
  }

  if (readSessionCookie(request) !== undefined) {
    // `withMember` so a write can be attributed to the LIVE parent (the
    // `updated_by` contract) instead of the `admin-secret` bearer fallback;
    // the member is sanitized, so the row's PIN never rides along.
    const live = await requireLiveSession(request, { requireRole: "parent", withMember: true });
    if (live.ok) return { ok: true, member: live.member };
    return { ok: false, status: live.status, error: live.error };
  }

  const pin = request.headers.get("x-admin-pin");
  if (!pin) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const member = await verifyPinAgainstAnyMember(pin);
  if (!member) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (member.role !== "parent") {
    return { ok: false, status: 403, error: "adult_only" };
  }
  return { ok: true, member: sanitizeMember(member) as ServerMember };
}

// Strict Parent-PIN action gate for operations that MUST remain locked behind
// a parent's 4-digit PIN even when household profile switching is PIN-free:
//   - Creating, editing, deleting tasks/chores, routines & point/penalty rules
//   - Parent approvals, excusing missed routines, setting kid goals
//   - Editing dashboard configuration, family members/roles/PINs, system/AI admin
//
// Unlike authorizeAdminRequest, a consuela_session cookie with role === "parent"
// NEVER waives the PIN here. Only Authorization: Bearer $ADMIN_SECRET or a live
// PocketBase parent PIN (via x-admin-pin header or body.pin / body.parentPin) passes.
export async function authorizeParentPinRequest(
  request: Request,
  body?: Record<string, unknown> | null,
): Promise<AdminAuthResult> {
  const bearer = `Bearer ${process.env.ADMIN_SECRET || ""}`;
  if (process.env.ADMIN_SECRET && request.headers.get("authorization") === bearer) {
    return { ok: true };
  }

  const headerPin = request.headers.get("x-admin-pin")?.trim() || "";
  const bodyParentPin = typeof body?.parentPin === "string" ? body.parentPin.trim() : "";
  const bodyPin = typeof body?.pin === "string" ? body.pin.trim() : "";
  const pin = headerPin || bodyParentPin || bodyPin;
  if (!pin) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const namedParent =
    typeof body?.parentName === "string" && body.parentName.trim()
      ? body.parentName.trim()
      : "";

  let member: any;
  try {
    member =
      namedParent && bodyParentPin && pin === bodyParentPin
        ? await verifyPinFromPB(namedParent, pin)
        : await verifyPinAgainstAnyMember(pin);
  } catch {
    return { ok: false, status: 503, error: "identity_unavailable" };
  }

  if (!member) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (String(member.role || "").trim().toLowerCase() !== "parent") {
    return { ok: false, status: 403, error: "adult_only" };
  }
  return { ok: true, member: sanitizeMember(member) as ServerMember };
}
