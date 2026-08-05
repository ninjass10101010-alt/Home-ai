#!/usr/bin/env node
// Integration test for proactive_suggestions DB layer (Stream #1, Task 1.2).
//
// Usage:
//   set -a; source .env.integration; set +a
//   node scripts/consuela/test-db.mjs
//
// What it verifies:
//   1. insertProactiveSuggestions: 2 unique items inserted, 1 duplicate rejected
//   2. selectPendingSuggestions: returns >= 2 pending items
//   3. updateSuggestion: flips one to dismissed
//   4. selectPendingSuggestions: count drops after dismissal

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;

function idempotencyHashOf(kind, title, scopeDate) {
  const norm = `${kind}|${title.trim().toLowerCase()}|${scopeDate}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

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

async function main() {
  console.log(`PB: ${PB_URL}`);

  let adminToken;
  await step("authenticate with PB admin", async () => {
    adminToken = await pbAdminToken();
  });

  const scopeDate = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();
  const recordsPath = "/api/collections/proactive_suggestions/records";

  // Clean up any existing test data from previous runs
  try {
    const existing = await fetch(`${PB_URL}${recordsPath}?filter=(title~"test-db-")`, {
      headers: { authorization: adminToken },
    });
    if (existing.ok) {
      const data = await existing.json();
      for (const r of data.items || []) {
        await fetch(`${PB_URL}${recordsPath}/${r.id}`, {
          method: "DELETE",
          headers: { authorization: adminToken },
        });
      }
    }
  } catch { /* ok if cleanup fails */ }

  // --- Step A: Insert 3 suggestions ---
  const items = [
    {
      kind: "pantry_low",
      severity: "warn",
      title: "test-db-item-1",
      scopeDate,
    },
    {
      kind: "calendar_conflict",
      severity: "info",
      title: "test-db-item-2",
      scopeDate,
    },
    {
      kind: "pantry_low",
      severity: "warn",
      title: "test-db-item-1",
      scopeDate,
    },
  ];

  let insertedIds = [];
  let rejectedCount = 0;

  await step("insert 3 suggestions (2 unique + 1 duplicate)", async () => {
    for (const item of items) {
      const hash = idempotencyHashOf(item.kind, item.title, item.scopeDate);
      const body = {
        idempotencyHash: hash,
        kind: item.kind,
        severity: item.severity,
        title: item.title,
        scopeDate: item.scopeDate,
        status: "pending",
        createdAt: now,
      };

      const res = await fetch(`${PB_URL}${recordsPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: adminToken,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const record = await res.json();
        insertedIds.push(record.id);
      } else {
        const errText = await res.text();
        if (res.status === 400 && errText.toLowerCase().includes("unique")) {
          rejectedCount++;
        } else {
          throw new Error(`Insert failed (${res.status}): ${errText.slice(0, 200)}`);
        }
      }
    }

    console.log(`  inserted=${insertedIds.length}, rejected=${rejectedCount}`);
  });

  await step("2 inserts succeeded", () => {
    assert.equal(insertedIds.length, 2, `expected 2 inserts, got ${insertedIds.length}`);
  });

  await step("1 duplicate-hash insert was rejected", () => {
    assert.equal(rejectedCount, 1, `expected 1 rejected, got ${rejectedCount}`);
  });

  // --- Step B: selectPendingSuggestions returns >= 2 ---
  let pendingRecords = [];

  await step("selectPendingSuggestions returns >= 2", async () => {
    const filter = `status="pending" && scopeDate>="${scopeDate}" && (snoozedUntil=null || snoozedUntil<"${now}")`;
    const data = await pbJson(
      `${recordsPath}?filter=${encodeURIComponent(filter)}&sort=-createdAt`,
      adminToken
    );
    pendingRecords = data.items || [];
    assert.ok(
      pendingRecords.length >= 2,
      `expected >= 2 pending, got ${pendingRecords.length}`
    );
    console.log(`  pending count: ${pendingRecords.length}`);
  });

  // --- Step C: updateSuggestion flips one to dismissed ---
  await step("updateSuggestion flips one to dismissed", async () => {
    const toDismiss = pendingRecords[0];
    const res = await fetch(`${PB_URL}${recordsPath}/${toDismiss.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: adminToken,
      },
      body: JSON.stringify({ status: "dismissed" }),
    });
    if (!res.ok) {
      throw new Error(`Update failed (${res.status}): ${await res.text()}`);
    }
    const updated = await res.json();
    assert.equal(updated.status, "dismissed");
  });

  // --- Step D: selectPendingSuggestions count drops ---
  await step("selectPendingSuggestions count drops after dismissal", async () => {
    const filter = `status="pending" && scopeDate>="${scopeDate}" && (snoozedUntil=null || snoozedUntil<"${now}")`;
    const data = await pbJson(
      `${recordsPath}?filter=${encodeURIComponent(filter)}&sort=-createdAt`,
      adminToken
    );
    const afterCount = (data.items || []).length;
    assert.ok(
      afterCount < pendingRecords.length,
      `pending count did not drop: was ${pendingRecords.length}, now ${afterCount}`
    );
    console.log(`  pending before=${pendingRecords.length}, after=${afterCount}`);
  });

  // Clean up test records
  try {
    for (const id of insertedIds) {
      await fetch(`${PB_URL}${recordsPath}/${id}`, {
        method: "DELETE",
        headers: { authorization: adminToken },
      });
    }
  } catch { /* ok if cleanup fails */ }

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
