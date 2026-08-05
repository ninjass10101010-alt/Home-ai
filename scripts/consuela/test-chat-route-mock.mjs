#!/usr/bin/env node
// Mock-fetch unit probe for Task 2.3 — /api/hermes/chat now speaks native OpenAI
// tool-calling (no JSON envelope, no extractJSON). The Hermes gateway is unreachable
// from dev machines, so this script imports the route module, stubs global.fetch with
// canned OpenAI-style chat-completion responses, and asserts the full tool-call loop:
// tool_calls -> handler runs -> { role:"tool" } result messages -> final natural reply.
//
// Usage:
//   npx tsx scripts/consuela/test-chat-route-mock.mjs
//
// What it verifies (C1 + C4 + C5):
//   1. No-tool path: a single Hermes call carrying `tools` + `tool_choice:"auto"`;
//      the content is returned straight to the client.
//   2. Tool-call loop: a canned `tool_calls` for get_family_members -> the handler's
//      real output is appended as { role:"tool", tool_call_id, content } on the second
//      Hermes call, and the final content reaches the client.
//   3. Parallel tool_calls: both handlers run and both tool result messages are fed
//      back (C4 — iterate all calls, not just [0]).
//   4. Unknown tool: an { error: "Unknown tool..." } tool message is fed back so the
//      model can recover, and the loop still ends with a natural reply (C5).
//   5. MAX_ROUNDS cap: a model that always answers with tool_calls is cut off after
//      4 rounds with the friendly fallback content.
//
// No network traffic occurs: fetch is fully mocked and the tools exercised
// (get_family_members / get_todays_events) read the in-memory DB only.

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Must be set before the route module loads (the constants are read at import time).
process.env.HERMES_API_URL = "http://hermes-mock:8642";
process.env.HERMES_API_KEY = "mock-key";

const { POST } = await import("../../src/app/api/hermes/chat/route.ts");

let failures = 0;
const passed = [];
const failed = [];

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

// ---- canned OpenAI-style responses ----

function cannedCompletion(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

function completion({ content = "", tool_calls } = {}) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
          ...(tool_calls ? { tool_calls } : {}),
        },
      },
    ],
  };
}

function toolCall(id, name, args = "{}") {
  return { id, type: "function", function: { name, arguments: args } };
}

// ---- fetch mock harness ----

let fetchCalls = [];

function mockFetch(handler) {
  global.fetch = async (url, init) => {
    // Only Hermes chat-completion calls are under test; the route also persists
    // each chat pair to PocketBase (chat_messages) via internal fetches, which
    // would skew the call counts.
    if (!String(url).includes("/v1/chat/completions")) {
      return handler(fetchCalls.length, url, init);
    }
    fetchCalls.push({ url: String(url), init });
    return handler(fetchCalls.length, url, init);
  };
}

function post(message, history) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, ...(history ? { history } : {}) }),
    })
  );
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

// ---- tests ----

await step("no-tool path: tools sent, content returned directly", async () => {
  fetchCalls = [];
  mockFetch(() => cannedCompletion(completion({ content: "Hi there, anything else?" })));

  const res = await post("hello");
  const json = await res.json();

  assert.equal(fetchCalls.length, 1, "exactly one Hermes call");
  assert.equal(json.content, "Hi there, anything else?");
  const sent = bodyOf(fetchCalls[0]);
  assert.ok(Array.isArray(sent.tools) && sent.tools.length > 0, "tools array sent");
  assert.equal(sent.tools[0].type, "function", "OpenAI tool shape");
  assert.equal(sent.tool_choice, "auto");
  assert.equal(sent.messages[0].role, "system", "persona system prompt first");
  assert.match(
    sent.messages[0].content,
    /^You are Consuela, the Garcia family's AI assistant\./,
    "persona system prompt sent"
  );
  assert.ok(!sent.messages[0].content.includes('"tool_call"'), "no JSON envelope in the prompt");
  assert.equal(sent.messages[1].role, "user");
  assert.equal(sent.messages[1].content, "hello");
});

await step("tool-call loop: handler result fed back as tool message, then final reply", async () => {
  fetchCalls = [];
  const canned = [
    completion({ tool_calls: [toolCall("call_family_1", "get_family_members", "{}")] }),
    completion({ content: "Here are your family members!" }),
  ];
  mockFetch((i) => cannedCompletion(canned[i - 1]));

  const res = await post("who is in the family?");
  const json = await res.json();

  assert.equal(json.content, "Here are your family members!");
  assert.equal(fetchCalls.length, 2, "exactly two Hermes calls");

  const second = bodyOf(fetchCalls[1]);
  const toolMsg = second.messages.find((m) => m.role === "tool");
  assert.ok(toolMsg, "second call includes a tool result message");
  assert.equal(toolMsg.tool_call_id, "call_family_1", "tool_call_id echoed back");
  assert.match(String(toolMsg.content), /Rebecca/, "tool result contains real handler output");

  const asst = second.messages.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
  assert.ok(asst, "assistant tool_calls message preserved for the model");
  assert.equal(asst.tool_calls[0].function.name, "get_family_members");
});

await step("parallel tool_calls: every call runs, every result is fed back", async () => {
  fetchCalls = [];
  const canned = [
    completion({
      tool_calls: [
        toolCall("call_a", "get_family_members", "{}"),
        toolCall("call_b", "get_todays_events", "{}"),
      ],
    }),
    completion({ content: "Got both." }),
  ];
  mockFetch((i) => cannedCompletion(canned[i - 1]));

  const res = await post("who is around today?");
  const json = await res.json();

  assert.equal(json.content, "Got both.");
  assert.equal(fetchCalls.length, 2);
  const second = bodyOf(fetchCalls[1]);
  const toolMsgs = second.messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 2, "two tool result messages");
  assert.deepEqual(
    toolMsgs.map((m) => m.tool_call_id).sort(),
    ["call_a", "call_b"],
    "both tool_call_ids present"
  );
});

await step("unknown tool: error fed back so the model can recover", async () => {
  fetchCalls = [];
  const canned = [
    completion({ tool_calls: [toolCall("call_x", "nonexistent_tool", "{}")] }),
    completion({ content: "I don't have that ability yet." }),
  ];
  mockFetch((i) => cannedCompletion(canned[i - 1]));

  const res = await post("do the thing");
  const json = await res.json();

  assert.equal(json.content, "I don't have that ability yet.");
  assert.equal(fetchCalls.length, 2, "loop continues after the unknown tool");
  const second = bodyOf(fetchCalls[1]);
  const toolMsg = second.messages.find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool message fed back");
  assert.match(String(toolMsg.content), /Unknown tool/, "mentions the unknown tool");
});

await step("MAX_ROUNDS cap: model that never stops calling tools is cut off at 4", async () => {
  fetchCalls = [];
  mockFetch(() => cannedCompletion(completion({ tool_calls: [toolCall("call_loop", "get_family_members", "{}")] })));

  const res = await post("keep going");
  const json = await res.json();

  assert.equal(fetchCalls.length, 4, "capped at MAX_ROUNDS=4");
  assert.match(json.content, /ran out of steps/, "friendly fallback content");
});

await step("history: prior turns are mapped into native chat messages", async () => {
  fetchCalls = [];
  mockFetch(() => cannedCompletion(completion({ content: "ok" })));

  const res = await post("what next?", [
    { role: "user", content: "tell me about today" },
    { role: "assistant", content: "Here is your day." },
  ]);
  await res.json();

  assert.equal(fetchCalls.length, 1);
  const sent = bodyOf(fetchCalls[0]);
  const roles = sent.messages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user"], "history mapped, newest user last");
  assert.equal(sent.messages[1].content, "tell me about today");
  assert.equal(sent.messages[2].content, "Here is your day.");
});

// ---- summary ----

console.log(`\n${passed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.error("Failures:");
  for (const f of failed) console.error(`  - ${f}`);
}
process.exitCode = failures > 0 ? 1 : 0;
