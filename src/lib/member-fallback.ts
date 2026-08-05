// Canonical fallback family member list, shared by the client cache and the
// server-side PIN verification. PocketBase may have zero (or partial) member
// records — e.g. a fresh dev/integration instance — so both sides merge these
// defaults so login, profile changes, and PIN verification agree.

export const memberFallbacks = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🐱", fullName: "Rebecca Garcia", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0202", avatarSize: "md", glow: false },
  { id: 2, name: "Jeffery (Dad)", role: "parent", emoji: "👨", fullName: "Jeffery Garcia", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", pin: "0828", avatarSize: "md", glow: false },
  { id: 3, name: "Emily", role: "child", emoji: "👧", fullName: "Emily Garcia", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1024", avatarSize: "md", glow: false },
  { id: 4, name: "Bailey", role: "child", emoji: "👧", fullName: "Bailey Garcia", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1005", avatarSize: "md", glow: false },
  { id: 5, name: "Jasmine", role: "child", emoji: "👧", fullName: "Jasmine Garcia", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0402", avatarSize: "md", glow: false },
  { id: 6, name: "Aurora", role: "child", emoji: "👧", fullName: "Aurora Garcia", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1025", avatarSize: "md", glow: false },
  { id: 7, name: "Caspian", role: "child", emoji: "🧒", fullName: "Caspian Garcia", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1010", avatarSize: "md", glow: false },
  { id: 8, name: "Rocco", role: "pet", emoji: "🐶", fullName: "Rocco (Frenchie)", age: 3, joined: "Feb 2024", pin: "0000", avatarSize: "md", glow: false },
  { id: 9, name: "Rico", role: "pet", emoji: "🐩", fullName: "Rico (Poodle)", age: 5, joined: "Feb 2024", pin: "0000", avatarSize: "md", glow: false },
];

// Merge live PB member records with the built-in fallbacks that are missing
// from PB, so client and server see the same member universe. Live records win.
export function mergeMemberFallbacks(pbMembers: any[]): any[] {
  const pbFirstNames = new Set(
    (pbMembers || []).map((m: any) => (m.name || "").split(" ")[0].toLowerCase())
  );
  const missingFallback = memberFallbacks.filter(
    (f: any) => !pbFirstNames.has(f.name.split(" ")[0].toLowerCase())
  );
  return [...(pbMembers || []), ...missingFallback];
}
