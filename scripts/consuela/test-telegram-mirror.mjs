#!/usr/bin/env node
// Integration test for Task 3.2 — Telegram getUpdates poller cron route.
//
// Usage:
//   set -a; source .env.integration; set +a
//   npx tsx scripts/consuela/test-telegram-mirror.mjs
//
// What it verifies (C1 + C2 + C3 + C4):
//   1. Seed creates consuela_state (key text required + value json + unique idx_key_unique);
//      re-run idempotent; unique index actually enforced
//   2. Route auth: no Bearer CRON_SECRET -> 401
//   3. Route no-token branch: TELEGRAM_MIRROR_BOT_TOKEN unset -> { ok:false, reason:"no_token" } 200
//   4. pollTelegramUpdates: throws with Telegram's description when data.ok === false
//   5. First poll (mock fetch honoring Telegram offset semantics): 2 updates with text are
//      mirrored into chat_messages (source="telegram", userId=first_name, threadId=YYYY-MM-DD
//      of the message date); bot-sourced and text-less updates are skipped
//   6. last_telegram_update_id persisted in consuela_state
//   7. Second run with the same offset: processed 0 (dedupe), no duplicate rows
//
// fetch is stubbed for api.telegram.org only; every other URL (incl. the PB SDK) falls
// through to the real fetch.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
const TSCLI = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

const MOCK_TOKEN = "123456:test-mock-token";
const CRON_SECRET = process.env.CRON_SECRET || "dev-cron-secret-2026";
process.env.CRON_SECRET = CRON_SECRET;
process.env.TELEGRAM_MIRROR_BOT_TOKEN = MOCK_TOKEN;

const STATE_KEY = "last_telegram_update_id";
const TEST_STATE_KEY = `test-state-${Date.now()}`;
const MSG_MARKER = "test-tg-mirror-";

// Two text messages (2024-01-01), one bot message with text (skipped), one message
// without text (skipped). All from the same family group.
const MOCK_UPDATES = [
  {
    update_id: 100001,
    message: {
      message_id: 9001,
      from: { id: 1, first_name: "Rebecca" },
      chat: { id: -1001, type: "group", title: "Garcia Family" },
      date: 1704067200,
      text: `${MSG_MARKER}first`,
    },
  },
  {
    update_id: 100002,
    message: {
      message_id: 9002,
      from: { id: 2, first_name: "Jeffery" },
      chat: { id: -1001, type: "group", title: "Garcia Family" },
      date: 1704067260,
      text: `${MSG_MARKER}second`,
    },
  },
  {
    update_id: 100003,
    message: {
      message_id: 9003,
      from: { id: 99, first_name: "SomeBot", is_bot: true },
      chat: { id: -1001, type: "group", title: "Garcia Family" },
      date: 1704067320,
      text: `${MSG_MARKER}bot-should-be-skipped`,
    },
  },
  {
    update_id: 100004,
    message: {
      message_id: 9004,
      from: { id: 3, first_name: "Emily" },
      chat: { id: -1001, type: "group", title: "Garcia Family" },
      date: 1704067380,
    },
  },
];

const EXPECTED_THREAD_ID = new Date(1704067200 * 1000).toISOString().split("T")[0];
const EXPECTED_LAST_ID = 100004;

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

// --- Telegram fetch mock: only api.telegram.org URLs are stubbed ---

let tgResponder = null;

function telegramResponder(url) {
  if (tgResponder) return tgResponder(url);
  const offset = Number(new URL(url).searchParams.get("offset") || 0);
  const updates = offset ? MOCK_UPDATES.filter((u) => u.update_id >= offset) : MOCK_UPDATES;
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: updates }),
  });
}

function installTgMock() {
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.telegram.org")) {
      return telegramResponder(String(url));
    }
    return realFetch(url, init);
  };
}

function post() {
  return POST(
    new NextRequest("http://localhost/api/cron/consuela/telegram-poll", {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
}

async function countMirrorRows(token) {
  const filter = encodeURIComponent(`content~"${MSG_MARKER}"`);
  const data = await pbJson(`/api/collections/chat_messages/records?filter=${filter}&perPage=100`, token);
  return (data.items || []).length;
}

async function cleanupTestData(token) {
  try {
    const filter = encodeURIComponent(`content~"${MSG_MARKER}"`);
    const data = await pbJson(`/api/collections/chat_messages/records?filter=${filter}&perPage=100`, token);
    for (const r of data.items || []) {
      await fetch(`${PB_URL}/api/collections/chat_messages/records/${r.id}`, {
        method: "DELETE",
        headers: { authorization: token },
      });
    }
    const stateFilter = encodeURIComponent(`key="${STATE_KEY}"`);
    const stateData = await pbJson(`/api/collections/consuela_state/records?filter=${stateFilter}&perPage=100`, token);
    for (const r of stateData.items || []) {
      await fetch(`${PB_URL}/api/collections/consuela_state/records/${r.id}`, {
        method: "DELETE",
        headers: { authorization: token },
      });
    }
  } catch { /* ok if cleanup fails */ }
}

let POST;
let pollTelegramUpdates;

async function main() {
  console.log(`PB: ${PB_URL} | thread: ${EXPECTED_THREAD_ID} | last id: ${EXPECTED_LAST_ID}`);

  let adminToken;
  await step("authenticate with PB admin", async () => {
    adminToken = await pbAdminToken();
  });

  // --- 1. Seed + collection shape ---
  let seedOutput = "";
  await step("run pb-seed.mjs", async () => {
    seedOutput = runSeed();
  });

  await step("seed output mentions consuela_state and chat_messages", () => {
    assert.ok(seedOutput.includes("consuela_state"), `consuela_state missing from seed output: ${seedOutput.slice(0, 300)}`);
    assert.ok(seedOutput.includes("chat_messages"), `chat_messages missing from seed output: ${seedOutput.slice(0, 300)}`);
  });

  let collection = null;
  await step("collection consuela_state exists", async () => {
    collection = await pbJson("/api/collections/consuela_state", adminToken);
    assert.ok(collection && collection.id, "consuela_state collection should exist");
  });

  await step("field key is required text", () => {
    const field = (collection.fields || collection.schema || []).find((f) => f.name === "key");
    assert.ok(field, "key field missing");
    assert.equal(field.type, "text");
    assert.equal(field.required, true);
  });

  await step("field value is json", () => {
    const field = (collection.fields || collection.schema || []).find((f) => f.name === "value");
    assert.ok(field, "value field missing");
    assert.equal(field.type, "json");
  });

  await step("unique index idx_key_unique on (key)", () => {
    const names = getIndexNames(collection.indexes);
    assert.ok(names.has("idx_key_unique"), `idx_key_unique not in indexes: ${[...names].join(", ")}`);
    const idx = (collection.indexes || []).find((i) =>
      typeof i === "string" ? /idx_key_unique/i.test(i) : i.name === "idx_key_unique"
    );
    const sql = typeof idx === "string" ? idx : idx?.create?.query || "";
    assert.ok(/key/i.test(sql), "index should reference the key column");
  });

  let dupRowId = null;
  await step("unique index is enforced on key", async () => {
    const first = await pbJson("/api/collections/consuela_state/records", adminToken, {
      method: "POST",
      body: JSON.stringify({ key: TEST_STATE_KEY, value: 1 }),
    });
    assert.ok(first?.id, `first create failed: ${JSON.stringify(first).slice(0, 200)}`);
    dupRowId = first.id;
    let blocked = false;
    try {
      await pbJson("/api/collections/consuela_state/records", adminToken, {
        method: "POST",
        body: JSON.stringify({ key: TEST_STATE_KEY, value: 2 }),
      });
    } catch (e) {
      blocked = /unique|constraint|400/i.test(String(e.message));
    }
    assert.ok(blocked, "duplicate key create should be rejected (unique index)");
    await fetch(`${PB_URL}/api/collections/consuela_state/records/${dupRowId}`, {
      method: "DELETE",
      headers: { authorization: adminToken },
    });
  });

  await step("re-run seed is idempotent", async () => {
    const output2 = runSeed();
    assert.ok(
      output2.includes("consuela_state") &&
        (output2.includes("already exists") || output2.includes("patched")),
      `expected "already exists"/"patched" for consuela_state, got: ${output2.slice(0, 300)}`
    );
  });

  // --- 2. Route auth + no-token branches ---
  await step("POST without Bearer CRON_SECRET returns 401", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/cron/consuela/telegram-poll", { method: "POST" })
    );
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, "unauthorized");
  });

  await step("TELEGRAM_MIRROR_BOT_TOKEN unset -> { ok:false, reason:no_token } 200", async () => {
    const prev = process.env.TELEGRAM_MIRROR_BOT_TOKEN;
    delete process.env.TELEGRAM_MIRROR_BOT_TOKEN;
    try {
      const res = await post();
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.reason, "no_token");
    } finally {
      process.env.TELEGRAM_MIRROR_BOT_TOKEN = prev;
    }
  });

  // --- 3. pollTelegramUpdates error propagation (C2) ---
  await step("pollTelegramUpdates throws with Telegram description on data.ok=false", async () => {
    tgResponder = () =>
      Promise.resolve({
        ok: true,
        status: 401,
        json: async () => ({ ok: false, error_code: 401, description: "Unauthorized: bad token" }),
      });
    try {
      await assert.rejects(
        pollTelegramUpdates(undefined),
        /Unauthorized: bad token/,
        "should throw with the API description"
      );
    } finally {
      tgResponder = null;
    }
  });

  // --- 4. Mirroring run ---
  await step("cleanup: remove pre-existing test rows + state", async () => {
    await cleanupTestData(adminToken);
  });

  let first = null;
  await step("first poll mirrors 2 text messages (skips bot + no-text updates)", async () => {
    first = await (await post()).json();
    assert.equal(first.ok, true);
    assert.equal(first.processed, 2, `expected 2 processed, got ${first.processed}`);
    assert.equal(first.lastUpdateId, EXPECTED_LAST_ID, "lastUpdateId should be the max update id seen");
  });

  await step("chat_messages has exactly 2 rows, source=telegram, correct normalization", async () => {
    const filter = encodeURIComponent(`content~"${MSG_MARKER}"`);
    const data = await pbJson(`/api/collections/chat_messages/records?filter=${filter}&sort=createdAt&perPage=100`, adminToken);
    const rows = data.items || [];
    assert.equal(rows.length, 2, `expected 2 rows, got ${rows.length}`);
    for (const row of rows) {
      assert.equal(row.source, "telegram");
      assert.equal(row.role, "user");
      assert.equal(row.threadId, EXPECTED_THREAD_ID, `threadId should be ${EXPECTED_THREAD_ID}`);
      assert.ok(row.content.startsWith(MSG_MARKER), `unexpected content: ${row.content}`);
      assert.ok(!row.content.includes("bot-should-be-skipped"), "bot message must not be mirrored");
      assert.ok(row.createdAt, "createdAt set");
    }
    const userIds = rows.map((r) => r.userId).sort();
    assert.deepEqual(userIds, ["Jeffery", "Rebecca"], "userId should be the sender first_name");
  });

  await step("last_telegram_update_id persisted in consuela_state", async () => {
    const value = await db.getState(STATE_KEY);
    assert.equal(value, EXPECTED_LAST_ID, `expected ${EXPECTED_LAST_ID}, got ${JSON.stringify(value)}`);
  });

  let second = null;
  await step("second poll with same offset -> processed 0 (dedupe)", async () => {
    second = await (await post()).json();
    assert.equal(second.ok, true);
    assert.equal(second.processed, 0, `expected 0 processed, got ${second.processed}`);
    assert.equal(second.lastUpdateId, EXPECTED_LAST_ID);
  });

  await step("no duplicate chat_messages rows after second poll", async () => {
    const count = await countMirrorRows(adminToken);
    assert.equal(count, 2, `expected still 2 rows, got ${count}`);
  });

  // --- 5. I2: 429/5xx backoff (offset untouched) ---
  await step("429 response -> ok:false reason:rate_limited, offset untouched (I2)", async () => {
    // I6 — CAS: pass the actual current value as expectedPrev, otherwise the
    // row holding EXPECTED_LAST_ID refuses the "reset to 100".
    const currentOffset = await db.getState(STATE_KEY);
    assert.equal(currentOffset, EXPECTED_LAST_ID, "precondition: offset is at the expected last id");
    const reset = await db.setState(STATE_KEY, 100, currentOffset);
    assert.equal(reset, true, "reset to 100 must succeed");
    tgResponder = () =>
      Promise.resolve({ ok: false, status: 429, json: async () => ({ ok: false }) });
    try {
      const res = await post();
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.reason, "rate_limited", "429 must map to rate_limited");
      assert.equal(json.lastUpdateId, undefined, "no offset advance in the response");
    } finally {
      tgResponder = null;
    }
    const value = await db.getState(STATE_KEY);
    assert.equal(value, 100, "offset must NOT advance on 429");
    await fetch(`${PB_URL}/api/collections/consuela_state/records?filter=${encodeURIComponent(`key="${STATE_KEY}"`)}&perPage=10`, {
      headers: { authorization: adminToken },
    }).then(async (r) => {
      const data = await r.json();
      for (const row of data.items || []) {
        await fetch(`${PB_URL}/api/collections/consuela_state/records/${row.id}`, {
          method: "DELETE",
          headers: { authorization: adminToken },
        });
      }
    });
  });

  // --- 6. I6: setState compare-and-set ---
  await step("setState CAS refuses stale expectedPrev (I6)", async () => {
    // Pre-clean any leftover row from an interrupted earlier run so the
    // "initial write" CAS (expectedPrev=null, no row) starts fresh.
    const leftovers = await pbJson(
      `/api/collections/consuela_state/records?filter=${encodeURIComponent(`key="${TEST_STATE_KEY}"`)}&perPage=10`,
      adminToken
    );
    for (const row of leftovers.items || []) {
      await fetch(`${PB_URL}/api/collections/consuela_state/records/${row.id}`, {
        method: "DELETE",
        headers: { authorization: adminToken },
      });
    }
    assert.equal(await db.setState(TEST_STATE_KEY, 50, null), true, "initial write");
    assert.equal(await db.setState(TEST_STATE_KEY, 100, 50), true, "advance with correct prev");
    assert.equal(await db.setState(TEST_STATE_KEY, 200, 50), false, "stale expectedPrev must be refused");
    assert.equal(await db.getState(TEST_STATE_KEY), 100, "row keeps the first write");
    assert.equal(await db.setState(TEST_STATE_KEY, 200, 100), true, "advance with the real prev");
    const data = await pbJson(
      `/api/collections/consuela_state/records?filter=${encodeURIComponent(`key="${TEST_STATE_KEY}"`)}&perPage=10`,
      adminToken
    );
    for (const row of data.items || []) {
      await fetch(`${PB_URL}/api/collections/consuela_state/records/${row.id}`, {
        method: "DELETE",
        headers: { authorization: adminToken },
      });
    }
    assert.equal(await db.getState(TEST_STATE_KEY), null, "test state row cleaned up");
  });

  // --- 7. L10: bot token redaction in error responses ---
  await step("telegram_error response redacts the bot token (L10)", async () => {
    tgResponder = async () => {
      throw new Error(`fetch failed: https://api.telegram.org/bot${MOCK_TOKEN}/getUpdates?offset=1&timeout=10`);
    };
    try {
      const res = await post();
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.reason, "telegram_error");
      assert.ok(!String(json.error || "").includes(MOCK_TOKEN), `token leaked: ${json.error}`);
      assert.ok(String(json.error || "").includes("<redacted telegram url>"), "placeholder missing");
    } finally {
      tgResponder = null;
    }
  });

  // --- 5. Cleanup ---
  await step("cleanup: delete test chat rows + state row", async () => {
    await cleanupTestData(adminToken);
    const count = await countMirrorRows(adminToken);
    assert.equal(count, 0, `expected 0 rows after cleanup, got ${count}`);
    const value = await db.getState(STATE_KEY);
    assert.equal(value, null, "state row should be removed after cleanup");
  });

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}

// Env + imports. Route reads CRON_SECRET / TELEGRAM_MIRROR_BOT_TOKEN at request time.
({ POST } = await import("../../src/app/api/cron/consuela/telegram-poll/route.ts"));
({ pollTelegramUpdates } = await import("../../src/lib/telegram/get-updates.ts"));
const { db } = await import("../../src/db/index.ts");

installTgMock();

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
