#!/usr/bin/env node
// Integration test for chat_messages PB collection + DB layer (Task 3.1).
//
// Usage:
//   set -a; source .env.integration; set +a
//   npx tsx scripts/consuela/test-chat-messages.mjs
//
// What it verifies (C3):
//   1. Seed creates the collection with the right fields + index; re-run idempotent
//   2. insertChatMessage: 3 messages (2 user + 1 assistant, same threadId)
//   3. selectChatMessages returns 3 rows, ordered by createdAt asc
//   4. sinceISO filter returns only the newer subset
//   5. selectChatMessages with a different threadId returns empty
//
// Uses a unique test threadId so it never collides with real chat data, and
// cleans up its rows via the admin REST API at the end.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { db } from "../../src/db/index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
const TSCLI = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

const TEST_THREAD_ID = `test-chat-messages-${Date.now()}`;

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
    const filter = encodeURIComponent(`threadId="${TEST_THREAD_ID}"`);
    const data = await pbJson(`/api/collections/chat_messages/records?filter=${filter}&perPage=100`, token);
    for (const r of data.items || []) {
      await fetch(`${PB_URL}/api/collections/chat_messages/records/${r.id}`, {
        method: "DELETE",
        headers: { authorization: token },
      });
    }
  } catch { /* ok if cleanup fails */ }
}

async function countTestRows(token) {
  const filter = encodeURIComponent(`threadId="${TEST_THREAD_ID}"`);
  const data = await pbJson(`/api/collections/chat_messages/records?filter=${filter}&perPage=100`, token);
  return (data.items || []).length;
}

async function main() {
  console.log(`PB: ${PB_URL} | test threadId: ${TEST_THREAD_ID}`);

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

  await step("seed output mentions chat_messages", () => {
    assert.ok(
      seedOutput.includes("chat_messages"),
      `seed output missing chat_messages: ${seedOutput.slice(0, 200)}`
    );
  });

  let collection = null;
  await step("collection chat_messages exists with 6 fields", async () => {
    collection = await pbJson("/api/collections/chat_messages", adminToken);
    const customFields = (collection.fields || collection.schema || []).filter((f) => f.name !== "id");
    assert.equal(
      customFields.length,
      6,
      `expected 6 custom fields, got ${customFields.length}: ${customFields.map((f) => f.name).join(", ")}`
    );
  });

  const expectedFields = [
    { name: "userId", type: "text", required: true },
    { name: "role", type: "select" },
    { name: "content", type: "text", required: true },
    { name: "source", type: "select" },
    { name: "threadId", type: "text", required: true },
    { name: "createdAt", type: "date" },
  ];
  for (const f of expectedFields) {
    await step(`field ${f.name} is type ${f.type}${f.required ? " (required)" : ""}`, () => {
      const field = (collection.fields || collection.schema || []).find((s) => s.name === f.name);
      assert.ok(field, `field ${f.name} missing`);
      assert.equal(field.type, f.type);
      if (f.required) assert.equal(field.required, true);
    });
  }

  await step("field role is select with user/assistant/system values", () => {
    const field = (collection.fields || collection.schema || []).find((s) => s.name === "role");
    assert.ok(field, "role field missing");
    assert.equal(field.type, "select");
    assert.deepEqual(field.values || [], ["user", "assistant", "system"]);
  });

  await step("field source is select with telegram/dashboard/api values", () => {
    const field = (collection.fields || collection.schema || []).find((s) => s.name === "source");
    assert.ok(field, "source field missing");
    assert.equal(field.type, "select");
    assert.deepEqual(field.values || [], ["telegram", "dashboard", "api"]);
  });

  await step("index idx_thread_created exists on (threadId, createdAt)", () => {
    const names = getIndexNames(collection.indexes);
    assert.ok(names.has("idx_thread_created"), `idx_thread_created not in indexes: ${[...names].join(", ")}`);
    const idx = (collection.indexes || []).find((i) =>
      typeof i === "string" ? /idx_thread_created/i.test(i) : i.name === "idx_thread_created"
    );
    assert.ok(idx, "idx_thread_created should exist");
    const sql = typeof idx === "string" ? idx : idx.create?.query || "";
    assert.ok(
      typeof idx !== "string" || (/threadId/i.test(sql) && /createdAt/i.test(sql)),
      "index should be on (threadId, createdAt)"
    );
  });

  await step("re-run seed is idempotent", async () => {
    const output2 = runSeed();
    assert.ok(
      output2.includes("chat_messages") &&
        (output2.includes("already exists") || output2.includes("patched")),
      `expected "already exists" or "patched" for chat_messages, got: ${output2.slice(0, 300)}`
    );
  });

  // --- 2. insert 3 messages (2 user + 1 assistant, same threadId) ---
  await step("cleanup: remove any pre-existing test rows", async () => {
    await cleanupTestRows(adminToken);
  });

  const messages = [
    { userId: "Rebecca", role: "user", content: "test-chat-msg-1 (user)", source: "dashboard", threadId: TEST_THREAD_ID },
    { userId: "consuela", role: "assistant", content: "test-chat-msg-2 (assistant)", source: "dashboard", threadId: TEST_THREAD_ID },
    { userId: "Rebecca", role: "user", content: "test-chat-msg-3 (user)", source: "telegram", threadId: TEST_THREAD_ID },
  ];

  const insertedIds = [];
  await step("insertChatMessage creates 3 rows", async () => {
    for (const msg of messages) {
      const rec = await db.insertChatMessage(msg);
      assert.ok(rec && rec.id, `expected created row with id, got ${JSON.stringify(rec).slice(0, 200)}`);
      insertedIds.push(rec.id);
      assert.equal(rec.threadId, TEST_THREAD_ID);
      assert.equal(rec.userId, msg.userId);
      assert.equal(rec.role, msg.role);
      assert.equal(rec.content, msg.content);
      assert.equal(rec.source, msg.source);
      assert.ok(rec.createdAt, "createdAt should be set by insertChatMessage");
      console.log(`  created ${rec.id} (${rec.role})`);
    }
    assert.equal(insertedIds.length, 3, "expected 3 inserts");
    const count = await countTestRows(adminToken);
    assert.equal(count, 3, `expected exactly 3 rows, got ${count}`);
  });

  // --- 3. select returns 3, ordered by createdAt asc ---
  let selected = [];
  await step("selectChatMessages returns 3 rows ordered by createdAt asc", async () => {
    selected = await db.selectChatMessages(TEST_THREAD_ID);
    assert.equal(selected.length, 3, `expected 3 rows, got ${selected.length}`);
    const times = selected.map((r) => new Date(r.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] >= times[i - 1], "rows should be ordered by createdAt asc");
    }
    assert.deepEqual(
      selected.map((r) => r.content),
      ["test-chat-msg-1 (user)", "test-chat-msg-2 (assistant)", "test-chat-msg-3 (user)"],
      "rows should come back in insertion order"
    );
  });

  // --- 4. sinceISO filter returns subset ---
  await step("selectChatMessages with sinceISO returns only newer rows", async () => {
    const since = selected[0].createdAt;
    const subset = await db.selectChatMessages(TEST_THREAD_ID, since);
    assert.equal(subset.length, 2, `expected 2 rows after sinceISO, got ${subset.length}`);
    assert.deepEqual(
      subset.map((r) => r.content),
      ["test-chat-msg-2 (assistant)", "test-chat-msg-3 (user)"]
    );
  });

  await step("selectChatMessages with sinceISO at last message returns empty", async () => {
    const since = selected[2].createdAt;
    const subset = await db.selectChatMessages(TEST_THREAD_ID, since);
    assert.equal(subset.length, 0, `expected 0 rows, got ${subset.length}`);
  });

  // --- 5. different threadId returns empty ---
  await step("selectChatMessages with a different threadId returns empty", async () => {
    const other = await db.selectChatMessages(`${TEST_THREAD_ID}-other`);
    assert.equal(other.length, 0, `expected 0 rows for other thread, got ${other.length}`);
  });

  // --- 6. I3: explicit createdAt honored; L10: route rejects malformed threadId ---
  await step("insertChatMessage honors an explicit createdAt (I3)", async () => {
    const backdated = await db.insertChatMessage({
      userId: "consuela",
      role: "assistant",
      content: "test-chat-msg-0 (backdated)",
      source: "api",
      threadId: TEST_THREAD_ID,
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    assert.ok(backdated?.id, `expected row, got ${JSON.stringify(backdated).slice(0, 200)}`);
    assert.equal(
      new Date(backdated.createdAt).toISOString(),
      "2020-01-01T00:00:00.000Z",
      `explicit createdAt must be preserved, got ${backdated.createdAt}`
    );
    const all = await db.selectChatMessages(TEST_THREAD_ID);
    assert.equal(all.length, 4, `expected 4 rows, got ${all.length}`);
    assert.equal(all[0].content, "test-chat-msg-0 (backdated)", "backdated row must sort first");
  });

  await step("GET /api/chat/messages rejects malformed threadId (L10)", async () => {
    const { GET: chatMessagesGET } = await import("../../src/app/api/chat/messages/route.ts");
    for (const bad of ['abc"def', 'abc\\def']) {
      const res = await chatMessagesGET(
        new NextRequest(`http://localhost/api/chat/messages?threadId=${encodeURIComponent(bad)}`)
      );
      assert.equal(res.status, 400, `threadId ${bad}: expected 400, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.error, "invalid threadId");
    }
    const res = await chatMessagesGET(
      new NextRequest(`http://localhost/api/chat/messages?threadId=${encodeURIComponent(TEST_THREAD_ID)}`)
    );
    assert.equal(res.status, 200, `valid threadId: expected 200, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.threadId, TEST_THREAD_ID);
    assert.ok(Array.isArray(body.messages) && body.messages.length === 4, "all 4 rows served");
    assert.equal(body.messages[0].content, "test-chat-msg-0 (backdated)");
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
