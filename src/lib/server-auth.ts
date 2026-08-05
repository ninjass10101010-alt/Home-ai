import { withAdmin } from "./pb-auth";
import { memberPinMatches } from "./member-pins";

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

function namesMatch(recordName: string, query: string): boolean {
  const firstName = query.split(" ")[0];
  return (
    recordName === query ||
    recordName.startsWith(`${query} `) ||
    recordName.split(" ")[0] === query ||
    recordName === firstName ||
    firstName.startsWith(recordName)
  );
}

export async function findMemberByName(name: string): Promise<any | null> {
  if (!name) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    return records.find((r: any) => namesMatch(r.name, name)) || null;
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
// mirrors the /api/emergency "verify against any member" convention, but with
// the live PB members instead of the in-memory fallback. Pin-less PB records
// resolve through the shared fallback so client and server agree.
export async function verifyPinAgainstAnyMember(pin: string): Promise<any | null> {
  if (!pin) return null;
  return withAdmin(async (pb) => {
    const records = await pb.collection("members").getFullList({ requestKey: null });
    const member = records.find((r: any) => memberPinMatches(r, pin));
    return member || null;
  });
}

export function sanitizeMember(member: any): ServerMember {
  const { pin, ...rest } = member;
  return rest as ServerMember;
}
