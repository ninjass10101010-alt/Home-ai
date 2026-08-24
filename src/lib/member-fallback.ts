// Canonical fallback family member list, shared by the client cache and the
// server-side identity checks. PocketBase may have zero (or partial) member
// records — e.g. a fresh dev/integration instance — so both sides merge these
// defaults so login, profile changes, and verification agree.
//
// SECURITY: these fallback rows carry no credentials whatsoever. Access codes
// are stored in PocketBase; seed-side defaults live only in pb-seed.ts and
// must never be imported into anything reachable by the browser bundle.

export const memberFallbacks = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🐱", fullName: "Rebecca Garcia", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", avatarSize: "md", glow: false },
  { id: 2, name: "Jeffery (Dad)", role: "parent", emoji: "👨", fullName: "Jeffery Garcia", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", avatarSize: "md", glow: false },
  { id: 3, name: "Emily", role: "child", emoji: "👧", fullName: "Emily Garcia", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", avatarSize: "md", glow: false },
  { id: 4, name: "Bailey", role: "child", emoji: "👧", fullName: "Bailey Garcia", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", avatarSize: "md", glow: false },
  { id: 5, name: "Jasmine", role: "child", emoji: "👧", fullName: "Jasmine Garcia", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", avatarSize: "md", glow: false },
  { id: 6, name: "Aurora", role: "child", emoji: "👧", fullName: "Aurora Garcia", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", avatarSize: "md", glow: false },
  { id: 7, name: "Caspian", role: "child", emoji: "🧒", fullName: "Caspian Garcia", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", avatarSize: "md", glow: false },
  { id: 8, name: "Rocco", role: "pet", emoji: "🐶", fullName: "Rocco (Frenchie)", age: 3, joined: "Feb 2024", avatarSize: "md", glow: false },
  { id: 9, name: "Rico", role: "pet", emoji: "🐩", fullName: "Rico (Poodle)", age: 5, joined: "Feb 2024", avatarSize: "md", glow: false },
];

// Merge live PB member records with the built-in fallbacks that are missing
// from PB, so client and server see the same member universe. Live records win.
export function mergeMemberFallbacks(pbMembers: any[]): any[] {
  // Guard against corrupt rows (e.g. a blank member record left behind by a
  // failed profile save): a member with no name can never render, match a PIN,
  // or be addressed — drop it here so every consumer (client cache, server
  // auth) is protected and the fallbacks for the missing real members still
  // get merged in.
  const live = (pbMembers || []).filter((m: any) => (m.name || "").trim());
  const pbFirstNames = new Set(
    live.map((m: any) => m.name.split(" ")[0].toLowerCase())
  );
  const missingFallback = memberFallbacks.filter(
    (f: any) => !pbFirstNames.has(f.name.split(" ")[0].toLowerCase())
  );
  return [...live, ...missingFallback];
}
