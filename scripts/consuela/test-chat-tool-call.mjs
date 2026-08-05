#!/usr/bin/env node
// Integration test for Task 2.2 — Hermes chat write-tools actually persist to PocketBase.
//
// Usage:
//   set -a; source .env.integration; set +a
//   npx tsx scripts/consuela/test-chat-tool-call.mjs
//
// What it verifies (C9):
//   1. add_grocery_item persists rows to grocery_list_items (and dedupes on re-add)
//   2. add_task persists a row to the tasks collection
//   3. complete_task appends an earn transaction to week_data and awards points;
//      double-completing the same task is rejected
//   4. add_event persists a row to events
//   5. remove_event deletes the row (and reports "not found" on a second call)
//   6. complete_grocery_item flips needed -> false
//   7. action_suggestion dispatches the payload tool, persists the action, and
//      flips the suggestion to "actioned"; unknown tools fail gracefully
//
// All test rows are cleaned up afterwards.

import assert from "node:assert/strict";
import { getTool } from "../../src/lib/hermes-tools.ts";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;

const STAMP = Date.now();
const TEST_TITLE = `Hermes test task ${STAMP}`;
const EVENT_TITLE = `Hermes test event ${STAMP}`;
const GROCERY_NAMES = ["hermes-test milk", "hermes-test eggs"];
const ACTION_ITEM = "hermes-test action item";
const SUGGESTION_TITLES = ["hermes-test-suggestion-ok", "hermes-test-suggestion-unknown"];

let failures = 0;
const passed = [];
const failed = [];

let weekRowBefore = null; // snapshot of week_data before the run (restored in cleanup)

async function step(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`  ok - ${name}`);
  } catch (e) {
    failures++;
    failed.push(`${name}: ${e.message}`);
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function weekStartISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

async function adminToken() {
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

async function listAll(token, collection, filter) {
  const items = [];
  let page = 1;
  for (;;) {
    const q = `/api/collections/${collection}/records?perPage=200&page=${page}${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`;
    const data = await pbJson(q, token);
    items.push(...(data.items || []));
    if ((data.items || []).length < 200) break;
    page++;
  }
  return items;
}

function parseResult(raw) {
  return JSON.parse(raw);
}

function jsonValue(value, fallback) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value ?? fallback;
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    console.error("Missing PB_ADMIN_EMAIL / PB_ADMIN_PASS — load .env.integration first.");
    process.exit(1);
  }
  console.log(`PB: ${PB_URL}`);
  const token = await adminToken();
  const weekStart = weekStartISO();

  // Snapshot week_data so we can restore it exactly (cleans up the earn tx).
  const weekRowsBefore = await listAll(token, "week_data", `weekStart="${weekStart}"`);
  weekRowBefore = weekRowsBefore[0] || null;

  // ---- 1. add_grocery_item ----
  await step("add_grocery_item persists 2 rows to grocery_list_items", async () => {
    const tool = getTool("add_grocery_item");
    assert.ok(tool, "add_grocery_item tool exists");
    const res = parseResult(await tool.handler({ items: GROCERY_NAMES.join(", ") }));
    assert.equal(res.inserted, 2, `inserted should be 2, got ${JSON.stringify(res)}`);
    assert.equal(res.items.length, 2);
    const rows = await listAll(token, "grocery_list_items", `(name~"hermes-test")`);
    assert.equal(rows.length, 2, `expected 2 grocery rows, got ${rows.length}`);
    assert.ok(rows.every((r) => r.needed === true), "rows should be needed:true");
  });

  await step("add_grocery_item dedupes on re-add", async () => {
    const tool = getTool("add_grocery_item");
    const res = parseResult(await tool.handler({ items: GROCERY_NAMES.join(", ") }));
    assert.equal(res.inserted, 2);
    const rows = await listAll(token, "grocery_list_items", `(name~"hermes-test")`);
    assert.equal(rows.length, 2, `re-add should not duplicate rows, got ${rows.length}`);
  });

  // ---- 2. add_task ----
  let createdTaskId = null;
  await step("add_task persists a row to tasks", async () => {
    const tool = getTool("add_task");
    assert.ok(tool, "add_task tool exists");
    const res = parseResult(await tool.handler({ title: TEST_TITLE, assigned_to: "Caspian", points: 5 }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.taskId, "taskId returned");
    createdTaskId = res.taskId;
    const rows = await listAll(token, "tasks", `taskId=${createdTaskId}`);
    assert.equal(rows.length, 1, `expected 1 task row, got ${rows.length}`);
    assert.equal(rows[0].title, TEST_TITLE);
    assert.match(String(rows[0].assignee), /Caspian/i);
    assert.equal(rows[0].points, 5);
  });

  // ---- 3. complete_task ----
  await step("complete_task appends earn tx to week_data and awards points", async () => {
    assert.ok(createdTaskId, "need taskId from add_task step");
    const tool = getTool("complete_task");
    assert.ok(tool, "complete_task tool exists");
    const res = parseResult(await tool.handler({ taskId: createdTaskId }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.pointsEarned, 5);
    const rows = await listAll(token, "week_data", `weekStart="${weekStart}"`);
    assert.equal(rows.length, 1, "week_data row should exist for this week");
    const history = jsonValue(rows[0].history, []);
    const tx = history.find((h) => h.taskId === createdTaskId && h.type === "earn");
    assert.ok(tx, `earn tx for taskId ${createdTaskId} not found in ${JSON.stringify(history)}`);
    assert.equal(tx.amount, 5);
    assert.match(String(tx.member), /Caspian/i);
    const points = jsonValue(rows[0].points, {});
    const pointsBefore = jsonValue(weekRowBefore?.points, {});
    const memberKey = Object.keys(points).find((k) => /caspian/i.test(k));
    assert.ok(memberKey, "points should include the member");
    const memberKeyBefore = Object.keys(pointsBefore).find((k) => /caspian/i.test(k));
    const expectedPoints = (memberKeyBefore ? pointsBefore[memberKeyBefore] : 0) + 5;
    assert.equal(points[memberKey], expectedPoints, "points should grow by 5");
  });

  await step("complete_task rejects double-completion", async () => {
    const tool = getTool("complete_task");
    const res = parseResult(await tool.handler({ taskId: createdTaskId }));
    assert.equal(res.ok, false, "second completion should fail");
    assert.match(String(res.error), /already completed/i);
  });

  // ---- 4. add_event ----
  let createdEventId = null;
  await step("add_event persists a row to events", async () => {
    const tool = getTool("add_event");
    assert.ok(tool, "add_event tool exists");
    const res = parseResult(await tool.handler({ title: EVENT_TITLE, time: "18:30", member: "Emily" }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.event?.id, "event id returned");
    createdEventId = res.event.id;
    const rows = await listAll(token, "events", `(title="${EVENT_TITLE}")`);
    assert.equal(rows.length, 1, `expected 1 event row, got ${rows.length}`);
    assert.equal(rows[0].time, "18:30");
    assert.equal(rows[0].date, todayISO());
    assert.equal(rows[0].member, "Emily");
  });

  // ---- 5. remove_event ----
  await step("remove_event deletes the row", async () => {
    assert.ok(createdEventId, "need event id from add_event step");
    const tool = getTool("remove_event");
    assert.ok(tool, "remove_event tool exists");
    const res = parseResult(await tool.handler({ title: EVENT_TITLE }));
    assert.equal(res.removed, true, JSON.stringify(res));
    const rows = await listAll(token, "events", `(title="${EVENT_TITLE}")`);
    assert.equal(rows.length, 0, "event should be gone");
  });

  await step("remove_event reports not found on second call", async () => {
    const tool = getTool("remove_event");
    const res = parseResult(await tool.handler({ title: EVENT_TITLE }));
    assert.equal(res.removed, false);
    assert.equal(res.reason, "not found");
  });

  // ---- 6. complete_grocery_item ----
  await step("complete_grocery_item flips needed -> false", async () => {
    const tool = getTool("complete_grocery_item");
    assert.ok(tool, "complete_grocery_item tool exists");
    const res = parseResult(await tool.handler({ item: GROCERY_NAMES[0] }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.needed, false);
    const rows = await listAll(token, "grocery_list_items", `(name~"hermes-test")`);
    const row = rows.find((r) => /milk/i.test(r.name));
    assert.ok(row, "milk row exists");
    assert.equal(row.needed, false, "milk row should be needed:false");
  });

  // ---- 7. action_suggestion ----
  let okSuggestionId = null;
  let unknownSuggestionId = null;
  await step("action_suggestion dispatches payload tool and marks actioned", async () => {
    const tool = getTool("action_suggestion");
    assert.ok(tool, "action_suggestion tool exists");
    const created = await pbJson(
      `/api/collections/proactive_suggestions/records`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          idempotencyHash: `hermes-test-${STAMP}-ok`,
          kind: "custom",
          severity: "info",
          title: SUGGESTION_TITLES[0],
          body: "test",
          actionLabel: "Add test item",
          actionPayload: { tool: "add_grocery_item", args: { items: ACTION_ITEM } },
          status: "pending",
          scopeDate: todayISO(),
        }),
      }
    );
    okSuggestionId = created.id;
    const res = parseResult(await tool.handler({ id: created.id }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.tool, "add_grocery_item");
    assert.equal(res.result?.inserted, 1, `action should insert 1 grocery item, got ${JSON.stringify(res.result)}`);
    const rows = await listAll(token, "grocery_list_items", `(name~"hermes-test")`);
    assert.ok(rows.some((r) => /action item/i.test(r.name)), "action item row should exist");
    const sug = await pbJson(`/api/collections/proactive_suggestions/records/${created.id}`, token);
    assert.equal(sug.status, "actioned", "suggestion should be actioned");
  });

  await step("action_suggestion handles unknown tools gracefully", async () => {
    const tool = getTool("action_suggestion");
    const created = await pbJson(
      `/api/collections/proactive_suggestions/records`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          idempotencyHash: `hermes-test-${STAMP}-unknown`,
          kind: "custom",
          severity: "info",
          title: SUGGESTION_TITLES[1],
          body: "test",
          actionPayload: { tool: "nonexistent_tool", args: {} },
          status: "pending",
          scopeDate: todayISO(),
        }),
      }
    );
    unknownSuggestionId = created.id;
    const res = parseResult(await tool.handler({ id: created.id }));
    assert.equal(res.ok, false, "unknown tool should return ok:false");
    assert.match(String(res.error), /unknown/i);
    const sug = await pbJson(`/api/collections/proactive_suggestions/records/${created.id}`, token);
    assert.equal(sug.status, "pending", "suggestion should stay pending");
  });

  // ---- summary ----
  console.log(`\n${passed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.error("Failures:");
    for (const f of failed) console.error(`  - ${f}`);
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error("Fatal:", e);
    process.exitCode = 1;
  } finally {
    // ---- cleanup ----
    try {
      const token = await adminToken();
      const weekStart = weekStartISO();

      const groceryRows = await listAll(token, "grocery_list_items", `(name~"hermes-test")`);
      for (const r of groceryRows) {
        await fetch(`${PB_URL}/api/collections/grocery_list_items/records/${r.id}`, {
          method: "DELETE",
          headers: { authorization: token },
        });
      }

      const taskRows = await listAll(token, "tasks", `(title~"Hermes test task")`);
      for (const r of taskRows) {
        await fetch(`${PB_URL}/api/collections/tasks/records/${r.id}`, {
          method: "DELETE",
          headers: { authorization: token },
        });
      }

      const eventRows = await listAll(token, "events", `(title~"Hermes test event")`);
      for (const r of eventRows) {
        await fetch(`${PB_URL}/api/collections/events/records/${r.id}`, {
          method: "DELETE",
          headers: { authorization: token },
        });
      }

      const sugRows = await listAll(
        token,
        "proactive_suggestions",
        `(title~"hermes-test-suggestion")`
      );
      for (const r of sugRows) {
        await fetch(`${PB_URL}/api/collections/proactive_suggestions/records/${r.id}`, {
          method: "DELETE",
          headers: { authorization: token },
        });
      }

      const weekRowsAfter = await listAll(token, "week_data", `weekStart="${weekStart}"`);
      if (weekRowBefore) {
        if (weekRowsAfter[0]) {
          await pbJson(`/api/collections/week_data/records/${weekRowsAfter[0].id}`, token, {
            method: "PATCH",
            body: JSON.stringify(weekRowBefore),
          });
        }
      } else if (weekRowsAfter[0]) {
        await fetch(`${PB_URL}/api/collections/week_data/records/${weekRowsAfter[0].id}`, {
          method: "DELETE",
          headers: { authorization: token },
        });
      }

      console.log("cleanup done.");
    } catch (e) {
      console.error("cleanup failed (non-fatal):", e.message);
    }
  }
})();
