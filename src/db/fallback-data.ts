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
  pin: string;
}

export const membersFallback: MemberFallback[] = [
  { id: 1, name: "Rebecca (Mom)", fullName: "Rebecca Garcia", role: "parent", emoji: "🐱", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0202" },
  { id: 2, name: "Jeffery (Dad)", fullName: "Jeffery Garcia", role: "parent", emoji: "👨", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", pin: "0828" },
  { id: 3, name: "Emily", fullName: "Emily Garcia", role: "child", emoji: "👧", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1024" },
  { id: 4, name: "Bailey", fullName: "Bailey Garcia", role: "child", emoji: "👧", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1005" },
  { id: 5, name: "Jasmine", fullName: "Jasmine Garcia", role: "child", emoji: "👧", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0402" },
  { id: 6, name: "Aurora", fullName: "Aurora Garcia", role: "child", emoji: "👧", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1025" },
  { id: 7, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1010" },
  { id: 8, name: "Rocco", fullName: "Rocco (Frenchie)", role: "pet", emoji: "🐶", age: 3, joined: "Feb 2024", skinColor: "", hairColor: "", pin: "0000" },
  { id: 9, name: "Rico", fullName: "Rico (Poodle)", role: "pet", emoji: "🐩", age: 5, joined: "Feb 2024", skinColor: "", hairColor: "", pin: "0000" },
];

// ─── Events ────────────────────────────────────────────────────────────────

export const eventsFallback = [
  { id: 1, title: "Soccer Practice", date: new Date().toISOString().split('T')[0], time: "16:00", member: "Emily", icon: "⚽", color: "violet" },
  { id: 2, title: "Dentist — Bailey", date: new Date().toISOString().split('T')[0], time: "17:30", member: "Bailey", icon: "🦷", color: "amber" },
  { id: 3, title: "Team dinner", date: new Date().toISOString().split('T')[0], time: "19:00", member: "Jeffery (Dad)", icon: "🍽️", color: "cyan" },
];

// ─── Tasks ─────────────────────────────────────────────────────────────────

export const tasksFallback = [
  { id: 1, title: "Take out trash", assigned: "Emily", due: new Date().toISOString().split('T')[0], priority: "medium", status: "pending", points: 15 },
  { id: 2, title: "Grocery run", assigned: "Rebecca (Mom)", due: new Date().toISOString().split('T')[0], priority: "high", status: "pending", points: 20 },
  { id: 3, title: "Clean bathroom", assigned: "Jasmine", due: new Date(Date.now() + 86400000).toISOString().split('T')[0], priority: "medium", status: "completed", points: 15 },
];

// ─── Schedules ─────────────────────────────────────────────────────────────

export const schedulesFallback = [
  { id: 1, title: "Wake up / Morning routine", time: "07:00", days: "weekdays", type: "routine", icon: "⏰", color: "amber" },
  { id: 2, title: "Breakfast", time: "07:30", days: "all", type: "routine", icon: "🥞", color: "green" },
  { id: 3, title: "School / Learning time", time: "08:30", days: "weekdays", type: "routine", icon: "📚", color: "cyan" },
  { id: 4, title: "Lunch", time: "12:00", days: "all", type: "routine", icon: "🍽️", color: "amber" },
  { id: 5, title: "Screen time", time: "15:30", days: "weekdays", type: "routine", icon: "📱", color: "violet" },
  { id: 6, title: "Dinner", time: "18:00", days: "all", type: "routine", icon: "🍝", color: "green" },
  { id: 7, title: "Bedtime routine", time: "20:30", days: "all", type: "routine", icon: "🛁", color: "violet" },
  { id: 8, title: "Lights out", time: "21:00", days: "all", type: "routine", icon: "🌙", color: "rose" },
  { id: 9, title: "Family movie night", time: "19:00", days: "friday", type: "routine", icon: "🎬", color: "cyan" },
  { id: 10, title: "Take medication", time: "08:00", days: "all", memberId: 1, type: "reminder", icon: "💊", color: "rose" },
];

// ─── Emergency Contacts ────────────────────────────────────────────────────

export const emergencyFallback = [
  { id: 1, name: "Parent 1", phone: "+15551234567", email: "parent1@example.com", carrier: "verizon", relationship: "parent", isPrimary: true, emoji: "👩" },
  { id: 2, name: "Parent 2", phone: "+15559876543", email: "parent2@example.com", carrier: "verizon", relationship: "parent", isPrimary: false, emoji: "👨" },
];

// ─── Pantry ────────────────────────────────────────────────────────────────

export const pantryFallback = [
  { id: 101, name: "Olive oil", status: "plenty" },
  { id: 102, name: "Rice", status: "plenty" },
  { id: 103, name: "Pasta", status: "low" },
  { id: 104, name: "Canned tomatoes", status: "plenty" },
  { id: 105, name: "Chicken broth", status: "plenty" },
  { id: 106, name: "Flour", status: "plenty" },
  { id: 107, name: "Sugar", status: "plenty" },
  { id: 108, name: "Salt", status: "plenty" },
  { id: 109, name: "Black pepper", status: "low" },
];

// ─── Grocery List ──────────────────────────────────────────────────────────

export const groceryFallback = [
  { id: 201, name: "Ground beef", category: "meat", aisle: "6", quantity: "1 lb", priority: "high", needed: true },
  { id: 202, name: "Taco shells", category: "pantry", aisle: "8", priority: "medium", needed: true },
  { id: 203, name: "Lettuce", category: "produce", aisle: "1", priority: "medium", needed: true },
  { id: 204, name: "Cheese", category: "dairy", aisle: "4", priority: "low", needed: true },
];

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
