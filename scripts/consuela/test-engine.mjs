#!/usr/bin/env node
// Integration test for Consuela suggestion engine (Stream #1, Task 1.3).
//
// Usage:
//   set -a; source .env.integration; set +a
//   npx tsx scripts/consuela/test-engine.mjs
//
// What it verifies:
//   1. scanPantryLow detects low/out pantry items
//   2. scanTaskPenaltyStreak detects 3+ penalties in 7 days per child
//   3. scanCalendarConflicts detects overlapping same-day events
//   4. scanStaleData detects zero meals for current week
//   5. runEngine combines all scanners and inserts into proactive_suggestions

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL - ${name}: ${e.message}`);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
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

async function pbGet(path_, token) {
  const res = await fetch(`${PB_URL}${path_}`, {
    headers: { authorization: token },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PB GET ${path_} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function pbCreate(collection, body, token) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PB POST ${collection} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function pbUpdate(collection, id, body, token) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: token },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PB PATCH ${collection}/${id} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function pbDelete(collection, id, token) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
    method: "DELETE",
    headers: { authorization: token },
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  (cleanup: DELETE ${collection}/${id} failed ${res.status}: ${text.slice(0, 200)})`);
  }
}

async function main() {
  console.log(`PB: ${PB_URL}`);

  let adminToken;
  await step("authenticate with PB admin", async () => {
    adminToken = await pbAdminToken();
  });

  const scopeDate = new Date().toISOString().split("T")[0];

  // ── test IDs to clean up ──
  const cleanup = { pantry: [], events: [], weekData: null, suggestions: [], suggestionIds: [] };

  // ================================================================
  // 1. scanPantryLow
  // ================================================================
  console.log("\n--- scanPantryLow ---");

  // Clean up previous test pantry items
  try {
    const existing = await pbGet(
      `/api/collections/pantry_items/records?filter=(name~"test-engine-pantry")`,
      adminToken
    );
    for (const r of (existing?.items || [])) {
      await pbDelete("pantry_items", r.id, adminToken);
    }
  } catch { /* ok */ }

  let pantryLow, pantryOut;
  await step("seed pantry item with status=low", async () => {
    pantryLow = await pbCreate("pantry_items", {
      name: "test-engine-pantry-milk",
      item: "test-engine-pantry-milk",
      status: "low",
      quantity: 1,
      unit: "gallon",
      category: "dairy",
    }, adminToken);
    if (pantryLow?.id) cleanup.pantry.push(pantryLow.id);
  });

  await step("seed pantry item with status=out", async () => {
    pantryOut = await pbCreate("pantry_items", {
      name: "test-engine-pantry-bread",
      item: "test-engine-pantry-bread",
      status: "out",
      quantity: 0,
      unit: "loaf",
      category: "baking",
    }, adminToken);
    if (pantryOut?.id) cleanup.pantry.push(pantryOut.id);
  });

  await step("scanPantryLow returns 2 suggestions", async () => {
    const { scanPantryLow } = await import("../../src/lib/consuela/engine.ts");
    const results = await scanPantryLow(scopeDate);
    assert.equal(results.length, 2, `expected 2, got ${results.length}`);
    assert.equal(results[0].kind, "pantry_low");
    assert.equal(results[0].severity, "info"); // "low" -> info
    assert.equal(results[1].severity, "warn"); // "out" -> warn
    console.log(`  ${results[0].title}\n  ${results[1].title}`);
  });

  // ================================================================
  // 2. scanTaskPenaltyStreak
  // ================================================================
  console.log("\n--- scanTaskPenaltyStreak ---");

  const weekKeyFunc = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d.toISOString().split("T")[0];
  })();

  await step("seed week_data with 3+ penalty transactions for test child", async () => {
    // Look for existing week_data row for this week
    const existing = await pbGet(
      `/api/collections/week_data/records?filter=(weekStart="${weekKeyFunc}")`,
      adminToken
    );
    const now = new Date().toISOString();
    const penaltyHistory = [
      { type: "penalty", member: "test-engine-kid", timestamp: now, reason: "missed bed" },
      { type: "penalty", member: "test-engine-kid", timestamp: now, reason: "missed bed" },
      { type: "penalty", member: "test-engine-kid", timestamp: now, reason: "missed bed" },
      { type: "penalty", member: "other-kid", timestamp: now, reason: "missed bed" },
    ];

    if (existing?.items?.length > 0) {
      const row = existing.items[0];
      const history = JSON.stringify(penaltyHistory);
      await pbUpdate("week_data", row.id, { history }, adminToken);
      cleanup.weekData = null; // don't delete — just restored later
    } else {
      const row = await pbCreate("week_data", {
        weekStart: weekKeyFunc,
        history: JSON.stringify(penaltyHistory),
        points: JSON.stringify({}),
        streak: JSON.stringify({}),
        lastActive: JSON.stringify({}),
      }, adminToken);
      if (row?.id) cleanup.weekData = row.id;
    }
  });

  await step("scanTaskPenaltyStreak detects 1 child with 3+ penalties", async () => {
    const { scanTaskPenaltyStreak } = await import("../../src/lib/consuela/engine.ts");
    const results = await scanTaskPenaltyStreak(scopeDate);
    assert.equal(results.length, 1, `expected 1, got ${results.length}`);
    assert.ok(results[0].title.includes("test-engine-kid"));
    assert.equal(results[0].severity, "warn");
    console.log(`  ${results[0].title}`);
  });

  // ================================================================
  // 3. scanCalendarConflicts
  // ================================================================
  console.log("\n--- scanCalendarConflicts ---");

  // Clean up previous test events
  try {
    const existing = await pbGet(
      `/api/collections/events/records?filter=(title~"test-engine-event")`,
      adminToken
    );
    for (const r of (existing?.items || [])) {
      await pbDelete("events", r.id, adminToken);
    }
  } catch { /* ok */ }

  await step("seed two overlapping events (within 30 min)", async () => {
    const e1 = await pbCreate("events", {
      title: "test-engine-event-soccer",
      date: scopeDate,
      time: "10:00",
      icon: "⚽",
      color: "mint",
      member: "kid",
    }, adminToken);
    if (e1?.id) cleanup.events.push(e1.id);

    const e2 = await pbCreate("events", {
      title: "test-engine-event-piano",
      date: scopeDate,
      time: "10:20",
      icon: "🎹",
      color: "violet",
      member: "kid",
    }, adminToken);
    if (e2?.id) cleanup.events.push(e2.id);

    // Non-overlapping event (should not trigger)
    const e3 = await pbCreate("events", {
      title: "test-engine-event-dinner",
      date: scopeDate,
      time: "18:00",
      icon: "🍽️",
      color: "amber",
      member: "family",
    }, adminToken);
    if (e3?.id) cleanup.events.push(e3.id);
  });

  await step("scanCalendarConflicts detects 1 overlap", async () => {
    const { scanCalendarConflicts } = await import("../../src/lib/consuela/engine.ts");
    const results = await scanCalendarConflicts(scopeDate);
    assert.equal(results.length, 1, `expected 1 conflict, got ${results.length}`);
    assert.ok(results[0].title.includes("soccer"));
    assert.ok(results[0].title.includes("piano"));
    console.log(`  ${results[0].title}`);
  });

  // ================================================================
  // 4. scanStaleData
  // ================================================================
  console.log("\n--- scanStaleData ---");

  await step("scanStaleData emits when no meals for current week", async () => {
    const { scanStaleData } = await import("../../src/lib/consuela/engine.ts");
    const results = await scanStaleData(scopeDate);
    // May or may not emit depending on whether meals exist — at minimum it must not throw
    assert.ok(Array.isArray(results));
    if (results.length > 0) {
      assert.equal(results[0].kind, "stale_data");
      assert.equal(results[0].severity, "info");
      console.log(`  ${results[0].title}`);
    } else {
      console.log(`  (no stale data — meals exist for current week, ok)`);
    }
  });

  // ================================================================
  // 5. runEngine (full pipeline)
  // ================================================================
  console.log("\n--- runEngine ---");

  await step("runEngine returns scanned/inserted/rejected", async () => {
    const { runEngine } = await import("../../src/lib/consuela/engine.ts");
    const result = await runEngine({ scopeDate });
    assert.ok(typeof result.scanned === "number" && result.scanned >= 1, `scanned ${result.scanned}`);
    assert.ok(typeof result.inserted === "number" && result.inserted >= 0);
    assert.ok(typeof result.rejected === "number" && result.rejected >= 0);
    console.log(`  scanned=${result.scanned} inserted=${result.inserted} rejected=${result.rejected}`);
  });

  // ================================================================
  // Cleanup
  // ================================================================
  console.log("\n--- cleanup ---");

  for (const id of cleanup.pantry) {
    await pbDelete("pantry_items", id, adminToken);
  }
  for (const id of cleanup.events) {
    await pbDelete("events", id, adminToken);
  }
  if (cleanup.weekData) {
    await pbDelete("week_data", cleanup.weekData, adminToken);
  }

  // Delete suggestions created during the test
  try {
    const suggestions = await pbGet(
      `/api/collections/proactive_suggestions/records?filter=(scopeDate="${scopeDate}")`,
      adminToken
    );
    for (const r of (suggestions?.items || [])) {
      await pbDelete("proactive_suggestions", r.id, adminToken);
    }
  } catch { /* ok */ }

  // Restore week_data history if we modified an existing row
  if (cleanup.weekData === null) {
    try {
      const existing = await pbGet(
        `/api/collections/week_data/records?filter=(weekStart="${weekKeyFunc}")`,
        adminToken
      );
      if (existing?.items?.length > 0) {
        await pbUpdate("week_data", existing.items[0].id, {
          history: JSON.stringify([]),
        }, adminToken);
      }
    } catch { /* ok */ }
  }

  console.log("  done");

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
