// Pure member-PIN resolution against a record's stored pin. There are NO
// default pins here: the known family defaults live server-side only (see
// MEMBER_DEFAULT_PINS in src/lib/pb-seed.ts) so they never reach the browser
// bundle. Server-side verification applies them after merging PB records with
// the fallbacks; client code only ever sees pins that PocketBase itself
// served for the signed-in flow's own records.

export function resolveMemberPin(member: { name?: string; pin?: string }): string {
  return member?.pin ? String(member.pin) : "";
}

// A credential comparison that returns the FIRST difference, so the work a wrong
// PIN costs is a function of how much of it was right: one correct leading digit
// is measurably more expensive than none. This walks the whole comparison and
// folds the length difference into the result instead, so the answer is the only
// thing the caller can learn from how long the call took.
//
// `node:crypto` is deliberately NOT used here. `src/db/index.ts` verifies a
// member PIN in client mode, so this module is in the browser bundle and a Node
// builtin in it breaks the client build. The digest-then-`timingSafeEqual`
// idiom therefore stays server-side, where it already lives: `timingSafePinEquals`
// in src/app/api/emergency/route.ts.
export function constantTimeEquals(a: string, b: string): boolean {
  // `charCodeAt` is NaN past the end of a string; `| 0` folds that to 0 so an
  // out-of-range read cannot poison the accumulator with NaN.
  const width = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < width; index += 1) {
    difference |= (a.charCodeAt(index) | 0) ^ (b.charCodeAt(index) | 0);
  }
  return difference === 0;
}

export function memberPinMatches(member: { name?: string; pin?: string }, pin: string): boolean {
  const resolved = resolveMemberPin(member);
  const candidate = String(pin);
  // Fail closed on either side being empty. This is load-bearing, not tidiness:
  // with both sides empty a plain constant-time compare would answer "equal" and
  // accept a member with no PIN against a request with no PIN.
  if (!resolved || !candidate) return false;
  return constantTimeEquals(resolved, candidate);
}
