#!/usr/bin/env node
// Integration test for morning_briefing PB collection + DB layer (Task 4.1).
//
// Usage:
//   set -a; source .env.integration; set +a
//   npx tsx scripts/consuela/test-briefing.mjs
//
// What it verifies (C4):
//   1. Seed creates the collection with the right fields + unique index; re-run idempotent
//   2. upsertMorningBriefing creates a row
//   3. upsert same scopeDate updates the row, does not duplicate (count == 1)
//   4. selectMorningBriefing(scopeDate) returns the row
//   5. ackMorningBriefing flips acknowledged
//   6. selectMorningBriefing() (no arg) returns the most recent row
//   7. I7: localTodayISO anchors to the local calendar day (TZ=America/Los_Angeles
//      test where UTC has already rolled to the next date)
//
// Uses a far-future scopeDate (2099-12-31) so the test never collides with real
// briefing data, and cleans up its rows via the admin REST API at the end.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../../src/db/index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
const TSCLI = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

const TEST_SCOPE_DATE = "2099-12-31";
const SUMMARY_V1 = {
  events: [{ title: "Soccer practice", time: "16:00" }],
  tasks: [{ title: "Take out trash", points: 15 }],
  meals: [{ title: "Taco Night" }],
  conflicts: [],
  suggestions: ["Pantry is low on pasta"],
};
const SUMMARY_V2 = {
  events: [],
  tasks: [],
  meals: [{ title: "BBQ Ribs" }],
  conflicts: [{ title: "Dentist vs Soccer" }],
  suggestions: [],
};

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

function getIndexNames(indexes) {
  if (!indexes || !indexes.length) return new Set();
  return new Set(
    indexes.map((i) => {
      if (typeof i === "string") {
        const match = i.match(/INDEX\s+(\S+)\s+ON/i);
        return match ? match[1] : i;
      }
      return i.name;
    })
  );
}

async function pbAdminToken() {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    throw new Error("PB_ADMIN_EMAIL / PB_ADMIN_PASS missing - load .env.integration first");
  }
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`PB admin auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).token;
}

async function pbJson(path_, token, init = {}) {
  const res = await fetch(`${PB_URL}${path_}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: token } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PB ${path_} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function runSeed() {
  return execFileSync(TSCLI, [path.join(REPO_ROOT, "scripts", "pb-seed.mjs")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_PB_URL: PB_URL,
      PB_ADMIN_EMAIL: ADMIN_EMAIL,
      PB_ADMIN_PASS: ADMIN_PASS,
    },
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function cleanupTestRows(token) {
  try {
    const filter = encodeURIComponent(`scopeDate="${TEST_SCOPE_DATE}"`);
    const data = await pbJson(`/api/collections/morning_briefing/records?filter=${filter}&perPage=100`, token);
    for (const r of data.items || []) {
      await fetch(`${PB_URL}/api/collections/morning_briefing/records/${r.id}`, {
        method: "DELETE",
        headers: { authorization: token },
      });
    }
  } catch { /* ok if cleanup fails */ }
}

async function countTestRows(token) {
  const filter = encodeURIComponent(`scopeDate="${TEST_SCOPE_DATE}"`);
  const data = await pbJson(`/api/collections/morning_briefing/records?filter=${filter}&perPage=100`, token);
  return (data.items || []).length;
}

async function main() {
  console.log(`PB: ${PB_URL} | test scopeDate: ${TEST_SCOPE_DATE}`);

  let adminToken;
  await step("authenticate with PB admin", async () => {
    adminToken = await pbAdminToken();
  });

  // --- 1. Seed ---
  let seedOutput = "";
  await step("run pb-seed.mjs", async () => {
    seedOutput = runSeed();
    console.log(`  seed output: ${seedOutput.trim().split("\n").pop() || seedOutput.trim()}`);
  });

  await step("seed output mentions morning_briefing", () => {
    assert.ok(
      seedOutput.includes("morning_briefing"),
      `seed output missing morning_briefing: ${seedOutput.slice(0, 200)}`
    );
  });

  let collection = null;
  await step("collection morning_briefing exists with 4 fields", async () => {
    collection = await pbJson("/api/collections/morning_briefing", adminToken);
    const customFields = (collection.fields || collection.schema || []).filter((f) => f.name !== "id");
    assert.equal(
      customFields.length,
      4,
      `expected 4 custom fields, got ${customFields.length}: ${customFields.map((f) => f.name).join(", ")}`
    );
  });

  const expectedFields = [
    { name: "scopeDate", type: "text", required: true },
    { name: "summary", type: "json" },
    { name: "generatedAt", type: "date" },
    { name: "acknowledged", type: "bool" },
  ];
  for (const f of expectedFields) {
    await step(`field ${f.name} is type ${f.type}${f.required ? " (required)" : ""}`, () => {
      const field = (collection.fields || collection.schema || []).find((s) => s.name === f.name);
      assert.ok(field, `field ${f.name} missing`);
      assert.equal(field.type, f.type);
      if (f.required) assert.equal(field.required, true);
    });
  }

  await step("unique index idx_scope_unique exists on scopeDate", () => {
    const names = getIndexNames(collection.indexes);
    assert.ok(names.has("idx_scope_unique"), `idx_scope_unique not in indexes: ${[...names].join(", ")}`);
    const idx = (collection.indexes || []).find((i) =>
      typeof i === "string"
        ? /idx_scope_unique/i.test(i) && /UNIQUE/i.test(i)
        : i.name === "idx_scope_unique" && i.unique
    );
    assert.ok(idx, "idx_scope_unique should be unique");
    const sql = typeof idx === "string" ? idx : idx.create?.query || "";
    assert.ok(
      typeof idx !== "string" || /scopeDate/i.test(sql),
      "unique index should be on scopeDate"
    );
  });

  await step("re-run seed is idempotent", async () => {
    const output2 = runSeed();
    assert.ok(
      output2.includes("morning_briefing") &&
        (output2.includes("already exists") || output2.includes("patched")),
      `expected "already exists" or "patched" for morning_briefing, got: ${output2.slice(0, 300)}`
    );
  });

  // --- 2/3. upsert: create then update, no duplicates ---
  await step("cleanup: remove any pre-existing test rows", async () => {
    await cleanupTestRows(adminToken);
  });

  let firstId = null;
  await step("upsertMorningBriefing creates a row", async () => {
    const rec = await db.upsertMorningBriefing(TEST_SCOPE_DATE, SUMMARY_V1);
    assert.ok(rec && rec.id, `expected created row with id, got ${JSON.stringify(rec).slice(0, 200)}`);
    firstId = rec.id;
    assert.equal(rec.scopeDate, TEST_SCOPE_DATE);
    assert.equal(rec.acknowledged, false, "new row should default acknowledged=false");
    assert.deepEqual(rec.summary, SUMMARY_V1, "summary should be stored as the passed object");
    console.log(`  created ${rec.id}`);
  });

  let secondId = null;
  await step("upsert same scopeDate updates, no duplicate (count == 1)", async () => {
    const rec = await db.upsertMorningBriefing(TEST_SCOPE_DATE, SUMMARY_V2);
    assert.ok(rec && rec.id, "expected updated row");
    secondId = rec.id;
    assert.equal(secondId, firstId, "update should reuse the same row id");
    assert.deepEqual(rec.summary, SUMMARY_V2, "summary should be replaced");

    const count = await countTestRows(adminToken);
    assert.equal(count, 1, `expected exactly 1 row, got ${count}`);
    console.log(`  rows for scopeDate: ${count}`);
  });

  // --- 4. select by scopeDate ---
  await step("selectMorningBriefing(scopeDate) returns the row", async () => {
    const rec = await db.selectMorningBriefing(TEST_SCOPE_DATE);
    assert.ok(rec, "expected a row");
    assert.equal(rec.id, firstId);
    assert.equal(rec.scopeDate, TEST_SCOPE_DATE);
    assert.deepEqual(rec.summary, SUMMARY_V2);
    assert.ok(rec.generatedAt, "generatedAt should be set");
  });

  // --- 5/6. ack + select reflects it ---
  await step("ackMorningBriefing flips acknowledged", async () => {
    const rec = await db.ackMorningBriefing(firstId);
    assert.equal(rec.acknowledged, true);
  });

  await step("selectMorningBriefing reflects acknowledged=true", async () => {
    const rec = await db.selectMorningBriefing(TEST_SCOPE_DATE);
    assert.equal(rec.acknowledged, true);
  });

  await step("selectMorningBriefing() without scopeDate returns the row (latest)", async () => {
    const rec = await db.selectMorningBriefing();
    assert.ok(rec, "expected a row");
    assert.equal(rec.id, firstId, "test row (2099-12-31) should be the most recent");
    assert.equal(rec.acknowledged, true);
  });

  await step("re-upsert preserves acknowledged=true", async () => {
    const rec = await db.upsertMorningBriefing(TEST_SCOPE_DATE, SUMMARY_V1);
    assert.equal(rec.id, firstId, "still the same row");
    assert.equal(rec.acknowledged, true, "ack state should survive a same-day re-upsert");
    assert.deepEqual(rec.summary, SUMMARY_V1);
  });

  // --- I7: localTodayISO anchors to the local calendar day ---
  await step("localTodayISO follows the local day, not UTC (I7)", async () => {
    const prevTZ = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const { localTodayISO, localPreviousDayISO } = await import("../../src/lib/local-date.ts");
      // 2026-08-06 06:30Z == 2026-08-05 23:30 PT (PDT, UTC-7): UTC already rolled
      // to Aug 6 while the family's local day is still Aug 5.
      assert.equal(
        localTodayISO(new Date("2026-08-06T06:30:00Z")),
        "2026-08-05",
        "LA local day must win over the UTC date"
      );
      assert.equal(
        localTodayISO(new Date("2026-08-06T18:00:00Z")),
        "2026-08-06",
        "midday local is the same day"
      );
      process.env.TZ = "UTC";
      assert.equal(localTodayISO(new Date("2026-08-06T06:30:00Z")), "2026-08-06", "UTC env sees the UTC date");
      assert.equal(localPreviousDayISO("2026-08-05"), "2026-08-04");
    } finally {
      if (prevTZ === undefined) delete process.env.TZ;
      else process.env.TZ = prevTZ;
    }
  });

  // --- Cleanup ---
  await step("cleanup: delete test rows", async () => {
    await cleanupTestRows(adminToken);
    const count = await countTestRows(adminToken);
    assert.equal(count, 0, `expected 0 rows after cleanup, got ${count}`);
  });

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
