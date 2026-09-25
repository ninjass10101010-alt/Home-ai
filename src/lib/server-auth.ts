import { randomInt } from "node:crypto";
import { withKeyedLock } from "@/lib/keyed-lock";
import { withAdmin } from "./pb-auth";
import { memberPinMatches } from "./member-pins";
import { mergeMemberFallbacks } from "./member-fallback";
import { resolveDefaultMemberPin } from "./pb-seed";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

export interface ServerMember {
  id: string;
  pbId?: string;
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

export interface CurrentParentAuthResult {
  ok: boolean;
  status?: number;
  error?: string;
  member?: ServerMember;
  session?: SessionPayload;
}

function sessionCookieValue(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") || "";
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return entry?.slice(SESSION_COOKIE.length + 1) || undefined;
}

export async function authorizeCurrentMemberRequest(request: Request): Promise<CurrentParentAuthResult> {
  const session = await verifySession(sessionCookieValue(request));
  if (!session) return { ok: false, status: 401, error: "unauthorized" };
  try {
    const member = await withAdmin((pb) => pb.collection("members").getOne(session.memberId, { requestKey: null }));
    if (!member) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: true, member: sanitizeMember(member), session };
  } catch (error: any) {
    if (error?.status === 404) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: false, status: 503, error: "identity_unavailable" };
  }
}

export async function authorizeCurrentParentRequest(request: Request): Promise<CurrentParentAuthResult> {
  const auth = await authorizeCurrentMemberRequest(request);
  if (!auth.ok) return auth;
  if (String(auth.member?.role || "").toLowerCase() !== "parent") {
    return { ok: false, status: 403, error: "adult_only" };
  }
  return auth;
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

function normalizeMemberName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function fuzzyMemberNameMatches(recordName: string, query: string): boolean {
  const normalizedRecord = normalizeMemberName(recordName);
  const normalizedQuery = normalizeMemberName(query);
  if (!normalizedRecord || !normalizedQuery) return false;
  if (namesMatch(normalizedRecord, normalizedQuery)) return true;
  const recordFirstName = normalizedRecord.split(" ")[0];
  const queryFirstName = normalizedQuery.split(" ")[0];
  return recordFirstName.startsWith(queryFirstName) || queryFirstName.startsWith(recordFirstName);
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

export const MEMBER_ADMIN_LOCK_KEY = "member-admin";

export async function findLiveMemberByName(name: string): Promise<any | null> {
  if (!name) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    return records.find((row: any) => namesMatch(row.name, name)) || null;
  });
}

export async function findLiveMemberById(id: string | undefined): Promise<any | null> {
  if (!id) return null;
  return withAdmin(async (pb) => {
    try {
      return await pb.collection("members").getOne(id, { requestKey: null });
    } catch (error: any) {
      if (error?.status === 404) return null;
      throw error;
    }
  });
}

export async function findLiveMemberByExactName(name: string | undefined): Promise<any | null> {
  if (!name) return null;
  const normalizedName = normalizeMemberName(name);
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const matches = records.filter((row: any) => normalizeMemberName(row.name) === normalizedName);
    return matches.length === 1 ? matches[0] : null;
  });
}

export function withMemberAdminOperation<T>(fn: () => Promise<T>): Promise<T> {
  return withKeyedLock(MEMBER_ADMIN_LOCK_KEY, fn);
}

export async function isMemberPinAvailable(pin: string, targetId?: string): Promise<boolean> {
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const credentials = withResolvedPins(mergeMemberFallbacks(records));
    return !credentials.some((row: any) => String(row.pin) === pin && String(row.id) !== String(targetId));
  });
}

export async function verifyPinForMemberId(memberId: string, pin: string): Promise<any | null> {
  if (!memberId || !pin) return null;
  const key = pinThrottleKey(undefined, memberId);
  if (!checkPinThrottle(key)) return null;
  const member = await findLiveMemberById(memberId);
  const resolved = member ? withResolvedPins([member])[0] : null;
  if (!resolved || !memberPinMatches(resolved, pin)) {
    recordPinFailure(key);
    return null;
  }
  recordPinSuccess(key);
  return resolved;
}

export async function findMemberByName(name: string): Promise<any | null> {
  if (!name) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const merged = withResolvedPins(mergeMemberFallbacks(records));
    const normalized = normalizeMemberName(name);
    const exact = merged.filter((row: any) => normalizeMemberName(row.name) === normalized);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const fuzzy = merged.filter((row: any) => fuzzyMemberNameMatches(String(row.name || ""), name));
    return fuzzy.length === 1 ? fuzzy[0] : null;
  });
}

// Live PB member rows, sanitized: fallback-only rows are not returned here, and
// every pin is stripped before anything leaves the server.
export async function listLiveMembersSanitized(): Promise<any[]> {
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    return records.map(sanitizeMember);
  });
}

export async function listMembersSanitized(): Promise<any[]> {
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    return withResolvedPins(mergeMemberFallbacks(records)).map(sanitizeMember);
  });
}

// --- PIN attempt throttling (brute-force protection) ---
// Named verification uses the resolved live member ID as its throttle key; the
// any-member PIN path uses a shared source key. Failed attempts lock that key
// for 30 seconds after five failures, extending on rejected attempts during
// lockout, while a successful verification resets it. State is process-local.
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
  const member = await findMemberByName(name);
  const key = pinThrottleKey(undefined, String(member?.id || name));
  if (!checkPinThrottle(key)) return null;
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

// Update the exact live PB record identified by the actor's pbId/id. Synthetic
// fallback rows are read-only and cannot be mutated.
export async function findOrCreateMemberRecord(
  pb: ReturnType<typeof import("./pb").getAdminPB>,
  actor: any,
  patch: Record<string, unknown>
): Promise<any> {
  const actorId = typeof actor?.pbId === "string"
    ? actor.pbId
    : typeof actor?.id === "string"
      ? actor.id
      : null;
  if (!actorId) return null;
  const record = await pb.collection("members").getOne(actorId, { requestKey: null });
  return pb.collection("members").update(record.id, patch, { requestKey: null });
}

export function sanitizeMember(member: any): ServerMember {
  const { pin, ...rest } = member;
  return {
    ...rest,
    ...(typeof member?.id === "string" ? { pbId: member.id } : {}),
  } as ServerMember;
}

function generateUniquePin(used: Set<string>): string {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const pin = randomInt(0, 10_000).toString().padStart(4, "0");
    if (!used.has(pin)) return pin;
  }
  throw new Error("member_pin_space_exhausted");
}

export async function createMemberRecord(
  fields: Record<string, unknown>
): Promise<any | null> {
  const { pin: _ignored, ...clean } = fields;
  const name = String(clean.name || "").trim();
  if (!name) return null;
  return withMemberAdminOperation(() => withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const normalizedName = normalizeMemberName(name);
    if (records.some((r: any) => normalizeMemberName(r.name) === normalizedName)) return null;
    const credentialRows = withResolvedPins(mergeMemberFallbacks(records));
    const used = new Set(credentialRows.map((r: any) => String(r.pin || "")).filter(Boolean));
    const seeded = resolveDefaultMemberPin(name);
    const pin = seeded && !used.has(seeded) ? seeded : generateUniquePin(used);
    return pb.collection("members").create({
      ...clean,
      name,
      pin,
    });
  }));
}
