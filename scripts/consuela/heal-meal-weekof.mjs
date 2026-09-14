#!/usr/bin/env node
// One-time data repair: legacy meal_plan_entries rows created before the
// weekOf convention landed (2026-08-31 kitchen overhaul) carry no `weekOf`,
// and the pre-fix adminUpsertMeal duplicated them instead of updating them.
//
// 1. Every row without `weekOf` gets `weekOf = date ? weekStartForDate(date)
//    : localWeekStartISO()` — the same derivation the dashboard uses. Note the
//    display change this causes: a weekless row was treated as CURRENT-week by
//    every reader, so healing MOVES it to the week its `date` truly belongs to.
//    Correcting that display convention IS the point of the heal.
// 2. Within each (effective weekOf, time, mealType) group, the newest row
//    (by `updated`, falling back to `created`) is kept and the duplicates are
//    deleted — the pile-up the old upsert key created.
//
// DRY-RUN BY DEFAULT — prints every planned action without touching PB.
// Apply for real with:  node scripts/consuela/heal-meal-weekof.mjs --apply
// Optional scope guard (mirrors fix-meal-days-2026-09-02.mjs):
//   --from "2026-09-07"   only heal rows whose effective week is >= that Monday.
//
// Loads .env.local (PB admin creds) like scripts/pb-seed.mjs — never hardcode
// credentials.

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

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fromIdx = args.indexOf("--from");
const FROM = fromIdx !== -1 ? args[fromIdx + 1] : null;
if (FROM !== null && !/^\d{4}-\d{2}-\d{2}$/.test(FROM)) {
  console.error(`❌ --from must be a YYYY-MM-DD date, got "${FROM}"`);
  process.exit(1);
}
const unknown = args.filter((a) => a.startsWith("-") && a !== "--apply" && a !== "--from");
if (unknown.length > 0) {
  console.error("❌ Unknown argument(s):", unknown.join(" "), "— usage: heal-meal-weekof.mjs [--apply] [--from YYYY-MM-DD]");
  process.exit(1);
}

// --- week math ports (kept byte-identical to src/lib/meals-week-utils.ts) ----
// Given a Date, serialize the LOCAL calendar date as YYYY-MM-DD — never
// `.toISOString()` (UTC shifts the day for timezones ahead of UTC).
function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekStartForDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return toLocalISODate(mon);
}

function localWeekStartISO() {
  return weekStartForDate(toLocalISODate(new Date()));
}

const CURRENT_WEEK = localWeekStartISO();

// The effective week of a row under the dashboard-wide convention: a legacy
// weekless row counts as the current week for reads — but for the heal we
// derive the REAL week from its date when one exists, else today's week.
function effectiveWeekOf(row) {
  if (row.weekOf) return row.weekOf;
  return /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") ? weekStartForDate(row.date) : CURRENT_WEEK;
}

function rowLabel(row) {
  return `${row.name || "(unnamed)"} (${row.time}/${row.mealType || "dinner"} id ${row.id})`;
}

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"}: heal meal_plan_entries weekOf + dedupe${FROM ? ` (scope: effective week >= ${FROM})` : ""}`);
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

  // Pull every meal row (paged).
  const rows = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${PB_URL}/api/collections/meal_plan_entries/records?perPage=200&page=${page}`, { headers });
    if (!res.ok) {
      console.error(`❌ list failed: ${res.status} ${JSON.stringify(await res.json()).slice(0, 200)}`);
      process.exit(1);
    }
    const list = await res.json();
    rows.push(...(list.items || []));
    if (!list.items || list.items.length === 0 || page >= (list.totalPages || 1)) break;
    page += 1;
  }
  console.log(`Found ${rows.length} meal_plan_entries rows.`);

  const scoped = FROM ? rows.filter((r) => effectiveWeekOf(r) >= FROM) : rows;
  if (FROM) console.log(`In scope (effective week >= ${FROM}): ${scoped.length} rows (skipped ${rows.length - scoped.length}).`);

  let patched = 0;
  let deleted = 0;

  // Pass 1 — set weekOf on weekless rows.
  for (const row of scoped) {
    if (row.weekOf) continue;
    const weekOf = effectiveWeekOf(row);
    console.log(`\n[${rowLabel(row)}]`);
    console.log(`  before: weekOf=${row.weekOf === undefined ? "(absent)" : row.weekOf} date=${row.date}`);
    console.log(`  after:  weekOf=${weekOf} ${APPLY ? "" : "(dry-run — not written)"}`);
    if (APPLY) {
      const patchedRes = await fetch(`${PB_URL}/api/collections/meal_plan_entries/records/${row.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ weekOf }),
      });
      if (!patchedRes.ok) {
        console.error(`    ❌ patch failed: ${patchedRes.status} ${JSON.stringify(await patchedRes.json()).slice(0, 200)}`);
        process.exitCode = 1;
        continue;
      }
      row.weekOf = weekOf; // keep the in-memory view truthful for pass 2
    }
    patched += 1;
  }

  // Pass 2 — dedupe (effective weekOf, time, mealType) groups, newest wins.
  const groups = new Map();
  for (const row of scoped) {
    const key = `${effectiveWeekOf(row)}|${row.time || ""}|${row.mealType || "dinner"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const stamp = (r) => String(r.updated || r.created || "");
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0));
    const keep = sorted[sorted.length - 1];
    const losers = sorted.slice(0, -1);
    console.log(`\n[group ${key}] keep ${rowLabel(keep)} (updated=${stamp(keep)}), delete ${losers.length} duplicate(s):`);
    for (const loser of losers) {
      console.log(`  - ${rowLabel(loser)} (updated=${stamp(loser)}) ${APPLY ? "" : "(dry-run — not deleted)"}`);
      if (APPLY) {
        const delRes = await fetch(`${PB_URL}/api/collections/meal_plan_entries/records/${loser.id}`, {
          method: "DELETE",
          headers,
        });
        if (!delRes.ok) {
          console.error(`    ❌ delete failed: ${delRes.status} ${JSON.stringify(await delRes.json()).slice(0, 200)}`);
          process.exitCode = 1;
          continue;
        }
      }
      deleted += 1;
    }
  }

  console.log(`\nDone${APPLY ? "" : " (dry-run)"}: ${patched} row(s) ${APPLY ? "weekOf-patched" : "would be weekOf-patched"}, ${deleted} duplicate(s) ${APPLY ? "deleted" : "would be deleted"}.`);
  if (!APPLY) console.log("Re-run with --apply to write. The dashboard Meals planner picks this up on its next cache refresh.");
}

main().catch((e) => {
  console.error("❌ Script failed:", e?.message || e);
  process.exit(1);
});
