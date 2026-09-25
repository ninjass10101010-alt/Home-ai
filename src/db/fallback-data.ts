/**
 * Shared Fallback Data
 *
 * Single source of truth for the non-member fallback/demo data.
 * Used by db/pb-db.ts (server PB wrapper) when PocketBase is unreachable.
 *
 * Members are NOT here: the canonical family lives in src/lib/member-fallback.ts
 * behind canonicalMemberFallbacksEnabled(), and both db/index.ts and db/pb-db.ts
 * import it from there.
 */

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
 * Get today's date in YYYY-MM-DD format.
 */
export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
