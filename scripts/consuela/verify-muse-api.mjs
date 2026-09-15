#!/usr/bin/env node
// Live probe for the MUSE inbound API (Task 13 / B6).
// Run against a dev server: BASE_URL=http://localhost:3000 node scripts/consuela/verify-muse-api.mjs
// With no BASE_URL it reuses a live :3000 or boots its own `npm run dev` (the
// same server-boot/login idiom as verify-assistant-tools.mjs / verify-chat-speed).
// Exits 1 on any FAIL; prints ALL CHECKS PASSED (N) otherwise.
//
// RULE: this probe performs NO family-data writes — no add/complete/event/meal/
// pantry calls. It exercises only the MUSE identity + auth surface and one live
// READ tool (get_weather).
//
// KEY-FLOW SAFETY (the important part):
//   - If the settings envelope reports `hasKey:false`, the probe enables the
//     identity, rotates in a fresh key, runs the auth checks, then revokes +
//     disables MUSE so it is left inert and the generated key is dead.
//   - If a real operator key already exists (`hasKey:true`), the probe NEVER
//     rotates or revokes it. It prints an honest SKIP note and skips checks 3–7
//     unless MUSE_TEST_KEY is provided, in which case it logs in with that key
//     for checks 3–6 + the no-token 401 (and never touches the key lifecycle).
//
// Secrets: MUSE keys (`muse_…`), bearer tokens (`v1.…`) and session cookies are
// never printed — every console line goes through redact().

import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3446;

const ADMIN_TOOLS = [
  "check_for_update",
  "trigger_update",
  "get_container_status",
  "restart_container",
  "check_pocketbase",
];

let BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
let child = null;
let logPath = null;

// redact-before-print: strip anything shaped like a credential from any string
// this probe echoes (MUSE keys, bearer tokens, session tokens, PIN= pairs).
function redact(s) {
  return String(s)
    .replace(/muse_[A-Za-z0-9_-]{2,}/g, "muse_[REDACTED]")
    .replace(/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "v1.[REDACTED]")
    .replace(
      /(["'](?:key|token|pin|password|secret)["']\s*[:=]\s*)["']?[^\s"',}]+/gi,
      "$1[REDACTED]"
    )
    .replace(/consuela_session=[^;]+/g, "consuela_session=[REDACTED]");
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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "muse-api-probe-"));
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
function skip(name, detail = "") {
  say(`SKIP - ${name}${detail ? ` — ${detail}` : ""}`);
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

async function api(method, url, { body, cookie, headers = {}, timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie: `consuela_session=${cookie}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json, text, headers: res.headers };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
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

  // 1. Parent session reaches the settings envelope.
  let settings = null;
  try {
    settings = await api("GET", `${BASE}/api/muse/settings`, { cookie: parentCookie });
  } catch (e) {
    check("parent session reaches GET /api/muse/settings", false, e.message);
    return;
  }
  const envelopeOk =
    settings.status === 200 && settings.json?.ok === true && typeof settings.json.hasKey === "boolean";
  check(
    "parent session reaches GET /api/muse/settings → 200 settings envelope",
    envelopeOk,
    `status=${settings.status} hasKey=${settings.json?.hasKey}`
  );
  if (!envelopeOk) return;

  // 1b. Public API reference. The runtime image must ship docs/muse-api.md (the
  //     Dockerfiles COPY docs into the runner) — otherwise this 500s in the
  //     packaged deploy even though it works in dev.
  try {
    const docs = await api("GET", `${BASE}/api/muse/docs`);
    const docsCt = docs.headers?.get("content-type") || "";
    check(
      "GET /api/muse/docs (public) → 200 markdown with a known string",
      docs.status === 200 &&
        docsCt.includes("text/markdown") &&
        docs.text.includes("POST /api/muse/auth/login"),
      `status=${docs.status} contentType=${docsCt}`
    );
  } catch (e) {
    check("GET /api/muse/docs (public)", false, e.message);
  }

  // 2. Key-flow safety. Only generate when there is no key; never clobber a
  //    real operator key.
  let key = null;
  let generated = false;
  let latestKey = null;

  if (settings.json.hasKey === false) {
    const put = await api("PUT", `${BASE}/api/muse/settings`, {
      body: { enabled: true, adminEnabled: false },
      cookie: parentCookie,
    });
    check(
      "probe enabled MUSE with admin off (generated identity)",
      put.status === 200 && put.json?.enabled === true && put.json?.adminEnabled === false,
      `status=${put.status} enabled=${put.json?.enabled} adminEnabled=${put.json?.adminEnabled}`
    );

    const rot = await api("POST", `${BASE}/api/muse/settings/rotate`, { cookie: parentCookie });
    generated = rot.status === 200 && typeof rot.json?.key === "string";
    key = generated ? rot.json.key : null;
    latestKey = key;
    check(
      "probe generated a fresh key via rotate (hasKey was false)",
      generated,
      generated ? `keyPrefix=${rot.json?.keyPrefix} version=${rot.json?.version}` : `status=${rot.status}`
    );
    note("key-flow safety", "generated the key ourselves — cleanup will revoke + disable MUSE");
  } else if (process.env.MUSE_TEST_KEY) {
    key = process.env.MUSE_TEST_KEY;
    generated = false;
    note(
      "key-flow safety",
      "an operator key already exists; using MUSE_TEST_KEY and never touching the key lifecycle"
    );
  } else {
    skip(
      "MUSE already has a key; set MUSE_TEST_KEY to run the auth checks",
      "checks 3–7 skipped so a real operator key is never rotated or revoked"
    );
  }

  if (!key) {
    say("\nNothing else to probe — a real key exists and MUSE_TEST_KEY was not set.");
    return;
  }

  // 3. Login: key → bearer token.
  let token = null;
  try {
    const login = await api("POST", `${BASE}/api/muse/auth/login`, { body: { key } });
    token = typeof login.json?.token === "string" ? login.json.token : null;
    const scopesOk =
      Array.isArray(login.json?.scopes) &&
      login.json.scopes.length === 1 &&
      login.json.scopes[0] === "tools";
    check(
      "POST /api/muse/auth/login → token + expiresAt + scopes[tools] + admin:false",
      login.status === 200 &&
        !!token &&
        typeof login.json?.expiresAt === "string" &&
        scopesOk &&
        login.json?.admin === false,
      `status=${login.status} scopes=${JSON.stringify(login.json?.scopes)} admin=${login.json?.admin}`
    );
  } catch (e) {
    check("POST /api/muse/auth/login", false, e.message);
  }

  if (token) {
    // 4. whoami.
    const me = await api("GET", `${BASE}/api/muse/whoami`, { headers: bearer(token) });
    check(
      "GET /api/muse/whoami with bearer → 200 admin:false",
      me.status === 200 && me.json?.ok === true && me.json?.admin === false,
      `status=${me.status} admin=${me.json?.admin}`
    );

    // 5. Tool catalog: admin tools absent while the admin toggle is off.
    const tools = await api("GET", `${BASE}/api/muse/tools`, { headers: bearer(token) });
    const names = Array.isArray(tools.json?.tools)
      ? tools.json.tools.map((t) => t?.function?.name).filter(Boolean)
      : [];
    const adminPresent = ADMIN_TOOLS.filter((n) => names.includes(n));
    check(
      "GET /api/muse/tools → 200 with the 5 admin tools ABSENT (admin off)",
      tools.status === 200 && tools.json?.ok === true && names.length > 0 && adminPresent.length === 0,
      `status=${tools.status} tools=${names.length} adminPresent=${adminPresent.length}`
    );

    // 6a. Execute a live READ tool.
    const wx = await api("POST", `${BASE}/api/muse/tool`, {
      headers: bearer(token),
      body: { name: "get_weather", args: {} },
    });
    check(
      "POST /api/muse/tool get_weather → 200 with a result",
      wx.status === 200 && wx.json !== null && "result" in wx.json,
      `status=${wx.status} hasResult=${wx.json !== null && "result" in wx.json}`
    );

    // 6b. Admin tool rejected on a non-admin token (before reaching the handler).
    const upd = await api("POST", `${BASE}/api/muse/tool`, {
      headers: bearer(token),
      body: { name: "trigger_update", args: {} },
    });
    check(
      "POST /api/muse/tool trigger_update → 403 tool not allowed (admin off)",
      upd.status === 403 && upd.json?.error === "tool not allowed",
      `status=${upd.status} error=${upd.json?.error}`
    );

    // 7a. No token → 401.
    const noTok = await api("GET", `${BASE}/api/muse/whoami`);
    check("GET /api/muse/whoami without a token → 401", noTok.status === 401, `status=${noTok.status}`);

    // 7b. Rotation invalidates live tokens (only when we own the key).
    if (generated) {
      const rot2 = await api("POST", `${BASE}/api/muse/settings/rotate`, { cookie: parentCookie });
      latestKey = typeof rot2.json?.key === "string" ? rot2.json.key : latestKey;
      const after = await api("GET", `${BASE}/api/muse/whoami`, { headers: bearer(token) });
      check(
        "rotating again invalidates the previous token (whoami → 401)",
        rot2.status === 200 && after.status === 401,
        `rotateStatus=${rot2.status} oldTokenStatus=${after.status}`
      );
    } else {
      skip(
        "rotation-invalidation check skipped",
        "would clobber the operator's real key; run on a throwaway instance via MUSE_TEST_KEY"
      );
    }
  }

  // 8. Cleanup — leave MUSE inert and the generated key dead.
  if (generated) {
    const rev = await api("POST", `${BASE}/api/muse/settings/revoke-tokens`, { cookie: parentCookie });
    const off = await api("PUT", `${BASE}/api/muse/settings`, {
      body: { enabled: false },
      cookie: parentCookie,
    });
    const dead = await api("POST", `${BASE}/api/muse/auth/login`, { body: { key: latestKey ?? key } });
    check(
      "cleanup: MUSE revoked + disabled; the generated key can no longer log in",
      rev.status === 200 && off.status === 200 && off.json?.enabled === false && dead.status === 401,
      `revokeStatus=${rev.status} enabled=${off.json?.enabled} generatedKeyLoginStatus=${dead.status}`
    );
    say("NOTE - the probe-generated MUSE key is now dead (identity disabled + all tokens revoked).");
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
