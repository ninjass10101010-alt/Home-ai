import { withAdmin } from "./pb-auth";
import { memberPinMatches, resolveMemberPin } from "./member-pins";
import { mergeMemberFallbacks } from "./member-fallback";
import { resolveDefaultMemberPin } from "./pb-seed";
import { SESSION_COOKIE, verifySession } from "./session";
import {
  isSessionRole,
  type SessionIdentity,
  type SessionRole,
} from "./session-policy";

export interface ServerMember {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  avatarSize?: string;
  glow?: boolean;
  age?: number;
  phone?: string;
  email?: string;
}

export function namesMatch(recordName: string, query: string): boolean {
  const firstName = query.split(" ")[0];
  return (
    recordName === query ||
    recordName.startsWith(`${query} `) ||
    recordName.split(" ")[0] === query ||
    recordName === firstName ||
    firstName.startsWith(recordName)
  );
}

// The client-side cache composes live PB members with the built-in fallbacks
// that PB doesn't have (e.g. a fresh dev/integration instance with an empty
// members collection). Mirror that here so server-side PIN verification sees
// the same member universe as the client. Fallback rows carry no pins, so
// members whose PB record has no stored pin yet resolve against the seed-side
// defaults — server-only, never shipped to the browser.
function withResolvedPins(members: any[]): any[] {
  return members.map((m: any) =>
    m.pin ? m : { ...m, pin: resolveDefaultMemberPin(m.name) }
  );
}

export async function findMemberByName(name: string): Promise<any | null> {
  if (!name) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const merged = withResolvedPins(mergeMemberFallbacks(records));
    return merged.find((r: any) => namesMatch(r.name, name)) || null;
  });
}

// Full merged member universe, sanitized: PB rows win, built-in fallbacks fill
// gaps (fresh dev/integration instances), and every pin — stored or seed-side
// default — is stripped before anything leaves the server.
export async function listMembersSanitized(): Promise<any[]> {
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    return withResolvedPins(mergeMemberFallbacks(records)).map(sanitizeMember);
  });
}

// --- PIN attempt throttling (brute-force protection) ---
// Repeated failed verifications from the same source lock that source out
// (5 consecutive failures → 30s lockout, extending on further attempts). A
// successful verification resets the counter. In-memory by design: a restart
// clears state, which is acceptable protection for a LAN dashboard.
const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MS = 30_000;

interface PinThrottleEntry {
  failures: number;
  lockedUntil: number;
}

const pinThrottle = new Map<string, PinThrottleEntry>();

function pinThrottleKey(source: string | undefined, name?: string): string {
  return `${source || "unknown"}|${(name || "").toLowerCase()}`;
}

function checkPinThrottle(key: string): boolean {
  const entry = pinThrottle.get(key);
  if (!entry) return true;
  if (entry.lockedUntil > Date.now()) {
    // A rejected attempt during lockout extends the window (escalation), so a
    // persistent attacker can never wait out the lock.
    entry.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
    pinThrottle.set(key, entry);
    return false;
  }
  return true;
}

function recordPinFailure(key: string): void {
  const entry = pinThrottle.get(key) || { failures: 0, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= PIN_MAX_FAILURES) {
    entry.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
  }
  pinThrottle.set(key, entry);
}

function recordPinSuccess(key: string): void {
  pinThrottle.delete(key);
}

// Test seam — clears all throttle state between tests.
export function __resetPinThrottleForTests(): void {
  pinThrottle.clear();
}

export async function verifyPinFromPB(name: string, pin: string): Promise<any | null> {
  if (!name || !pin) return null;
  const key = pinThrottleKey(undefined, String(name));
  if (!checkPinThrottle(key)) return null;
  const member = await findMemberByName(name);
  if (!member) {
    recordPinFailure(key);
    return null;
  }
  if (!memberPinMatches(member, pin)) {
    recordPinFailure(key);
    return null;
  }
  recordPinSuccess(key);
  return member;
}

// Verify a PIN against ANY family member's stored PIN (PB is the source of
// truth). Used by routes that only carry a pin (e.g. x-consuela-pin header) —
// mirrors the /api/emergency "verify against any member" convention. Merges
// the built-in fallbacks so pin-less / empty PB instances still verify.
export async function verifyPinAgainstAnyMember(pin: string): Promise<any | null> {
  if (!pin) return null;
  const key = pinThrottleKey(undefined);
  if (!checkPinThrottle(key)) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const merged = withResolvedPins(mergeMemberFallbacks(records));
    const member = merged.find((r: any) => memberPinMatches(r, pin));
    if (!member) {
      recordPinFailure(key);
      return null;
    }
    recordPinSuccess(key);
    return member;
  });
}

// Upsert a member record in PB. When the verified member only exists in the
// built-in fallbacks (dev/integration instances with an empty members
// collection), the record is created so profile/PIN changes persist. The
// resolved PIN is stored too, making PB the source of truth from then on.
export async function findOrCreateMemberRecord(
  pb: ReturnType<typeof import("./pb").getAdminPB>,
  actor: any,
  patch: Record<string, unknown>
): Promise<any> {
  const records = await pb.collection("members").getFullList({ requestKey: null });
  const existing = records.find((r: any) => namesMatch(r.name, actor.name));
  if (existing) {
    return pb.collection("members").update(existing.id, patch);
  }
  return pb.collection("members").create({
    name: actor.name,
    pin: resolveMemberPin(actor) || resolveDefaultMemberPin(actor.name),
    emoji: actor.emoji || "😊",
    role: actor.role || "member",
    ...patch,
  });
}

export function sanitizeMember(member: any): ServerMember {
  const { pin, ...rest } = member;
  return rest as ServerMember;
}

// Create a brand-new member row (Settings → Family Members "Add member").
// Mirrors findOrCreateMemberRecord's PIN handling: the request may never carry
// a pin — any client-supplied value is dropped and the seed-side default for
// the name is resolved server-side (MEMBER_DEFAULT_PINS) so the new member can
// log in immediately. Returns null when an existing PB record matches the name
// (the caller maps that to 409 duplicate).
export async function createMemberRecord(
  fields: Record<string, unknown>
): Promise<any | null> {
  const { pin: _ignored, ...clean } = fields;
  const name = String(clean.name || "").trim();
  if (!name) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    if (records.some((r: any) => namesMatch(r.name, name))) return null;
    return pb.collection("members").create({
      ...clean,
      name,
      pin: resolveDefaultMemberPin(name),
    });
  });
}

export type LiveSessionResult =
  | { ok: true; identity: SessionIdentity }
  | { ok: false; status: 401; error: "unauthorized" }
  | {
      ok: false;
      status: 403;
      error: "adult_only" | "session_role_changed";
    }
  | { ok: false; status: 503; error: "identity_unavailable" };

export function readSessionCookie(request: Request): string | undefined {
  return request.headers
    .get("cookie")
    ?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
}

export async function requireLiveSession(
  request: Request,
  options?: { requireRole?: SessionRole },
): Promise<LiveSessionResult> {
  const token = readSessionCookie(request);
  const signed = await verifySession(token);
  if (!signed) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  let member: Record<string, unknown>;
  try {
    member = await withAdmin((pb) =>
      pb.collection("members").getOne(signed.memberId, { requestKey: null }),
    );
  } catch (error) {
    if ((error as { status?: number })?.status === 404) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    return {
      ok: false,
      status: 503,
      error: "identity_unavailable",
    };
  }

  if (!isSessionRole(member.role) || member.role !== signed.role) {
    return {
      ok: false,
      status: 403,
      error: "session_role_changed",
    };
  }

  if (options?.requireRole && member.role !== options.requireRole) {
    return { ok: false, status: 403, error: "adult_only" };
  }

  return {
    ok: true,
    identity: {
      memberId: String(member.id),
      name: String(member.name),
      role: member.role,
    },
  };
}
