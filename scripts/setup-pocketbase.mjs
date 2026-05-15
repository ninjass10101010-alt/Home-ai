import PocketBase from 'pocketbase';
import readline from 'readline';

const pbUrl = process.env.NEXT_PUBLIC_PB_URL || 'http://192.168.0.27:8090';
const pb = new PocketBase(pbUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log(`Connecting to PocketBase at ${pbUrl}...`);
  try {
    await pb.health.check();
    console.log("✅ PocketBase is reachable!");
  } catch (err) {
    console.error("❌ PocketBase is not reachable. Make sure the Docker container is running.");
    process.exit(1);
  }

  console.log("\nTo create the schema, we need admin access.");
  const email = await question('Admin Email: ');
  const password = await question('Admin Password: ');

  try {
    await pb.admins.authWithPassword(email, password);
    console.log("✅ Authenticated successfully!");
  } catch (err) {
    console.error("❌ Authentication failed. Did you create the admin account yet in the PocketBase UI?");
    process.exit(1);
  }

  const collections = [
    {
      name: "members",
      type: "base",
      schema: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "select", options: { values: ["mom", "dad", "son", "daughter", "other"] } },
        { name: "emoji", type: "text" },
        { name: "profileImage", type: "text" }
      ]
    },
    {
      name: "events",
      type: "base",
      schema: [
        { name: "title", type: "text", required: true },
        { name: "date", type: "text" },
        { name: "time", type: "text" },
        { name: "description", type: "text" },
        { name: "memberId", type: "relation", options: { collectionId: "members", maxSelect: 1 } },
        { name: "type", type: "select", options: { values: ["event", "reminder"] } }
      ]
    },
    {
      name: "meals",
      type: "base",
      schema: [
        { name: "name", type: "text", required: true },
        { name: "date", type: "text" },
        { name: "description", type: "text" },
        { name: "ingredients", type: "text" },
        { name: "emoji", type: "text" }
      ]
    },
    {
      name: "tasks",
      type: "base",
      schema: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
        { name: "dueDate", type: "text" },
        { name: "priority", type: "select", options: { values: ["low", "medium", "high"] } },
        { name: "assignedTo", type: "relation", options: { collectionId: "members", maxSelect: 1 } },
        { name: "status", type: "select", options: { values: ["pending", "completed"] } },
        { name: "points", type: "number" },
        { name: "category", type: "text" },
        { name: "emoji", type: "text" },
        { name: "recurring", type: "bool" }
      ]
    },
    {
      name: "rewards",
      type: "base",
      schema: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
        { name: "emoji", type: "text" },
        { name: "cost", type: "number" },
        { name: "isUnlocked", type: "bool" }
      ]
    },
    {
      name: "grocery_items",
      type: "base",
      schema: [
        { name: "name", type: "text", required: true },
        { name: "emoji", type: "text" },
        { name: "category", type: "text" },
        { name: "status", type: "select", options: { values: ["needed", "in_cart", "purchased", "suggested"] } }
      ]
    },
    {
      name: "pantry_items",
      type: "base",
      schema: [
        { name: "name", type: "text", required: true },
        { name: "emoji", type: "text" },
        { name: "category", type: "text" },
        { name: "status", type: "select", options: { values: ["plenty", "enough", "low", "out"] } }
      ]
    },
    {
      name: "schedules",
      type: "base",
      schema: [
        { name: "title", type: "text", required: true },
        { name: "time", type: "text" },
        { name: "days", type: "text" },
        { name: "memberId", type: "relation", options: { collectionId: "members", maxSelect: 1 } },
        { name: "type", type: "select", options: { values: ["routine", "reminder"] } },
        { name: "icon", type: "text" },
        { name: "color", type: "text" }
      ]
    }
  ];

  console.log("\nCreating collections...");
  
  for (const collection of collections) {
    try {
      await pb.collections.create(collection);
      console.log(`✅ Created collection: ${collection.name}`);
    } catch (err) {
      if (err.status === 400 && err.response?.data?.name?.code === 'validation_invalid_format') {
         console.log(`⚠️ Collection ${collection.name} might already exist or has invalid config.`);
      } else {
         console.error(`❌ Failed to create ${collection.name}:`, err.response?.data || err.message);
      }
    }
  }

  console.log("\n🎉 Schema initialization complete!");
  process.exit(0);
}

main();
