#!/usr/bin/env node
// One-off data repair: correct two meal rows mis-dated by the UTC vs. Eastern
// clock bug (2026-09-02). The AI assistant resolved "yesterday/today" against
// the UTC server day while the family is in America/Detroit, so meals landed
// one day later than intended.
//
// Confirmed with the user on 2026-09-02:
//   Little Caesars Pizza (dinner) -> Tue 2026-09-01   (was Wed 2026-09-02)
//   Pizza Leftovers (lunch)       -> Wed 2026-09-02   (was Thu 2026-09-03)
//
// Only these two rows are touched. The other rows created in the same
// conversation (Chicken Nuggets, Eggs Ham & Potatoes, Leftovers (Eggs & Ham))
// are intentionally left alone per the user's instruction.
//
// Loads .env.local (PB admin creds) like scripts/pb-seed.mjs.

import path from "node:path";
import { fileURLToPath } from "node:url";

// Script lives at scripts/consuela/<name>.mjs — go up two levels to the repo root
// where .env.local (PB admin creds) lives. Matches scripts/consuela/test-*.mjs.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (!process.env.NEXT_PUBLIC_PB_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASS) {
  try {
    process.loadEnvFile(path.join(REPO_ROOT, ".env.local"));
  } catch {
    /* .env.local absent */
  }
}

const missing = ["NEXT_PUBLIC_PB_URL", "PB_ADMIN_EMAIL", "PB_ADMIN_PASS"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("❌ Missing required environment variables:", missing.join(", "));
  process.exit(1);
}

const PB_URL = process.env.NEXT_PUBLIC_PB_URL;

// id, expected current state, target time/date (weekOf unchanged — it is already 2026-08-31)
const FIXES = [
  {
    id: "26kj9go5ugymmgh", // Little Caesars Pizza
    name: "Little Caesars Pizza",
    from: { time: "Wed", date: "2026-09-02" },
    to: { time: "Tue", date: "2026-09-01" },
  },
  {
    id: "xkzt18bv5flu07n", // Pizza Leftovers
    name: "Pizza Leftovers",
    from: { time: "Thu", date: "2026-09-03" },
    to: { time: "Wed", date: "2026-09-02" },
  },
];

async function main() {
  const authRes = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASS }),
  });
  const auth = await authRes.json();
  const token = auth?.token;
  if (!token) {
    console.error("❌ PB superuser auth failed:", authRes.status, JSON.stringify(auth).slice(0, 200));
    process.exit(1);
  }
  const headers = { Authorization: token };

  for (const fix of FIXES) {
    const beforeRes = await fetch(`${PB_URL}/api/collections/meal_plan_entries/records/${fix.id}`, { headers });
    if (!beforeRes.ok) {
      console.error(`❌ [${fix.name}] read before failed: ${beforeRes.status}`);
      process.exitCode = 1;
      continue;
    }
    const before = await beforeRes.json();
    console.log(`\n[${fix.name}] (id ${fix.id})`);
    console.log(`  before: time=${before.time} date=${before.date} weekOf=${before.weekOf}`);

    const fromMismatch = Object.keys(fix.from).find((key) => before[key] !== fix.from[key]);
    if (fromMismatch) {
      console.error(
        `❌ [${fix.name}] before does not match expected "from" (${fromMismatch}: before=${before[fromMismatch]} expected=${fix.from[fromMismatch]}) — skipping patch`,
      );
      process.exitCode = 1;
      continue;
    }

    const patched = await fetch(`${PB_URL}/api/collections/meal_plan_entries/records/${fix.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(fix.to),
    });
    const after = await patched.json();
    console.log(`  after:  time=${after.time} date=${after.date} weekOf=${after.weekOf} (updated=${patched.ok})`);
    if (!patched.ok) {
      console.error(`    ❌ patch failed: ${patched.status} ${JSON.stringify(after).slice(0, 200)}`);
      process.exitCode = 1;
    }
  }

  console.log("\nDone. The dashboard Meals planner picks these up on its next cache refresh.");
}

main().catch((e) => {
  console.error("❌ Script failed:", e?.message || e);
  process.exit(1);
});
