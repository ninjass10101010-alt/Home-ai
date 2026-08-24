// Pure member-PIN resolution against a record's stored pin. There are NO
// default pins here: the known family defaults live server-side only (see
// MEMBER_DEFAULT_PINS in src/lib/pb-seed.ts) so they never reach the browser
// bundle. Server-side verification applies them after merging PB records with
// the fallbacks; client code only ever sees pins that PocketBase itself
// served for the signed-in flow's own records.

export function resolveMemberPin(member: { name?: string; pin?: string }): string {
  return member?.pin ? String(member.pin) : "";
}

export function memberPinMatches(member: { name?: string; pin?: string }, pin: string): boolean {
  const resolved = resolveMemberPin(member);
  return !!resolved && resolved === String(pin);
}
