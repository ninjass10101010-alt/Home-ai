#!/usr/bin/env node
// Live probe for the Consuela assistant-tools upgrade (Task 12).
// Run against a dev server: BASE_URL=http://localhost:3000 node scripts/consuela/verify-assistant-tools.mjs
// With no BASE_URL it reuses a live :3000 or boots its own `npm run dev` (mirrors
// verify-chat-speed's "against a running server" usage + verify-kid-profile-sheet's
// boot/capture pattern). Exits 1 on any FAIL; prints ALL CHECKS PASSED otherwise.
//
// RULE: this probe performs NO family-data writes — no add_task/add_event/
// completions. Generation + auth-surface only (the planner route writes nothing;
// the apply-route calls are the 401/400 auth surface, which executes nothing).
//
// What it verifies:
//   1. Signed-in adult session → POST /api/hermes/chat {"What's on the calendar
//      this weekend?"} streams/returns 200 with non-error content (no "snag
//      connecting"). Tool-dispatch internals are NOT asserted: the chat route
//      never logs tool names, so that assertion is skipped with an honest note.
//   2. POST /api/hermes/chat {agent:"planner",intent:"meal_ideas"} →
//      {ok:true, result.actions.length ≥ 2} against the live brain (ONE model
//      generation — the siblings' chat probes do live calls too).
//   3. planner with a CHILD session → 401 (child cookie via /api/auth/
//      quick-login when an under-10 kid exists; honestly labeled guest-401 if
//      quick-login is not achievable in this environment).
//   4. GET /screensaver → 200 (regression smoke).
//   5. /calendar as GUEST at 390+1440: no page/console errors (expected 401
//      network noise excluded), no horizontal overflow, and "Consuela's week"
//      does NOT render (guest = not parent).
//   6. POST /api/consuela/planner/apply: no PIN → 401 "pin required";
//      tool:"delete_container" (adult PIN presented) → 400 "tool not allowed".
//
// Secrets: PINs come from env (PARENT_PIN / CHILD_NAME) or, failing that, are
// resolved at RUNTIME from the server-only seed defaults (src/lib/pb-seed.ts).
// NOTHING secret is ever printed — every console line goes through redact().

import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3445;

let BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
let child = null;
let logPath = null;

// redact-before-print: strip anything shaped like a credential from any string
// this probe echoes (session tokens, PIN= pairs, key/secret values).
const SECRET_RE =
  /(consuela_session=|["']?pin["']?\s*[:=]\s*)["']?[A-Za-z0-9_-]{4,}["']?|((API_KEY|TOKEN|SECRET|PASSWORD|PASS|PIN)[A-Z_]*\s*[:=]\s*)["']?[^\s"',}]+/gi;
function redact(s) {
  return String(s).replace(SECRET_RE, "$1$2[REDACTED]");
}
function say(line) {
  console.log(redact(line));
}

// Reuse the shared dev server on :3000 if present (it is NOT restarted);
// otherwise boot our own (Next only permits one dev server per project dir).
async function resolveServer() {
  if (process.env.BASE_URL) {
    say(`using BASE_URL override at ${BASE}`);
    return;
  }
  try {
    const res = await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(10_000) });
    if (res.status === 200 || res.status === 307) {
      BASE = "http://127.0.0.1:3000";
      say(`using shared dev server at ${BASE}`);
      return;
    }
  } catch {
    /* no live server — boot below */
  }
  const logDir = mkdtempSync(path.join(os.tmpdir(), "assistant-tools-probe-"));
  logPath = path.join(logDir, "next-dev.log");
  const log = createWriteStream(logPath);
  child = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  BASE = `http://127.0.0.1:${PORT}`;
  await waitForReady();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(deadlineMs = 240_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error("dev server did not become ready");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  say(`${ok ? "ok" : "FAIL"} - ${name}${detail ? ` — ${detail}` : ""}`);
}
function note(name, detail = "") {
  say(`NOTE - ${name}${detail ? ` — ${detail}` : ""}`);
}

function memberPin(name) {
  if (process.env.PARENT_PIN) return process.env.PARENT_PIN;
  // Server-only seed defaults (already in the repo, never client-shipped) —
  // read at RUNTIME so no literal PIN ever lands in this committed file.
  try {
    const src = readFileSync(path.join(REPO_ROOT, "src", "lib", "pb-seed.ts"), "utf8");
    const block = /MEMBER_DEFAULT_PINS[^}]+}/.exec(src)?.[0] ?? "";
    const m = new RegExp(`\\b${name.split(" ")[0].toLowerCase()}:\\s*"(\\d+)"`).exec(block);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function loginCookie(name, pin) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberName: name, pin }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`login failed for ${name}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/consuela_session=([^;]+)/);
  if (!m) throw new Error("no session cookie in login response");
  return m[1];
}

async function childSessionCookie(name) {
  const res = await fetch(`${BASE}/api/auth/quick-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberName: name }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/consuela_session=([^;]+)/);
  return m ? m[1] : null;
}

async function postJson(url, body, cookie, headers = {}, timeoutMs = 120_000) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie: `consuela_session=${cookie}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

async function run() {
  const parentName = process.env.PARENT_NAME ?? "Rebecca";
  const pin = memberPin(parentName);
  if (!pin) {
    check("adult session available", false, `no PIN for ${parentName} (set PARENT_PIN) — cannot probe`);
    return;
  }
  let parentCookie = null;
  try {
    parentCookie = await loginCookie(parentName, pin);
  } catch (e) {
    check("adult session available", false, e.message);
    return;
  }
  check("adult session available", true, `signed in as ${parentName}`);

  // 1. Live chat ask — calendar weekend (get_calendar_range territory).
  {
    let verdict = false;
    let detail = "";
    try {
      const { status, json } = await postJson(
        `${BASE}/api/hermes/chat`,
        { message: "What's on the calendar this weekend?" },
        parentCookie
      );
      const content = typeof json?.content === "string" ? json.content : "";
      const providerDead =
        /snag connecting|brain isn't configured|ran out of steps/i.test(content);
      verdict = status === 200 && content.trim().length > 0 && !providerDead;
      detail = providerDead
        ? "provider unreachable — live brain answer failed"
        : `status=${status} len=${content.length}`;
    } catch (e) {
      detail = `provider unreachable (${e.message})`;
    }
    check("chat: weekend calendar ask streams a non-error answer", verdict, detail);
    note(
      "chat: internal tool dispatch not asserted",
      "the /api/hermes/chat route logs no tool names, so the get_calendar_range dispatch check is skipped (assertion lives in unit tests)"
    );
  }

  // 2. Planner agent — meal_ideas against the live brain (one generation).
  {
    let verdict = false;
    let detail = "";
    try {
      const { status, json } = await postJson(
        `${BASE}/api/hermes/chat`,
        { agent: "planner", intent: "meal_ideas" },
        parentCookie
      );
      const n = Array.isArray(json?.result?.actions) ? json.result.actions.length : -1;
      verdict = status === 200 && json?.ok === true && n >= 2;
      detail =
        json?.ok === false
          ? `provider unreachable (${json.reason ?? "no reason"})`
          : `status=${status} ok=${json?.ok} actions=${n}`;
    } catch (e) {
      detail = `provider unreachable (${e.message})`;
    }
    check("planner: meal_ideas returns ≥2 validated actions from the live brain", verdict, detail);
  }

  // 3. planner is parent-only — child session (quick-login) must get 401.
  {
    const childName = process.env.CHILD_NAME ?? "Aurora";
    let childCookie = null;
    try {
      childCookie = await childSessionCookie(childName);
    } catch {
      childCookie = null;
    }
    const label = childCookie
      ? `planner: child session (${childName}) gets 401`
      : "planner: guest session gets 401 (child quick-login unavailable — labeled honestly)";
    let verdict = false;
    let detail = "";
    try {
      const { status, json } = await postJson(
        `${BASE}/api/hermes/chat`,
        { agent: "planner", intent: "meal_ideas" },
        childCookie
      );
      verdict = status === 401 && json?.ok === false && json?.reason === "unauthorized";
      detail = `status=${status} reason=${json?.reason ?? "?"}`;
    } catch (e) {
      detail = e.message;
    }
    check(label, verdict, detail);
  }

  // 4. Screensaver regression smoke.
  {
    let verdict = false;
    let detail = "";
    try {
      const res = await fetch(`${BASE}/screensaver`, { signal: AbortSignal.timeout(60_000) });
      verdict = res.status === 200;
      detail = `status=${res.status}`;
    } catch (e) {
      detail = e.message;
    }
    check("screensaver page unaffected (GET /screensaver 200)", verdict, detail);
  }

  // 5. /calendar guest walk at 390 + 1440.
  const browser = await chromium.launch({ headless: true });
  for (const vp of [
    { name: "390", width: 390, height: 844 },
    { name: "1440", width: 1440, height: 900 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript(() => {
      try {
        localStorage.removeItem("consuela-auth-user");
      } catch {}
    });
    const page = await ctx.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(String(e)));
    page.on("console", (m) => {
      // Guests hit session-gated reads that 401 BY DESIGN — the browser's
      // resource-load noise is expected, not a page error. Everything else counts.
      if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) {
        problems.push(m.text());
      }
    });
    try {
      await page.goto(`${BASE}/calendar`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(".calendar-member-chip", { timeout: 30_000 });
      await sleep(2500); // let async merges/syncs settle before measuring
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      const cardCount = await page.locator("text=Consuela's week").count();
      check(
        `calendar ${vp.name}: no page/console errors as guest`,
        problems.length === 0,
        problems.slice(0, 2).map(redact).join(" | ")
      );
      check(`calendar ${vp.name}: no horizontal overflow`, overflow <= 1, `delta=${overflow}px`);
      check(`calendar ${vp.name}: planner card hidden for guests`, cardCount === 0, `found=${cardCount}`);
    } catch (e) {
      check(`calendar ${vp.name}: page walk`, false, redact(e.message));
    } finally {
      await ctx.close();
    }
  }
  await browser.close();

  // 6. planner/apply auth surface — session passes middleware, the route gates the PIN.
  {
    let verdict = false;
    let detail = "";
    try {
      const { status, json } = await postJson(
        `${BASE}/api/consuela/planner/apply`,
        { tool: "add_event", args: { title: "probe never runs", date: "2026-09-12" } },
        parentCookie,
        {},
        30_000
      );
      verdict = status === 401 && /pin required/i.test(String(json?.error ?? ""));
      detail = `status=${status} error=${json?.error ?? "?"}`;
    } catch (e) {
      detail = e.message;
    }
    check("planner/apply: without PIN → 401 pin required", verdict, detail);
  }
  {
    let verdict = false;
    let detail = "";
    try {
      const { status, json } = await postJson(
        `${BASE}/api/consuela/planner/apply`,
        { tool: "delete_container", args: { name: "pocketbase" } },
        parentCookie,
        { "x-consuela-pin": pin },
        30_000
      );
      verdict = status === 400 && /tool not allowed/i.test(String(json?.error ?? ""));
      detail = `status=${status} error=${json?.error ?? "?"}`;
    } catch (e) {
      detail = e.message;
    }
    check("planner/apply: delete_container → 400 tool not allowed", verdict, detail);
  }
}

await resolveServer();
try {
  await run();
} catch (e) {
  check("probe run completed", false, redact(`${e?.message || e}`));
  if (logPath) {
    try {
      say("--- last server log lines (redacted) ---");
      say(readFileSync(logPath, "utf8").split("\n").slice(-25).join("\n"));
    } catch {
      /* no log */
    }
  }
} finally {
  child?.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
say(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
