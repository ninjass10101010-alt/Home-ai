import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL;
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;

// Validate required environment variables
const missing = [];
if (!PB_URL) missing.push('NEXT_PUBLIC_PB_URL');
if (!ADMIN_EMAIL) missing.push('PB_ADMIN_EMAIL');
if (!ADMIN_PASS) missing.push('PB_ADMIN_PASS');

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(v => console.error(`   - ${v}`));
  console.error('\n📋 Copy .env.example to .env.local and fill in your values:');
  console.error('   cp .env.example .env.local');
  process.exit(1);
}

const COLLECTIONS = [
  {
    name: "members",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "color", type: "text" },
      { name: "role", type: "text" },
      { name: "avatarSize", type: "text" },
      { name: "glow", type: "bool" },
      { name: "pin", type: "text" },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "meal_plan_entries",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "time", type: "text" },
      { name: "mealType", type: "text" },
      { name: "prepTime", type: "text" },
      { name: "tags", type: "json" },
      { name: "ingredients", type: "json" },
      { name: "servings", type: "number" },
      { name: "calories", type: "number" },
      { name: "protein", type: "number" },
      { name: "carbs", type: "number" },
      { name: "fat", type: "number" },
      { name: "instructions", type: "text" },
      { name: "image", type: "text" },
    ],
  },
  {
    name: "recipes",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "prepTime", type: "text" },
      { name: "cookTime", type: "text" },
      { name: "tags", type: "json" },
      { name: "ingredients", type: "json" },
      { name: "instructions", type: "text" },
      { name: "servings", type: "number" },
      { name: "calories", type: "number" },
      { name: "image", type: "text" },
      { name: "source", type: "text" },
      { name: "favorite", type: "bool" },
    ],
  },
  {
    name: "pantry_items",
    schema: [
      { name: "item", type: "text", required: true },
      { name: "status", type: "select", options: { values: ["plenty", "low", "out"] } },
      { name: "category", type: "text" },
    ],
  },
  {
    name: "grocery_list_items",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "category", type: "text" },
      { name: "aisle", type: "text" },
      { name: "quantity", type: "text" },
      { name: "priority", type: "select", options: { values: ["low", "medium", "high"] } },
      { name: "needed", type: "bool" },
      { name: "manualOverride", type: "bool" },
      { name: "source", type: "text" },
    ],
  },
  {
    name: "events",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "date", type: "text" },
      { name: "time", type: "text" },
      { name: "icon", type: "text" },
      { name: "color", type: "text" },
      { name: "member", type: "text" },
    ],
  },
  {
    name: "schedules",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "time", type: "text" },
      { name: "icon", type: "text" },
      { name: "type", type: "text" },
      { name: "color", type: "text" },
      { name: "days", type: "json" },
      { name: "member", type: "text" },
    ],
  },
  {
    name: "tasks",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "assigned", type: "text" },
      { name: "due", type: "text" },
      { name: "points", type: "number" },
      { name: "priority", type: "select", options: { values: ["low", "medium", "high"] } },
      { name: "status", type: "select", options: { values: ["pending", "done"] } },
    ],
  },
  {
    name: "emergency_contacts",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
      { name: "carrier", type: "text" },
      { name: "isPrimary", type: "bool" },
    ],
  },
];

async function main() {
  const pb = new PocketBase(PB_URL);

  // The superuser was already created via CLI (pocketbase superuser upsert)
  await pb.collection("_superusers").authWithPassword(ADMIN_EMAIL, ADMIN_PASS);
  console.log("Authenticated as superuser.");

  const existing = (await pb.collections.getFullList()).map((c) => c.name);

  for (const col of COLLECTIONS) {
    if (existing.includes(col.name)) {
      console.log(`  ✓ ${col.name} (exists)`);
      continue;
    }
    try {
      await pb.collections.create({
        name: col.name,
        type: "base",
        schema: col.schema.map((s) => {
          const base = { name: s.name, type: s.type, required: s.required ?? false };
          if (s.type === "select" && s.options) base.options = s.options;
          if (s.type === "json") base.type = "json";
          return base;
        }),
        indexes: col.indexes || [],
      });
      console.log(`  + ${col.name}`);
    } catch (e) {
      console.error(`  ✗ ${col.name}:`, e.message);
      if (e.response?.data) console.error("    ", JSON.stringify(e.response.data));
    }
  }

  console.log("\nDone! All collections ready.");
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  if (err.response?.data) console.error("Details:", JSON.stringify(err.response.data, null, 2));
  if (err.url) console.error("URL:", err.url);
  process.exit(1);
});
