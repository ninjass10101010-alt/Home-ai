#!/usr/bin/env node
// Smoke test for proactive_suggestions PB collection (Stream #1, Task 1.1).
//
// Usage:
//   set -a; source .env.integration; set +a
//   node scripts/consuela/test-seed.mjs
//
// What it verifies:
//   1. pb-seed.mjs runs without error
//   2. Collection proactive_suggestions exists
//   3. Collection has 14 schema fields (excluding system id)
//   4. Key fields have correct types and options (kind, severity, status)
//   5. actionPayload is type json
//   6. Two indexes exist (idx_hash_unique, idx_status_scope)
//   7. Seed is idempotent (second run reports "already exists" or "patched")

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
const TSCLI = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

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
    env: { ...process.env, NEXT_PUBLIC_PB_URL: PB_URL, PB_ADMIN_EMAIL: ADMIN_EMAIL, PB_ADMIN_PASS: ADMIN_PASS },
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

async function main() {
  console.log(`PB: ${PB_URL}`);

  let adminToken;
  await step("authenticate with PB admin", async () => {
    adminToken = await pbAdminToken();
  });

  // --- Seed run ---
  let seedOutput = "";
  await step("run pb-seed.mjs", async () => {
    seedOutput = runSeed();
    console.log(`  seed output: ${seedOutput.trim().split("\n").pop() || seedOutput.trim()}`);
  });

  await step("seed output mentions proactive_suggestions", () => {
    assert.ok(
      seedOutput.includes("proactive_suggestions"),
      `seed output missing proactive_suggestions: ${seedOutput.slice(0, 200)}`
    );
  });

  // --- Collection existence ---
  await step("collection proactive_suggestions exists in PB", async () => {
    const list = await pbJson("/api/collections?perPage=100", adminToken);
    const found = list.items.find((c) => c.name === "proactive_suggestions");
    assert.ok(found, "proactive_suggestions not found in collections list");
  });

  // --- Field count ---
  let collection = null;
  await step("collection has 13 custom fields (14 total with system id)", async () => {
    collection = await pbJson("/api/collections/proactive_suggestions", adminToken);
    const customFields = (collection.fields || collection.schema || []).filter((f) => f.name !== "id");
    assert.equal(
      customFields.length,
      13,
      `expected 13 custom fields, got ${customFields.length}: ${customFields.map((f) => f.name).join(", ")}`
    );
  });

  // --- Key field assertions ---
  const fields = [
    { name: "idempotencyHash", type: "text", required: true },
    { name: "title", type: "text", required: true },
    { name: "scopeDate", type: "text", required: true },
    { name: "body", type: "text" },
    { name: "emoji", type: "text" },
    { name: "actionLabel", type: "text" },
    { name: "actionPayload", type: "json" },
    { name: "snoozedUntil", type: "date" },
    { name: "createdAt", type: "date" },
    { name: "expiresAt", type: "date" },
  ];
  for (const f of fields) {
    await step(`field ${f.name} is type ${f.type}${f.required ? " (required)" : ""}`, () => {
      const field = (collection.fields || collection.schema || []).find((s) => s.name === f.name);
      assert.ok(field, `field ${f.name} missing`);
      assert.equal(field.type, f.type);
      if (f.required) assert.equal(field.required, true);
    });
  }

  await step("field kind is select with 5 values", () => {
    const field = (collection.fields || collection.schema || []).find((s) => s.name === "kind");
    assert.ok(field, "kind field missing");
    assert.equal(field.type, "select");
    assert.deepEqual(field.values || [], [
      "pantry_low", "task_penalty_streak", "calendar_conflict", "stale_data", "custom",
    ]);
  });

  await step("field severity is select with 3 values", () => {
    const field = (collection.fields || collection.schema || []).find((s) => s.name === "severity");
    assert.ok(field, "severity field missing");
    assert.equal(field.type, "select");
    assert.deepEqual(field.values || [], ["info", "warn", "alert"]);
  });

  await step("field status is select with 4 values", () => {
    const field = (collection.fields || collection.schema || []).find((s) => s.name === "status");
    assert.ok(field, "status field missing");
    assert.equal(field.type, "select");
    assert.deepEqual(field.values || [], ["pending", "dismissed", "actioned", "snoozed"]);
  });

  // --- Index assertions ---
  await step("collection has 2 indexes", () => {
    const names = getIndexNames(collection.indexes);
    assert.equal(names.size, 2, `expected 2 indexes, got ${names.size}: ${[...names].join(", ")}`);
  });

  await step("index idx_hash_unique exists (unique on idempotencyHash)", () => {
    const names = getIndexNames(collection.indexes);
    assert.ok(names.has("idx_hash_unique"), `idx_hash_unique not in indexes: ${[...names].join(", ")}`);
  });

  await step("index idx_status_scope exists (on status, scopeDate)", () => {
    const names = getIndexNames(collection.indexes);
    assert.ok(names.has("idx_status_scope"), `idx_status_scope not in indexes: ${[...names].join(", ")}`);
  });

  // --- Idempotency: re-run seed ---
  await step("re-run seed is idempotent (already exists or patched)", async () => {
    const output2 = runSeed();
    const hasP = output2.includes("proactive_suggestions");
    const isExist = output2.includes("already exists") || output2.includes("patched");
    assert.ok(hasP && isExist, `expected "already exists" or "patched" for proactive_suggestions, got: ${output2.slice(0, 300)}`);
    console.log(`  re-run output: ${output2.trim().split("\n").pop() || output2.trim()}`);
  });

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
