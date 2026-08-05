#!/usr/bin/env node
// Task 3.3 probe — dashboard chat writes to the unified PB thread.
//
// Hermes is unreachable from dev machines, so fetch is mocked exactly like
// test-chat-route-mock.mjs (native OpenAI tool-calling shape). PocketBase at
// 127.0.0.1:8091 is real, so the assertions prove real rows land in the DB.
//
// Usage:
//   set -a; source .env.integration; set +a
//   npx tsx scripts/consuela/test-chat-thread.mjs
//
// What it verifies (C1 + C3 + C5):
//   1. POST /api/hermes/chat with a mocked content reply inserts exactly 2
//      chat_messages rows into today's thread: user (guest, dashboard) first,
//      assistant (consuela, dashboard) second, ordered by createdAt.
//   2. No tool-call reply still persists the pair (the no-tool-call return path).
//   3. GET /api/chat/messages?threadId=<today> returns { ok:true, messages:[...] }
//      with the pair in order; an unknown threadId returns an empty list.
//   4. Cleanup: the probe's marked rows are deleted at the end.

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Must be set before the route modules load (constants are read at import time).
process.env.HERMES_API_URL = "http://hermes-mock:8642";
process.env.HERMES_API_KEY = "mock-key";

const { POST } = await import("../../src/app/api/hermes/chat/route.ts");
const { GET } = await import("../../src/app/api/chat/messages/route.ts");

const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
if (!ADMIN_EMAIL || !ADMIN_PASS) {
  console.error("PB_ADMIN_EMAIL / PB_ADMIN_PASS missing — source .env.integration first");
  process.exit(2);
}

const TODAY = new Date().toISOString().split("T")[0];
const MARK = `task-3.3-probe-${Date.now()}`;
const MARK_REPLY = "Task 3.3 mock reply";

// PocketBase talks to 127.0.0.1:8091 through the same global fetch, so the
// Hermes mock must pass every non-completions request straight through.
const realFetch = global.fetch;

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

// ---- PB admin helpers (mirror test-chat-messages.mjs) ----

async function pbAdminToken() {
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

async function threadRows(token, threadId, filterExtra = "") {
  const filter = encodeURIComponent(`threadId="${threadId}"${filterExtra}`);
  const data = await pbJson(
    `/api/collections/chat_messages/records?filter=${filter}&perPage=200&sort=createdAt`,
    token
  );
  return data.items || [];
}

async function deleteRow(token, id) {
  await fetch(`${PB_URL}/api/collections/chat_messages/records/${id}`, {
    method: "DELETE",
    headers: { authorization: token },
  });
}

// ---- mock fetch for Hermes ----

function completion({ content = "", tool_calls } = {}) {
  return {
    choices: [{ message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }],
  };
}

function toolCall(id, name, args = "{}") {
  return { id, type: "function", function: { name, arguments: args } };
}

function post(message) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    })
  );
}

async function main() {
  console.log(`PB: ${PB_URL} | today's thread: ${TODAY} | marker: ${MARK}`);

  let token;
  await step("authenticate with PB admin", async () => {
    token = await pbAdminToken();
  });

  // Remove any leftover rows from a previous crashed run.
  await step("cleanup: remove stale probe rows", async () => {
    const stale = await threadRows(token, TODAY, ` && content="${MARK}"`);
    for (const r of stale) await deleteRow(token, r.id);
  });

  const before = await threadRows(token, TODAY);
  let cursor = before.length;

  // ---- 1. no-tool reply path persists the pair ----
  await step("POST /api/hermes/chat (no tool call) persists 2 rows", async () => {
    global.fetch = async (url, init) => {
      if (!String(url).includes("/v1/chat/completions")) return realFetch(url, init);
      assert.match(String(url), /\/v1\/chat\/completions$/, "calls the Hermes endpoint");
      const payload = completion({ content: MARK_REPLY });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      };
    };

    const res = await post(MARK);
    const json = await res.json();
    assert.equal(json.content, MARK_REPLY, "reply content reaches the client");

    const after = await threadRows(token, TODAY);
    const newRows = after.slice(cursor);
    assert.equal(newRows.length, 2, `expected exactly 2 new rows, got ${newRows.length}`);
    assert.equal(newRows[0].userId, "guest", "user row userId defaults to guest");
    assert.equal(newRows[0].role, "user", "first row is the user message");
    assert.equal(newRows[0].content, MARK, "user row carries the sent message");
    assert.equal(newRows[0].source, "dashboard", "user row source is dashboard");
    assert.equal(newRows[1].userId, "consuela", "assistant row userId is consuela");
    assert.equal(newRows[1].role, "assistant", "second row is the assistant message");
    assert.equal(newRows[1].content, MARK_REPLY, "assistant row carries the reply");
    assert.equal(newRows[1].source, "dashboard", "assistant row source is dashboard");
    const t0 = new Date(newRows[0].createdAt).getTime();
    const t1 = new Date(newRows[1].createdAt).getTime();
    assert.ok(t1 >= t0, "rows ordered by createdAt asc");
    cursor += 2;
  });

  // ---- 2. tool-call loop reply also persists the pair ----
  await step("POST /api/hermes/chat (tool loop) persists 2 rows", async () => {
    const canned = [
      completion({ tool_calls: [toolCall("call_1", "get_family_members", "{}")] }),
      completion({ content: MARK_REPLY }),
    ];
    let i = 0;
    global.fetch = async (url, init) => {
      if (!String(url).includes("/v1/chat/completions")) return realFetch(url, init);
      const payload = canned[i++];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      };
    };

    const marker = `${MARK}-tool-loop`;
    const res = await post(marker);
    const json = await res.json();
    assert.equal(json.content, MARK_REPLY, "reply content reaches the client");
    assert.equal(i, 2, "tool loop ran two Hermes calls");

    const after = await threadRows(token, TODAY);
    const newRows = after.slice(cursor);
    assert.equal(newRows.length, 2, `expected 2 rows for the tool-loop message, got ${newRows.length}`);
    assert.equal(newRows[0].role, "user", "user row first");
    assert.equal(newRows[0].content, marker, "user row content is the tool-loop message");
    assert.equal(newRows[1].role, "assistant", "assistant row second");
    assert.equal(newRows[1].content, MARK_REPLY, "assistant row content is the final reply");
    cursor += 2;
  });

  // ---- 3. GET /api/chat/messages returns the ordered thread ----
  await step("GET /api/chat/messages?threadId=<today> returns the pair in order", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/chat/messages?threadId=${TODAY}`));
    const json = await res.json();
    assert.equal(json.ok, true, "ok flag set");
    assert.equal(json.threadId, TODAY, "threadId echoed");
    assert.ok(Array.isArray(json.messages), "messages is an array");
    assert.ok(json.messages.length >= 2, `thread has at least 2 rows (got ${json.messages.length})`);
    const marked = json.messages.filter((m) => m.content === MARK);
    assert.equal(marked.length, 1, "probe user row present");
    assert.equal(marked[0].role, "user");
    const times = json.messages.map((m) => new Date(m.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] >= times[i - 1], "rows ordered by createdAt asc");
    }
  });

  await step("GET /api/chat/messages with an empty threadId returns { ok:true, messages:[] }", async () => {
    const res = await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2099-01-01"));
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.deepEqual(json.messages, []);
  });

  // ---- 4. cleanup ----
  await step("cleanup: delete probe rows", async () => {
    const rows = await threadRows(token, TODAY, ` && (content="${MARK}" || content="${MARK}-tool-loop" || content="${MARK_REPLY}")`);
    for (const r of rows) {
      const fromProbe =
        r.content === MARK ||
        r.content === `${MARK}-tool-loop` ||
        (r.content === MARK_REPLY && r.userId === "consuela" && r.source === "dashboard");
      if (fromProbe) await deleteRow(token, r.id);
    }
    const leftovers = await threadRows(token, TODAY, ` && (content="${MARK}" || content="${MARK}-tool-loop")`);
    assert.equal(leftovers.length, 0, "probe rows removed");
  });

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
