import { withAdmin } from "./pb-auth";
import { memberPinMatches, resolveMemberPin } from "./member-pins";
import { mergeMemberFallbacks } from "./member-fallback";
import { resolveDefaultMemberPin } from "./pb-seed";

export interface ServerMember {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  avatarSize?: string;
  glow?: boolean;
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

export async function verifyPinFromPB(name: string, pin: string): Promise<any | null> {
  if (!name || !pin) return null;
  const member = await findMemberByName(name);
  if (!member) return null;
  if (!memberPinMatches(member, pin)) return null;
  return member;
}

// Verify a PIN against ANY family member's stored PIN (PB is the source of
// truth). Used by routes that only carry a pin (e.g. x-consuela-pin header) —
// mirrors the /api/emergency "verify against any member" convention. Merges
// the built-in fallbacks so pin-less / empty PB instances still verify.
export async function verifyPinAgainstAnyMember(pin: string): Promise<any | null> {
  if (!pin) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const merged = withResolvedPins(mergeMemberFallbacks(records));
    const member = merged.find((r: any) => memberPinMatches(r, pin));
    return member || null;
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
