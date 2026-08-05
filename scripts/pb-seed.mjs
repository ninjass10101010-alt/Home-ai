import { seedCollections } from "../src/lib/pb-seed.ts";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.28:8090";

console.log(`Seeding PocketBase collections at ${PB_URL} ...`);

try {
  const result = await seedCollections();
  console.log("PocketBase collections:", result.join(", "));
  console.log("Seed complete.");
} catch (e) {
  console.error("Seed failed:", e.message);
  process.exit(1);
}
