/**
 * Shared Fallback Data
 * 
 * Single source of truth for all fallback/demo data.
 * Used by both db/index.ts (client cache layer) and db/pb-db.ts (server PB wrapper)
 * when PocketBase is unreachable.
 * 
 * This eliminates duplication between the two database layers.
 */

// ─── Members ───────────────────────────────────────────────────────────────

export interface MemberFallback {
  id: number;
  name: string;
  fullName: string;
  role: string;
  emoji: string;
  age: number;
  joined: string;
  skinColor: string;
  hairColor: string;
}

// No `pin` fields here — real PINs live in PocketBase; seed-side defaults are
// server-only (src/lib/pb-seed.ts). The browser bundle never carries them.
export const membersFallback: MemberFallback[] = [
  { id: 1, name: "Rebecca (Mom)", fullName: "Rebecca Garcia", role: "parent", emoji: "🐱", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309" },
  { id: 2, name: "Jeffery (Dad)", fullName: "Jeffery Garcia", role: "parent", emoji: "👨", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af" },
  { id: 3, name: "Emily", fullName: "Emily Garcia", role: "child", emoji: "👧", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6" },
  { id: 4, name: "Bailey", fullName: "Bailey Garcia", role: "child", emoji: "👧", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534" },
  { id: 5, name: "Jasmine", fullName: "Jasmine Garcia", role: "child", emoji: "👧", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309" },
  { id: 6, name: "Aurora", fullName: "Aurora Garcia", role: "child", emoji: "👧", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6" },
  { id: 7, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534" },
  { id: 8, name: "Rocco", fullName: "Rocco (Frenchie)", role: "pet", emoji: "🐶", age: 3, joined: "Feb 2024", skinColor: "", hairColor: "" },
  { id: 9, name: "Rico", fullName: "Rico (Poodle)", role: "pet", emoji: "🐩", age: 5, joined: "Feb 2024", skinColor: "", hairColor: "" },
];

// ─── Events ────────────────────────────────────────────────────────────────

export const eventsFallback: any[] = [];

export const tasksFallback: any[] = [];

export const schedulesFallback: any[] = [];

export const emergencyFallback = [
  { id: 1, name: "Parent 1", phone: "+15551234567", email: "parent1@example.com", carrier: "verizon", relationship: "parent", isPrimary: true, emoji: "👩" },
  { id: 2, name: "Parent 2", phone: "+15559876543", email: "parent2@example.com", carrier: "verizon", relationship: "parent", isPrimary: false, emoji: "👨" },
];

export const pantryFallback: any[] = [];

export const groceryFallback: any[] = [];

// ─── Utilities ─────────────────────────────────────────────────────────────

export const memberColor = (i: number) =>
  ["green", "cyan", "violet", "amber", "rose", "blue", "cyan", "green", "cyan"][i % 9] || "green";

/**
 * Find a member by name (first name match or full name match).
 */
export function findMemberByName(name: string): MemberFallback | undefined {
  const search = name.toLowerCase();
  return membersFallback.find(
    (m) => m.name.toLowerCase() === search || 
           m.fullName.toLowerCase() === search ||
           m.name.toLowerCase().startsWith(search)
  );
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
