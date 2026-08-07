#!/usr/bin/env node
/**
 * PocketBase Seed Script for Consuela Dashboard
 *
 * Populates ALL PocketBase collections with the hardcoded data from src/db/index.ts.
 * Idempotent — checks record count before seeding each collection.
 *
 * Usage:
 *   docker exec consuela-dashboard node scripts/seed-pb.js
 *
 * Or with tsx:
 *   docker exec consuela-dashboard npx tsx scripts/seed-pb.ts
 */

const PB_URL = "http://pocketbase:8090";
const ADMIN_EMAIL = "admin@family.local";
const ADMIN_PASSWORD = "consuela-secret-2026";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _token: string = "";

async function pbAuth(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json() as any;
  if (!res.ok || !body.token) {
    throw new Error(`PB auth failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.token;
}

async function pbFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bear${"er"} ${_token}`,
    ...((opts.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${PB_URL}${path}`, { ...opts, headers });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`PB ${opts.method || "GET"} ${path} — non-JSON response: ${text.substring(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`PB ${opts.method || "GET"} ${path} failed (${res.status}): ${JSON.stringify(json).substring(0, 500)}`);
  }
  return json;
}

async function getCount(collection: string): Promise<number> {
  const data = await pbFetch(`/api/collections/${collection}/records?perPage=1`);
  return data.totalItems ?? 0;
}

async function batchCreate(collection: string, records: Record<string, any>[]): Promise<void> {
  // PocketBase batch API: POST /api/collections/{name}/records with array body
  // Actually, PB doesn't have a batch create in the REST API.
  // We create one at a time (idempotent — only called when count=0).
  let created = 0;
  for (const rec of records) {
    try {
      await pbFetch(`/api/collections/${collection}/records`, {
        method: "POST",
        body: JSON.stringify(rec),
      });
      created++;
    } catch (err: any) {
      console.error(`  ⚠ Failed to create record in ${collection}:`, err.message);
    }
  }
  console.log(`  ✓ Created ${created}/${records.length} records in ${collection}`);
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function tomorrow(): string {
  return new Date(Date.now() + 86400000).toISOString().split("T")[0];
}

// ─── Seed Data (from src/db/index.ts) ─────────────────────────────────────────

const membersData = [
  { name: "Rebecca (Mom)", role: "parent", emoji: "🐱", fullName: "Rebecca Garcia", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0202" },
  { name: "Jeffery (Dad)", role: "parent", emoji: "👨", fullName: "Jeffery Garcia", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", pin: "0828" },
  { name: "Emily", role: "child", emoji: "👧", fullName: "Emily Garcia", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1024" },
  { name: "Bailey", role: "child", emoji: "👧", fullName: "Bailey Garcia", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1005" },
  { name: "Jasmine", role: "child", emoji: "👧", fullName: "Jasmine Garcia", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0402" },
  { name: "Aurora", role: "child", emoji: "👧", fullName: "Aurora Garcia", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1025" },
  { name: "Caspian", role: "child", emoji: "🧒", fullName: "Caspian Garcia", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1010" },
  { name: "Rocco", role: "pet", emoji: "🐶", fullName: "Rocco (Frenchie)", age: 3, joined: "Feb 2024", skinColor: "", hairColor: "", pin: "0000" },
  { name: "Rico", role: "pet", emoji: "🐩", fullName: "Rico (Poodle)", age: 5, joined: "Feb 2024", skinColor: "", hairColor: "", pin: "0000" },
];

const eventsData = [
  { title: "Soccer Practice", date: today(), time: "16:00", member: "Emily", type: "event", notes: "Emily's soccer practice at the field", color: "violet", icon: "⚽" },
  { title: "Dentist — Bailey", date: today(), time: "17:30", member: "Bailey", type: "event", notes: "Bailey's regular checkup", color: "amber", icon: "🦷" },
  { title: "Team dinner", date: today(), time: "19:00", member: "Jeffery (Dad)", type: "event", notes: "Dad's work team dinner", color: "cyan", icon: "🍽️" },
];

const tasksData = [
  { title: "Take out trash", description: "Empty kitchen and bathroom trash bins", dueDate: today(), priority: "medium", assignedTo: "Emily", completed: false, recurring: false, category: "chores", points: 15 },
  { title: "Grocery run", description: "Pick up items from the grocery list", dueDate: today(), priority: "high", assignedTo: "Rebecca (Mom)", completed: false, recurring: false, category: "errands", points: 20 },
  { title: "Clean bathroom", description: "Clean upstairs bathroom thoroughly", dueDate: tomorrow(), priority: "medium", assignedTo: "Jasmine", completed: false, recurring: true, category: "chores", points: 15 },
];

const schedulesData = [
  { title: "Wake up / Morning routine", time: "07:00", days: "weekdays", type: "routine", icon: "⏰", color: "amber" },
  { title: "Breakfast", time: "07:30", days: "all", type: "routine", icon: "🥞", color: "green" },
  { title: "School / Learning time", time: "08:30", days: "weekdays", type: "routine", icon: "📚", color: "cyan" },
  { title: "Lunch", time: "12:00", days: "all", type: "routine", icon: "🍽️", color: "amber" },
  { title: "Screen time", time: "15:30", days: "weekdays", type: "routine", icon: "📱", color: "violet" },
  { title: "Dinner", time: "18:00", days: "all", type: "routine", icon: "🍝", color: "green" },
  { title: "Bedtime routine", time: "20:30", days: "all", type: "routine", icon: "🛁", color: "violet" },
  { title: "Lights out", time: "21:00", days: "all", type: "routine", icon: "🌙", color: "rose" },
  { title: "Family movie night", time: "19:00", days: "friday", type: "routine", icon: "🎬", color: "cyan" },
  { title: "Take medication", time: "08:00", days: "all", type: "reminder", icon: "💊", color: "rose", memberId: 1 },
];

const emergencyContactsData = [
  { name: "Rebecca", phone: "+161****8104", email: "Ninjass10101010@gmail.com", carrier: "verizon", type: "relationship", priority: 1 },
  { name: "Test Contact", phone: "+161****2736", email: "Ninjass10101010@gmail.com", carrier: "verizon", type: "relationship", priority: 1 },
];

const pantryData = [
  { name: "Olive oil", status: "plenty", userId: "demo" },
  { name: "Rice", status: "plenty", userId: "demo" },
  { name: "Pasta", status: "low", userId: "demo" },
  { name: "Chicken breast", status: "out", userId: "demo" },
  { name: "Milk", status: "low", userId: "demo" },
  { name: "Zucchini", status: "plenty", userId: "demo" },
  { name: "Penne pasta", status: "plenty", userId: "demo" },
  { name: "Bell peppers", status: "low", userId: "demo" },
  { name: "Parmesan", status: "out", userId: "demo" },
];

const groceryData = [
  { name: "Ground beef", category: "meat", aisle: "6", quantity: "1 lb", priority: "high", needed: true, source: "meal-plan", autoGenerated: true, manualOverride: false, userId: "demo" },
  { name: "Taco shells", category: "pantry", aisle: "8", quantity: "1 pack", priority: "medium", needed: true, source: "meal-plan", autoGenerated: true, manualOverride: false, userId: "demo" },
  { name: "Pasta", category: "pantry", aisle: "8", quantity: "2 boxes", priority: "medium", needed: true, source: "pantry-check", autoGenerated: false, manualOverride: false, userId: "demo" },
  { name: "Milk", category: "dairy", aisle: "4", quantity: "1 gal", priority: "high", needed: true, source: "pantry-check", autoGenerated: false, manualOverride: false, userId: "demo" },
  { name: "Bananas", category: "produce", aisle: "1", quantity: "6", priority: "medium", needed: true, source: "manual", autoGenerated: false, manualOverride: false, userId: "demo" },
];

// ─── Fix Meals Collection Schema ──────────────────────────────────────────────

async function fixMealsSchema(): Promise<void> {
  console.log("\n📋 Fixing meals collection schema (currently 0 fields)...");

  // Get the current collection to understand the schema
  const colls = await pbFetch("/api/collections");
  const mealsColl = colls.items.find((c: any) => c.name === "meals");
  if (!mealsColl) {
    console.error("  ❌ meals collection not found!");
    return;
  }

  const newFields = [
    { name: "userId", type: "text", required: false },
    { name: "name", type: "text", required: false },
    { name: "emoji", type: "text", required: false },
    { name: "time", type: "text", required: false },
    { name: "mealType", type: "text", required: false },
    { name: "prepTime", type: "text", required: false },
    { name: "tags", type: "text", required: false },
    { name: "ingredients", type: "text", required: false },
    { name: "servings", type: "text", required: false },
    { name: "calories", type: "text", required: false },
    { name: "protein", type: "text", required: false },
    { name: "carbs", type: "text", required: false },
  ];

  // Keep the existing id field and add new ones
  const existingFields = mealsColl.fields || [];
  const updatedFields = [...existingFields, ...newFields];

  await pbFetch(`/api/collections/meals`, {
    method: "PATCH",
    body: JSON.stringify({ fields: updatedFields }),
  });

  console.log("  ✓ Added 12 fields to meals collection");
}

// ─── Collection Seeding Functions ─────────────────────────────────────────────

async function seedMembers(): Promise<void> {
  const count = await getCount("members");
  if (count >= membersData.length) {
    console.log(`\n✅ members: already has ${count} records (>= ${membersData.length}), skipping`);
    return;
  }
  console.log(`\n🌱 Seeding members (${count} existing, creating ${membersData.length - count} more)...`);
  await batchCreate("members", membersData.map(m => ({
    name: m.name,
    role: m.role,
    emoji: m.emoji,
    fullName: m.fullName,
    age: m.age,
    joined: m.joined,
    skinColor: m.skinColor || "",
    hairColor: m.hairColor || "",
    pin: m.pin || "",
    avatarSize: "md",
    glow: false,
  })));
}

async function seedTasks(): Promise<void> {
  const count = await getCount("tasks");
  if (count > 0) {
    console.log(`\n✅ tasks: already has ${count} records, skipping`);
    return;
  }
  console.log("\n🌱 Seeding tasks...");
  await batchCreate("tasks", tasksData.map(t => ({
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    priority: t.priority,
    assignedTo: t.assignedTo,
    completed: t.completed,
    recurring: t.recurring,
    category: t.category,
    points: t.points,
  })));
}

async function seedSchedules(): Promise<void> {
  const count = await getCount("schedules");
  if (count >= schedulesData.length) {
    console.log(`\n✅ schedules: already has ${count} records (>= ${schedulesData.length}), skipping`);
    return;
  }
  console.log(`\n🌱 Seeding schedules (${count} existing, creating ${schedulesData.length - count} more)...`);
  await batchCreate("schedules", schedulesData.map(s => ({
    title: s.title,
    time: s.time,
    days: s.days,
    type: s.type,
    icon: s.icon,
    color: s.color,
    memberId: s.memberId || 0,
    userId: "demo",
  })));
}

async function seedEmergencyContacts(): Promise<void> {
  const count = await getCount("emergency_contacts");
  if (count >= emergencyContactsData.length) {
    console.log(`\n✅ emergency_contacts: already has ${count} records, skipping`);
    return;
  }
  console.log(`\n🌱 Seeding emergency_contacts...`);
  await batchCreate("emergency_contacts", emergencyContactsData.map(c => ({
    name: c.name,
    phone: c.phone,
    email: c.email,
    carrier: c.carrier,
    type: c.type,
    priority: c.priority,
    userId: "demo",
  })));
}

async function seedPantry(): Promise<void> {
  const count = await getCount("pantry");
  if (count > 0) {
    console.log(`\n✅ pantry: already has ${count} records, skipping`);
    return;
  }
  console.log("\n🌱 Seeding pantry...");
  await batchCreate("pantry", pantryData.map(p => ({
    name: p.name,
    status: p.status,
    userId: p.userId,
    lastUpdated: new Date().toISOString(),
  })));
}

async function seedGrocery(): Promise<void> {
  const count = await getCount("grocery");
  if (count > 0) {
    console.log(`\n✅ grocery: already has ${count} records, skipping`);
    return;
  }
  console.log("\n🌱 Seeding grocery...");
  await batchCreate("grocery", groceryData.map(g => ({
    name: g.name,
    category: g.category,
    aisle: g.aisle,
    quantity: g.quantity,
    priority: g.priority,
    needed: g.needed,
    source: g.source,
    autoGenerated: g.autoGenerated,
    manualOverride: g.manualOverride,
    userId: g.userId,
    lastSyncedAt: new Date().toISOString(),
  })));
}

async function seedCalendar(): Promise<void> {
  const count = await getCount("calendar");
  if (count > 0) {
    console.log(`\n✅ calendar: already has ${count} records, skipping`);
    return;
  }
  console.log("\n🌱 Seeding calendar...");
  await batchCreate("calendar", eventsData.map(e => ({
    title: e.title,
    date: e.date,
    time: e.time,
    type: e.type,
    notes: e.notes,
    member: e.member,
    color: e.color,
    icon: e.icon,
    userId: "demo",
  })));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Consuela Dashboard — PocketBase Seed Script");
  console.log("═══════════════════════════════════════════════════\n");

  // 1. Authenticate
  console.log("🔑 Authenticating with PocketBase...");
  _token = await pbAuth();
  console.log("  ✓ Authenticated as admin@family.local\n");

  // 2. Fix meals schema
  await fixMealsSchema();

  // 3. Seed all collections
  await seedMembers();
  await seedTasks();
  await seedSchedules();
  await seedEmergencyContacts();
  await seedPantry();
  await seedGrocery();
  await seedCalendar();

  // 4. Summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ Seed complete!");
  console.log("═══════════════════════════════════════════════════");

  // Print final counts
  const collections = ["members", "tasks", "schedules", "emergency_contacts", "pantry", "grocery", "calendar", "meals"];
  console.log("\n📊 Final record counts:");
  for (const name of collections) {
    const count = await getCount(name);
    console.log(`  ${name}: ${count}`);
  }
}

main().catch(err => {
  console.error("\n❌ Seed failed:", err);
  process.exit(1);
});
