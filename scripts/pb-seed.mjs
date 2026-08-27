#!/usr/bin/env node
// PocketBase collection seeder — thin wrapper around the canonical
// seedCollections() in src/lib/pb-seed.ts (single source of truth for all
// app collections, LOCKED_RULES admin-only enforcement, schema/index
// self-heal). Idempotent: safe to re-run after any feature that adds
// collections or fields.
//
// Usage:
//   npm run pb:seed                      (loads .env.local automatically)
//   set -a; source .env.integration; set +a && npx tsx scripts/pb-seed.mjs
//
// Env resolution: already-exported env wins; missing vars fall back to
// .env.local in the repo root (Node's process.loadEnvFile never overrides).

import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.NEXT_PUBLIC_PB_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASS) {
  try {
    process.loadEnvFile(path.join(REPO_ROOT, ".env.local"));
  } catch {
    /* .env.local absent — rely on already-exported env below */
  }
}

const missing = ["NEXT_PUBLIC_PB_URL", "PB_ADMIN_EMAIL", "PB_ADMIN_PASS"].filter(
  (k) => !process.env[k]
);
if (missing.length > 0) {
  console.error("❌ Missing required environment variables:");
  missing.forEach((k) => console.error(`   - ${k}`));
  console.error("\n📋 Copy .env.example to .env.local and fill in your values:");
  console.error("   cp .env.example .env.local");
  process.exit(1);
}

// Import AFTER env resolution — pb.ts/pb-auth.ts capture env at module load.
const { seedCollections } = await import("../src/lib/pb-seed.ts");

console.log(`Seeding PocketBase at ${process.env.NEXT_PUBLIC_PB_URL} …`);
try {
  const created = await seedCollections();
  console.log(`\nDone! ${created.length} collections ready.`);
} catch (err) {
  console.error("Seed failed:", err?.message ?? err);
  if (err?.response?.data) console.error("Details:", JSON.stringify(err.response.data, null, 2));
  if (err?.url) console.error("URL:", err.url);
  process.exit(1);
}
