// Shared member-PIN resolution: client login and server-side PIN verification
// must agree on a member's PIN. PocketBase member records may have an empty
// `pin` (the seeder only creates the schema); both sides fall back to the
// known family defaults so a user can sign in with the same PIN everywhere.

const FALLBACK_PINS: Record<string, string> = {
  rebecca: "0202",
  jeffery: "0828",
  emily: "1024",
  bailey: "1005",
  jasmine: "0402",
  aurora: "1025",
  caspian: "1010",
  rocco: "0000",
  rico: "0000",
};

export function resolveMemberPin(member: { name?: string; pin?: string }): string {
  if (member?.pin) return String(member.pin);
  const firstName = (member?.name || "").split(" ")[0].toLowerCase();
  return FALLBACK_PINS[firstName] || "";
}

export function memberPinMatches(member: { name?: string; pin?: string }, pin: string): boolean {
  const resolved = resolveMemberPin(member);
  return !!resolved && resolved === String(pin);
}
