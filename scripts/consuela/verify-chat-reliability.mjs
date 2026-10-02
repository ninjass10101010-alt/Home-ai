#!/usr/bin/env node
/**
 * Chat reliability probe (2026-10-01 plan, Task 18).
 *
 * Covers the CLIENT half of the ARCHITECTURE.md §5.7 wire contract: the
 * stale-optimistic-id collision, the reasoning transcript, tool-activity chips
 * surviving onto the settled message, the (round x target) attempt reset,
 * verbatim route errors, and a mid-stream transport drop.
 *
 * NOT the route: `/api/hermes/chat` is 307'd wholesale to the loopback server
 * below, so no `route.ts` code runs here. The frame SEQUENCES are transcribed
 * from the route, which is why they matter — a frame order the route cannot
 * produce would make every assertion below vacuous.
 *
 * WHY A REAL LOOPBACK SSE SERVER INSTEAD OF `route.fulfill`
 * ---------------------------------------------------------
 * `route.fulfill({ body })` is structurally incapable of streaming: Playwright
 * base64-encodes the body into ONE `Fetch.fulfillRequest` protocol message
 * (playwright-core/lib/coreBundle.js — `Buffer.from(response2.body).toString("base64")`),
 * so a fulfilled SSE body arrives as a single chunk. Passing a `Readable` there
 * does not throw either — it resolves and the page never receives response
 * headers at all. Every intermediate client state is therefore batched away and
 * the transcript / attempt-reset assertions below would pass vacuously.
 *
 * So the chat endpoint is a real chunked HTTP response from a loopback server in
 * this process, reached by a 307 from the route handler: Chromium follows the
 * redirect natively and `res.body` is a real socket-backed stream. Measured
 * with a 350 ms inter-frame gap: 4 chunks at 4 distinct arrival timestamps.
 * That is what makes the `gate` assertions real — each one asserts a state the
 * page reached BEFORE a later frame was written, so a buffered body cannot
 * satisfy it.
 *
 * Gate discipline: a gate parks the frame whose effect must NOT be visible yet,
 * so the probe observes first and releases after. No gate races an assertion.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { finished } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProbeEnv } from "./probe-env.mjs";
import {
  createIdempotentProbeCleanup,
  installFontRouteGuards,
  installProbeSignalHandlers,
} from "./probe-helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAT_ENDPOINT = "/api/hermes/chat";
const CHAT_STORAGE_KEY = "consuela-chat-messages";
const KEEP_ARTIFACTS = process.env.KEEP_CHAT_RELIABILITY_ARTIFACTS === "1";
/**
 * Reuse an already-running dev server instead of booting one. Next 16 allows a
 * single dev server per directory, so on a shared checkout another session's
 * server makes `bootDevServer` impossible — and killing it is not ours to do.
 * A server adopted this way was NOT started with `buildProbeEnv`, so it carries
 * that session's env; the `**\/api\/**` catch-all still keeps the probe's own
 * traffic off every real service. Never set this when a probe run must prove the
 * boot path.
 */
const EXTERNAL_BASE_URL = (process.env.CHAT_RELIABILITY_BASE_URL ?? "").replace(/\/$/, "");
/** A gate the probe never opens is a probe bug, not a product bug — bound it. */
const GATE_DEADLINE_MS = 60_000;
/** Inter-frame spacing on streamed scenarios; generous so assertions never race. */
const FRAME_GAP_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let baseUrl = "";
let ssePort = 0;
let server = null;
let browser = null;
let logDir = "";
let cleanupProbe = async () => {};
const fontRequests = [];
const sensitiveRequests = [];
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
}

/** Dev-server harness, verbatim from verify-emergency-settings.mjs. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      const port = typeof address === "object" && address ? address.port : null;
      reservation.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("could not reserve an ephemeral port"));
      });
    });
  });
}

function bootDevServer(port, appUrl, dir) {
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logPath = path.join(dir, "next-dev.log");
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: buildProbeEnv(appUrl),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const server = { child, log, logPath, childError: null };
  child.once("error", (error) => {
    server.childError = error;
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return server;
}

async function finishLogStream(log) {
  if (log.closed) return;
  log.end();
  await finished(log);
}

async function stopDevServer(server) {
  if (!server) return;
  const { child, log } = server;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
    const timedOut = await Promise.race([exited.then(() => false), sleep(5000).then(() => true)]);
    if (timedOut && child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
      await Promise.race([once(child, "exit"), sleep(2000)]);
    }
  }
  await finishLogStream(log);
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
}

async function waitForReady(server, deadlineMs = 240_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (server.childError) throw server.childError;
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(
        `dev server exited before readiness (code=${server.child.exitCode}, signal=${server.child.signalCode})`,
      );
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
      let readyLog = false;
      try {
        readyLog = /Ready in/i.test(readFileSync(server.logPath, "utf8"));
      } catch {}
      if (response.status === 200 && readyLog && server.child.exitCode === null && server.child.signalCode === null) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("dev server did not become ready");
}

function serverLogTail(logPath) {
  if (EXTERNAL_BASE_URL) return `(adopted external dev server at ${EXTERNAL_BASE_URL} — no probe log)`;
  try {
    return readFileSync(logPath, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "(no server log)";
  }
}

async function waitForExternalReady(url, deadlineMs = 120_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status === 200) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`external dev server at ${url} never answered 200`);
}

/**
 * The streaming chat origin. One scenario is armed at a time. A scenario is
 * either `frames` (written in order, chunked, optionally parked on a `gate`)
 * or `buffered` (the whole body in one write — the no-timing-dependency cases).
 */
function bootSseServer() {
  const state = { scenario: null, gates: new Set(), writes: [] };

  const releaseGate = async (name) => {
    const deadline = Date.now() + GATE_DEADLINE_MS;
    while (Date.now() < deadline) {
      if (state.gates.has(name)) return;
      await sleep(25);
    }
    throw new Error(`probe never released SSE gate: ${name}`);
  };

  const http = createHttpServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const scenario = state.scenario;
    if (!req.url?.startsWith(CHAT_ENDPOINT) || !scenario) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    req.resume();
    const headers = {
      ...cors,
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    };
    if (scenario.dropMidStream) {
      // Overstate the length so the truncation is a real transport error
      // (ERR_CONTENT_LENGTH_MISMATCH) rather than a clean end-of-body that the
      // client would happily treat as a finished reply.
      const promised = scenario.frames.reduce((n, f) => n + Buffer.byteLength(f.frame), 0) + 256;
      headers["content-length"] = String(promised);
    }
    res.writeHead(200, headers);
    try {
      if (scenario.buffered !== undefined) {
        state.writes.push({ buffered: true, at: Date.now() });
        res.end(scenario.buffered);
        return;
      }
      for (const step of scenario.frames) {
        if (step.gate) await releaseGate(step.gate);
        if (res.writableEnded || res.destroyed) return;
        state.writes.push({ gate: step.gate ?? null, at: Date.now() });
        res.write(step.frame);
        await sleep(step.waitMs ?? FRAME_GAP_MS);
      }
      if (scenario.dropMidStream) {
        // Gated so the probe can assert the partial token was really on screen
        // before the transport went away.
        if (scenario.dropGate) await releaseGate(scenario.dropGate);
        // Truncate the chunked body instead of ending it cleanly — what a
        // transport-level mid-stream drop looks like to the fetch body reader.
        res.socket?.destroy();
        return;
      }
      res.end();
    } catch (error) {
      res.socket?.destroy();
      console.error(`  [sse] ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return {
    http,
    state,
    arm(scenario) {
      state.scenario = scenario;
      state.gates.clear();
      state.writes.length = 0;
    },
    openGate(name) {
      state.gates.add(name);
    },
    async listen() {
      await new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(0, "127.0.0.1", resolve);
      });
      return http.address().port;
    },
    async close() {
      await new Promise((resolve) => http.close(resolve));
    },
  };
}

const sse = bootSseServer();

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function openChat(seedMessages) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // Context, not page: the seed must land before the chat store reads storage.
  // `consuela-data-epoch` is seeded too because `SyncInit` removes every demo
  // key — including `consuela-chat-messages` — on any device whose epoch is
  // behind, which would delete the very rows the stale-id scenario is about.
  await context.addInitScript((seed) => {
    localStorage.clear();
    localStorage.setItem("consuela-data-epoch", "999999");
    if (seed) localStorage.setItem("consuela-chat-messages", JSON.stringify(seed));
  }, seedMessages ?? null);
  await installFontRouteGuards(context, fontRequests);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const body = request.postData();
    if (body && /"(?:pin|token|secret|api[_-]?key)"\s*:/i.test(body)) {
      sensitiveRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === CHAT_ENDPOINT) {
      await route.fulfill({
        status: 307,
        headers: { location: `http://127.0.0.1:${ssePort}${CHAT_ENDPOINT}` },
      });
      return;
    }
    if (pathname === "/api/chat/messages") {
      await fulfillJson(route, { ok: true, messages: [] });
      return;
    }
    if (pathname === "/api/members/admin") {
      await fulfillJson(route, { ok: true, source: "live", members: [] });
      return;
    }
    await fulfillJson(route, { ok: true, data: [], items: [], members: [], contacts: [] });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));
  await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("textarea").waitFor({ state: "visible", timeout: 60_000 });
  return { context, page };
}

const countText = (page, text) => page.getByText(text, { exact: true }).count();

async function waitForText(page, text, timeout = 30_000) {
  await page.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout });
}

const persistedRows = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), CHAT_STORAGE_KEY);

/**
 * Fill-and-send, retried. `UnifiedInput` is keyed on the quick-action draft, so
 * a dev-mode StrictMode remount landing right after the fill discards the
 * controlled value and leaves Send disabled for good; re-filling recovers.
 */
async function ask(page, text) {
  const button = page.getByTitle("Send message");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator("textarea").fill(text);
    await sleep(250);
    if (await button.isEnabled()) break;
  }
  await button.click({ timeout: 30_000 });
}

/**
 * Whether two strings live in the same rendered message bubble.
 *
 * `MessageRow`'s per-message content column is the only structural hook, so this
 * is deliberately coupled to `space-y-2` there: if that markup moves the probe
 * fails loudly instead of quietly ceasing to test anything. A naive
 * "is the sentinel inside any ancestor of the reply" test cannot work — the
 * whole thread is a shared ancestor of every message.
 */
function bubblesOverlap(page, reply, sentinel) {
  return page.evaluate(({ reply: a, sentinel: b }) => {
    const leaf = (text) => {
      let found = null;
      for (const node of document.querySelectorAll("*")) {
        if (node.children.length === 0 && (node.textContent ?? "").trim() === text) found = node;
      }
      return found;
    };
    const rowOf = (node) => node?.closest("div.space-y-2") ?? null;
    const replyLeaf = leaf(a);
    const sentinelLeaf = leaf(b);
    if (!replyLeaf || !sentinelLeaf) return { missing: replyLeaf ? b : a, shared: null };
    const replyRow = rowOf(replyLeaf);
    if (!replyRow) return { missing: null, shared: null };
    return { missing: null, shared: replyRow === rowOf(sentinelLeaf) };
  }, { reply, sentinel });
}

/**
 * Whether the error chip lives in the SAME rendered message row as the reply.
 *
 * `bubblesOverlap` above matches a sentinel by its exact text, which a chip
 * cannot offer: the chip span is not a text leaf (it carries a glyph span and an
 * sr-only span), and its label is only part of its `textContent`. So the chip is
 * located by selector and the reply by text, then both are walked up to the
 * `space-y-2` content column `MessageRow` renders.
 */
async function chipSharesReplyRow(page, reply) {
  return page.evaluate(({ reply: a, selector }) => {
    let replyLeaf = null;
    for (const node of document.querySelectorAll("*")) {
      if (node.children.length === 0 && (node.textContent ?? "").trim() === a) replyLeaf = node;
    }
    const chip = document.querySelector(selector);
    const replyRow = replyLeaf?.closest("div.space-y-2") ?? null;
    const chipRow = chip?.closest("div.space-y-2") ?? null;
    return {
      shared: replyRow !== null && chipRow !== null && replyRow === chipRow,
      detail: !replyLeaf ? "no reply bubble" : !chip ? "no error chip" : "",
    };
  }, { reply, selector: '[data-testid="tool-activity"] [data-state="error"]' });
}

/** Scenario 1 — the headline bug: a prior session's rows must not be overwritten. */
async function scenarioStaleIdCollision() {
  const STALE_ASSISTANT = "stale-assistant-row-from-yesterday";
  const STALE_USER = "stale-user-row-from-yesterday";
  const REPLY = "REPLY-UNDER-TEST";
  const { context, page } = await openChat([
    { id: 101, role: "assistant", content: STALE_ASSISTANT, timestamp: "Yesterday", at: 1 },
    { id: 102, role: "user", content: STALE_USER, timestamp: "Yesterday", at: 2 },
  ]);

  // Hydration is the gate: the seeded rows on screen prove the store read
  // storage, and they are the rows a colliding id would overwrite.
  await waitForText(page, STALE_ASSISTANT);
  check("stale-id collision: both seeded rows hydrate from localStorage", (await countText(page, STALE_USER)) > 0);

  sse.arm({ buffered: `data: {"t":"${REPLY}"}\n\ndata: [DONE]\n\n` });
  await ask(page, "what is on tonight?");
  await waitForText(page, REPLY);

  check("stale-id collision: the reply renders", (await countText(page, REPLY)) > 0);
  check("stale-id collision: stale row 101 survives", (await countText(page, STALE_ASSISTANT)) > 0);
  check("stale-id collision: stale row 102 survives", (await countText(page, STALE_USER)) > 0);

  const overlap = await bubblesOverlap(page, REPLY, STALE_ASSISTANT);
  check(
    "stale-id collision: the reply is its own bubble, not the stale row",
    overlap.missing === null && overlap.shared === false,
    overlap.missing ? `no bubble for "${overlap.missing}"` : "",
  );

  const rows = await persistedRows(page);
  const ids = rows.map((m) => m.id);
  const holds = (text) => rows.some((m) => m.content === text);
  check(
    "stale-id collision: the persisted thread keeps both stale rows and the reply",
    holds(STALE_ASSISTANT) && holds(STALE_USER) && holds(REPLY),
    `${rows.length} rows`,
  );
  check(
    "stale-id collision: persisted ids are unique, so no row was overwritten",
    new Set(ids).size === ids.length,
    ids.join(","),
  );

  await context.close();
}

/** Scenario 2 — reasoning renders live, then auto-collapses when the answer starts. */
async function scenarioReasoningTranscript() {
  const THINKING = "checking the calendar and the weather";
  const REPLY = "Soccer at 5.";
  sse.arm({
    frames: [
      { frame: 'event: attempt\ndata: {"round":1,"target":"t0"}\n\n' },
      { frame: `event: reasoning\ndata: {"r":"${THINKING}"}\n\n` },
      { frame: 'event: reasoning\ndata: {"r":" and the pickup times"}\n\n' },
      // Gated: the answer must still be unwritten while the live transcript is asserted.
      { frame: `data: {"t":"${REPLY}"}\n\n`, gate: "answer-token" },
      { frame: "data: [DONE]\n\n" },
    ],
  });

  const { context, page } = await openChat(null);
  await ask(page, "what is on tonight?");

  await waitForText(page, THINKING);
  check(
    "reasoning: the live transcript is visible before the answer token arrives",
    (await page.locator('[data-testid="thinking-transcript"]').count()) > 0,
  );
  check("reasoning: the answer is not on screen yet", (await countText(page, REPLY)) === 0);
  check("reasoning: the typing affordance is up during the think", (await page.locator('[role="status"]').count()) > 0);

  sse.openGate("answer-token");
  await waitForText(page, REPLY);
  await page.getByTitle("Send message").waitFor({ state: "visible", timeout: 30_000 });
  check("reasoning: the answer renders", (await countText(page, REPLY)) > 0);
  check(
    "reasoning: auto-collapsed once the answer started",
    (await page.locator('[data-testid="thinking-disclosure"]').count()) > 0 &&
      (await page.locator('[data-testid="thinking-transcript"]').count()) === 0,
  );

  const rows = await persistedRows(page);
  check(
    "reasoning: the transcript is display-only and never persisted",
    rows.length > 0 && rows.every((m) => m.thinking === undefined && m.toolEvents === undefined),
    `${rows.length} rows`,
  );

  await context.close();
}

/** Scenario 3 — a tool failure is visible, not swallowed. */
async function scenarioToolError() {
  const REPLY = "I could not check the pantry.";
  sse.arm({
    frames: [
      { frame: 'event: attempt\ndata: {"round":1,"target":"t0"}\n\n' },
      { frame: 'event: tool\ndata: {"name":"get_pantry","state":"running"}\n\n' },
      { frame: 'event: tool\ndata: {"name":"get_pantry","state":"error"}\n\n' },
      // The ANSWERING round announces its own attempt before its first token —
      // the route writes one before EVERY provider call. Its chips and the
      // answering round's attempt are separate things, and conflating them is
      // what erased this error off the reply.
      { frame: 'event: attempt\ndata: {"round":2,"target":"t0"}\n\n' },
      { frame: `data: {"t":"${REPLY}"}\n\n`, gate: "answer-token" },
      { frame: "data: [DONE]\n\n" },
    ],
  });

  const { context, page } = await openChat(null);
  await ask(page, "what is in the pantry?");

  const chip = page.locator('[data-testid="tool-activity"] [data-state="error"]').first();
  await chip.waitFor({ state: "visible", timeout: 30_000 });
  const chipText = (await chip.textContent())?.trim() ?? "";
  check("tool error: an error chip is rendered", (await chip.count()) > 0);
  check(
    "tool error: the chip names the failed tool and states the error",
    /Pantry/.test(chipText) && /error/.test(chipText),
    chipText,
  );
  check(
    "tool error: the running chip did not stay spinning beside its own answer",
    (await page.locator('[data-testid="tool-activity"] [data-state="running"]').count()) === 0,
  );

  sse.openGate("answer-token");
  await waitForText(page, REPLY);
  check("tool error: the honest reply still renders", (await countText(page, REPLY)) > 0);

  // The chips must still be there AFTER the turn settles. The answering round's
  // attempt frame used to clear them, so a tool error was visible for a few
  // seconds and then vanished with no evidence left on the answer.
  await page.getByTitle("Send message").waitFor({ state: "visible", timeout: 30_000 });
  check(
    "tool error: the error chip is still on the SETTLED reply, not just live",
    (await page.locator('[data-testid="tool-activity"] [data-state="error"]').count()) > 0,
  );
  check(
    "tool error: the live copy is gone, so the chips are not rendered twice",
    (await page.locator('[data-testid="tool-activity"]').count()) === 1,
  );
  const onReplyRow = await chipSharesReplyRow(page, REPLY);
  check(
    "tool error: the chip sits on the SAME bubble as the answer",
    onReplyRow.shared,
    onReplyRow.detail,
  );

  const rows = await persistedRows(page);
  check(
    "tool error: tool activity is display-only and never persisted",
    rows.length > 0 && rows.every((m) => m.toolEvents === undefined),
    `${rows.length} rows`,
  );

  await context.close();
}

/**
 * Scenario 4 — the attempt reset. A dead target's tokens MUST be replaced, never
 * concatenated. The state asserted after attempt 2 exists only while attempt 1's
 * tokens are on screen and attempt 2's token frame is still unwritten, so a
 * buffered body cannot reach it.
 */
async function scenarioAttemptReset() {
  const DEAD = "DEAD-TARGET-TOKENS";
  const DEAD_THINK = "reasoning from the dead target";
  const LIVE = "second attempt answer";
  sse.arm({
    frames: [
      { frame: 'event: attempt\ndata: {"round":1,"target":"t0"}\n\n' },
      // Reasoning precedes the first token on purpose: the live transcript only
      // renders while Consuela is still thinking, and the first token ends that.
      { frame: `event: reasoning\ndata: {"r":"${DEAD_THINK}"}\n\n` },
      { frame: `data: {"t":"${DEAD}"}\n\n` },
      { frame: 'event: attempt\ndata: {"round":1,"target":"t1"}\n\n' },
      { frame: `data: {"t":"${LIVE}"}\n\n`, gate: "answer-token" },
      { frame: "data: [DONE]\n\n" },
    ],
  });

  const { context, page } = await openChat(null);
  await ask(page, "what is on tonight?");

  await waitForText(page, DEAD_THINK);
  await waitForText(page, DEAD);
  check(
    "attempt reset: the first attempt's think and tokens are both on screen",
    (await countText(page, DEAD)) > 0,
  );

  await page.getByText(DEAD).first().waitFor({ state: "hidden", timeout: 30_000 });
  check(
    "attempt reset: the superseded attempt's tokens are replaced, not concatenated",
    (await countText(page, DEAD)) === 0,
  );
  check(
    "attempt reset: the superseded attempt's transcript is cleared with them",
    (await countText(page, DEAD_THINK)) === 0,
  );
  check(
    "attempt reset: the typing affordance is re-armed between attempts",
    (await page.locator('[role="status"] .chat-dot').count()) > 0,
  );

  sse.openGate("answer-token");
  await waitForText(page, LIVE);
  check("attempt reset: the answering attempt renders on its own", (await countText(page, LIVE)) > 0);
  check(
    "attempt reset: nothing of the dead attempt survives on screen",
    !(await page.evaluate(() => document.body.innerText)).includes(DEAD),
  );

  const rows = await persistedRows(page);
  check(
    "attempt reset: displayed === persisted (the dead tokens are not on disk either)",
    rows.length > 0 && rows.every((m) => typeof m.content !== "string" || !m.content.includes(DEAD)),
    `${rows.length} rows`,
  );

  await context.close();
}

/** Scenario 5 — the route's own sentence reaches the reader verbatim. */
async function scenarioRouteErrorVerbatim() {
  const ERROR_TEXT = "My brain isn't configured yet — add a provider in Settings → AI Models.";
  const { context, page } = await openChat(null);
  sse.arm({ buffered: `event: error\ndata: {"message":"${ERROR_TEXT}"}\n\n` });
  await ask(page, "are you there?");
  await waitForText(page, ERROR_TEXT);

  check("route error: the message renders verbatim", (await countText(page, ERROR_TEXT)) > 0);
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(
    "route error: not buried under generic outage copy",
    !bodyText.includes("I couldn't reach the family server") && !bodyText.includes("You're offline"),
  );
  check(
    "route error: Try again survives for the recovery path",
    (await page.getByText("Try again", { exact: true }).count()) > 0,
  );

  await context.close();
}

/** Scenario 6 — a transport drop mid-stream is an honest failure, not a half answer. */
async function scenarioMidStreamDrop() {
  const PARTIAL = "half an answ";
  const HONEST = "I couldn't reach the family server just now.";
  sse.arm({
    frames: [
      { frame: 'event: attempt\ndata: {"round":1,"target":"t0"}\n\n' },
      { frame: `data: {"t":"${PARTIAL}"}\n\n` },
    ],
    dropMidStream: true,
    dropGate: "drop",
  });

  const { context, page } = await openChat(null);
  await ask(page, "what is on tonight?");

  await waitForText(page, PARTIAL);
  check("mid-stream drop: the partial token was on screen first", (await countText(page, PARTIAL)) > 0);

  sse.openGate("drop");
  await page.getByText("Try again", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
  const droppedText = await page.evaluate(() => document.body.innerText);
  check("mid-stream drop: the drop surfaces as an honest failure", droppedText.includes(HONEST));
  check(
    "mid-stream drop: the truncated partial is not left standing as the answer",
    !droppedText.includes(PARTIAL),
  );
  check(
    "mid-stream drop: Try again survives",
    (await page.getByText("Try again", { exact: true }).count()) > 0,
  );

  await context.close();
}

const SCENARIOS = [
  ["stale-id collision", scenarioStaleIdCollision],
  ["reasoning transcript", scenarioReasoningTranscript],
  ["tool error chip", scenarioToolError],
  ["attempt reset", scenarioAttemptReset],
  ["route error verbatim", scenarioRouteErrorVerbatim],
  ["mid-stream transport drop", scenarioMidStreamDrop],
];

async function main() {
  logDir = mkdtempSync(path.join(os.tmpdir(), "chat-reliability-test-"));
  cleanupProbe = createIdempotentProbeCleanup({
    browser: { close: async () => { if (browser) await browser.close(); } },
    server: true,
    stopServer: async () => {
      await stopDevServer(server);
    },
    closeLog: async () => {
      await sse.close();
    },
    removeTemp: () => {
      rmSync(logDir, { recursive: true, force: true });
    },
    keepTemp: KEEP_ARTIFACTS,
  });
  installProbeSignalHandlers(cleanupProbe);
  try {
    ssePort = await sse.listen();
    if (EXTERNAL_BASE_URL) {
      baseUrl = EXTERNAL_BASE_URL;
      console.log(`! adopted external dev server ${baseUrl} (CHAT_RELIABILITY_BASE_URL) — its env is NOT the probe safe env`);
      await waitForExternalReady(baseUrl);
    } else {
      const port = await getFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      server = bootDevServer(port, baseUrl, logDir);
      await waitForReady(server);
    }
    browser = await chromium.launch({ headless: true });

    for (const [name, run] of SCENARIOS) {
      console.log(`\n${name}`);
      sse.arm({ buffered: "" });
      try {
        await run();
      } catch (error) {
        check(`${name}: scenario ran to completion`, false, error instanceof Error ? error.message : String(error));
      }
      console.log(`  [frames written] ${JSON.stringify(sse.state.writes)}`);
    }

    check("probe sent no auth/PIN/credential requests", sensitiveRequests.length === 0, sensitiveRequests.join(", "));
    check("probe attempted no external font requests", fontRequests.length === 0, fontRequests.join(", "));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    assert.equal(failed.length, 0, `${failed.length} check(s) failed: ${failed.map((f) => f.name).join("; ")}`);
    console.log("ALL CHAT-RELIABILITY CHECKS PASSED");
  } catch (error) {
    console.error("FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    console.error(serverLogTail(server?.logPath ?? path.join(logDir, "next-dev.log")));
    process.exitCode = 1;
  } finally {
    if (KEEP_ARTIFACTS) console.log(`artifacts kept in ${logDir}`);
    await cleanupProbe();
  }
}

await main();