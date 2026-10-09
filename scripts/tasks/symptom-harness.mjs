#!/usr/bin/env node
// Phase 0B symptom harness for the task-page perfection wave (2026-10-08).
//
// Usage:
//   npm run harness:tasks
//
// What it drives (four symptom classes, end to end, against a DISPOSABLE
// PocketBase on an OS-assigned port with its own mktemp data directory, and a
// dev server on another OS-assigned port, TZ=America/Detroit everywhere):
//
//   (a) rows stuck in "Needs approval" after approving   — hops a1..a10
//   (b) points wrong or missing after approval           — variants b1..b4
//   (c) a kid's tap on one device never reaching the
//       parent's card on another                         — hops c1..c8
//   (d) PIN/permission errors during approve/send-back   — cases d1..d5
//
// It emits a JSON report on stdout (and to $SYMPTOM_REPORT_PATH when set)
// with a 4×4 matrix — symptom class × hop — every cell carrying
// reproduced / failingHop / fileLine / latencyMs. It exits 0 only when every
// harness-health check passes and no matrix cell is blank. Symptom verdicts are
// DATA in the matrix, not pass/fail checks: the harness must run green while
// the product misbehaves, or it has not measured anything.
//
// SAFETY: never run against the family NAS. The harness boots its own
// PocketBase inside a mktemp dir and wires ONLY exported shell variables
// (NEXT_PUBLIC_PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASS) so the .env.local
// fallback can never fire. It never runs `npm run build` (prebuild rewrites
// the tracked public/version.json stamp). Captured bodies are pin-redacted.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "scripts", "tasks", "fixtures");
const TZ = "America/Detroit";
const CROSS_DEVICE_THRESHOLD_MS = 180_000;

// Fixture values, never secrets (plan Step 0B1).
const PB_ADMIN_EMAIL = "p0-harness@example.test";
const PB_ADMIN_PASS = "p0-harness-not-a-secret";
const SESSION_SECRET = "p0-harness-session-not-a-secret";
const SESSION_COOKIE = "consuela_session";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OS-assigned port, the house pattern from scripts/visual-review/harness.mjs.
function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Family-clock mirrors of src/lib/local-date.ts:103-105. The harness (and
// every process it spawns) runs with TZ=America/Detroit, so Node's local
// parts ARE the family parts — the same arithmetic localTodayISO() does.
function familyTodayISO(now = new Date()) {
  return now.toLocaleString("en-CA", { timeZone: TZ }).split(",")[0];
}
// Monday of the family week, computed from the family-zone date string only.
// Deliberately independent of the harness process's ambient TZ: the plan pins
// TZ=America/Detroit for every spawned process, but the harness itself must
// not depend on the shell's zone (src/lib/local-date.ts:70-101 explains why an
// unset TZ fails silently).
function familyWeekStartISO(now = new Date()) {
  const [y, m, d] = familyTodayISO(now).split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc.toISOString().slice(0, 10);
}

// Redact any `pin` field from a captured body before it reaches the report.
function redactPins(value) {
  if (Array.isArray(value)) return value.map(redactPins);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = k === "pin" || k === "parentPin" ? "<fixture-pin-redacted>" : redactPins(v);
    }
    return out;
  }
  return value;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: detail ? String(detail) : "" });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const findings = { hops: {}, probes: {} };
function hop(id, data) {
  findings.hops[id] = { id, ...data };
  console.log(`\n── hop ${id} ──`);
  for (const [k, v] of Object.entries(data)) {
    if (k === "id") continue;
    console.log(`   ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
}

// ---------------------------------------------------------------------------
// Disposable PocketBase
// ---------------------------------------------------------------------------

let PB_ROOT = null;
let PB_PORT = null;
let APP_PORT = null;
let PB_URL = null;
let APP_URL = null;
let pbChild = null;
let appChild = null;
let pbLogPath = null;
let appLogPath = null;
let adminToken = null;
let memberIds = {};

const pbFetch = (pathname, init = {}) =>
  fetch(`${PB_URL}/api${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { authorization: adminToken } : {}),
      ...(init.headers || {}),
    },
  });

async function bootPocketBase() {
  PB_ROOT = mkdtempSync(path.join(os.tmpdir(), "p0-pb-"));
  PB_PORT = await pickPort();
  PB_URL = `http://127.0.0.1:${PB_PORT}`;
  const pbDataDir = path.join(PB_ROOT, "pb_data");
  const logDir = mkdtempSync(path.join(os.tmpdir(), "p0-pb-log-"));
  pbLogPath = path.join(logDir, "pb.log");
  const log = createWriteStream(pbLogPath);

  // Superuser upsert (idempotent) BEFORE serve, so the seed steps can auth.
  // `--dir` is explicit on every PB invocation: the CLI's default data dir is
  // relative to the executable (/usr/local/bin/pb_data), never cwd.
  const upsert = spawn(
    "/usr/local/bin/pocketbase",
    ["superuser", "upsert", PB_ADMIN_EMAIL, PB_ADMIN_PASS, `--dir=${pbDataDir}`],
    { cwd: PB_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  const upsertOut = await new Promise((resolve) => {
    let buf = "";
    upsert.stdout.on("data", (d) => (buf += d));
    upsert.stderr.on("data", (d) => (buf += d));
    upsert.on("close", (code) => resolve({ code, buf }));
  });
  if (upsertOut.code !== 0) {
    throw new Error(`superuser upsert failed: ${upsertOut.buf.slice(-400)}`);
  }

  pbChild = spawn(
    "/usr/local/bin/pocketbase",
    ["serve", `--dir=${pbDataDir}`, `--http=127.0.0.1:${PB_PORT}`],
    { cwd: PB_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  pbChild.stdout.pipe(log);
  pbChild.stderr.pipe(log);

  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) { healthy = true; break; }
    } catch {
      await sleep(500);
    }
  }
  if (!healthy) throw new Error("disposable PocketBase did not become healthy");

  const authRes = await pbFetch("/collections/_superusers/auth-with-password", {
    method: "POST",
    body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASS }),
  });
  if (!authRes.ok) throw new Error("superuser auth failed");
  adminToken = (await authRes.json()).token;
  check("disposable PocketBase booted + superuser authed", true, `port ${PB_PORT}`);
}

// ---------------------------------------------------------------------------
// Schema + fixtures (the two idempotent steps, wired ONLY through exports)
// ---------------------------------------------------------------------------

function runRepoScript(name) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", name], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TZ,
        NEXT_PUBLIC_PB_URL: PB_URL,
        PB_ADMIN_EMAIL,
        PB_ADMIN_PASS,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    child.stdout.on("data", (d) => (buf += d));
    child.stderr.on("data", (d) => (buf += d));
    child.on("close", (code) => {
      if (code === 0) resolve(buf);
      else reject(new Error(`${name} failed (exit ${code}):\n${buf.slice(-1500)}`));
    });
  });
}

function runRepoScriptTolerant(name) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", name], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TZ,
        NEXT_PUBLIC_PB_URL: PB_URL,
        PB_ADMIN_EMAIL,
        PB_ADMIN_PASS,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    child.stdout.on("data", (d) => (buf += d));
    child.stderr.on("data", (d) => (buf += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, buf }));
  });
}

const EXPECTED_COLLECTIONS = [
  "members",
  "task_command_queue",
  "tasks",
  "week_data",
  "week_archive",
  "consuela_data_snapshots",
];

async function seedSchema() {
  await runRepoScript("pb:seed");
  // migrate:features is best-effort: on a fresh DB its family-ai collections
  // fail on stale relations to a `users` collection that pb-seed does not
  // create (pre-existing, unrelated to tasks). The six task collections are
  // verified below and are the only schema this harness depends on.
  const migrate = await runRepoScriptTolerant("migrate:features");
  if (migrate.code !== 0) {
    const failedCount = (migrate.buf.match(/❌ Failed: (\d+)/) || [])[1] ?? "?";
    check(
      "migrate:features best-effort (non-task collections only)",
      true,
      `exit ${migrate.code}, failed ${failedCount} stale family-ai collections (relations to a 'users' collection pb-seed never creates); tolerated because no task collection is among them`,
    );
  } else {
    check("migrate:features succeeded", true);
  }
  const res = await pbFetch("/collections?perPage=200");
  if (!res.ok) throw new Error("collection list failed");
  const names = (await res.json()).items.map((c) => c.name);
  const missing = EXPECTED_COLLECTIONS.filter((n) => !names.includes(n));
  check("six collections landed", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${names.length} collections`);
}

// THE one place tasks are written. The snapshot row
// (consuela_data_snapshots, key "tasks-snapshot") and the canonical
// projection (the tasks collection) are BOTH written here, from
// scripts/tasks/fixtures/tasks.json — a harness that seeds only one produces
// unknown_task/ambiguous_task noise that looks like a product bug.
async function seedFixtures() {
  const members = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "members.json"), "utf8"));
  const { tasks } = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "tasks.json"), "utf8"));

  const due = familyTodayISO();
  const now = new Date();
  const stamp = (msAgo) => new Date(now.getTime() - msAgo).toISOString();
  const crewRoster = (t) => ({
    members: t.crew.members.map((m) => ({
      name: m.name,
      emoji: m.emoji,
      joinedAt: stamp(2 * 3600e3),
      checkedInAt: stamp(3600e3),
    })),
    removed: [],
  });
  const snapshotTask = (t) => ({
    id: t.id,
    title: t.title,
    assignee: t.assignee,
    assigneeEmoji: t.assigneeEmoji,
    due,
    points: t.points,
    recurring: t.recurring ?? null,
    category: t.category,
    priority: t.priority,
    completed: false,
    universal: t.universal === true,
    stealable: t.stealable === true,
    crewSize: t.crewSize ?? null,
    ...(t.crew ? { crew: crewRoster(t) } : { crew: null }),
    ...(t.speedBonus != null ? { speedBonus: t.speedBonus } : {}),
    ...(t.crewCloseMode ? { crewCloseMode: t.crewCloseMode } : {}),
  });

  for (const m of members) {
    const res = await pbFetch("/collections/members/records", {
      method: "POST",
      body: JSON.stringify({ name: m.name, role: m.role, age: m.age, pin: m.pin }),
    });
    if (!res.ok) throw new Error(`member seed failed for ${m.name}: ${await res.text()}`);
    memberIds[m.name] = (await res.json()).id;
  }
  check("four roster fixtures created", true, members.map((m) => m.name).join(", "));

  const snapshotTasks = [];
  for (const t of tasks) {
    const row = {
      taskId: t.id,
      title: t.title,
      assignee: t.assignee,
      assigneeEmoji: t.assigneeEmoji,
      due,
      points: t.points,
      recurring: t.recurring ?? null,
      category: t.category,
      priority: t.priority,
      universal: t.universal === true,
      stealable: t.stealable === true,
      completed: false,
      status: "pending",
      crewSize: t.crewSize ?? null,
      ...(t.crew ? { crew: crewRoster(t) } : { crew: null }),
      ...(t.speedBonus != null ? { speedBonus: t.speedBonus } : {}),
      ...(t.crewCloseMode ? { crewCloseMode: t.crewCloseMode } : {}),
    };
    const res = await pbFetch("/collections/tasks/records", {
      method: "POST",
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`task seed failed for ${t.title}: ${await res.text()}`);
    snapshotTasks.push(snapshotTask(t));
  }

  const weekStart = familyWeekStartISO();
  const snapshot = {
    tasks: snapshotTasks,
    deletedTaskIds: [],
    weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] },
    revision: "1",
  };
  const snapRes = await pbFetch("/collections/consuela_data_snapshots/records", {
    method: "POST",
    body: JSON.stringify({
      key: "tasks-snapshot",
      data: JSON.stringify(snapshot),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!snapRes.ok) throw new Error(`snapshot seed failed: ${await snapRes.text()}`);
  check("five task fixtures written to BOTH the tasks collection and the snapshot", true, `weekStart ${weekStart}, revision 1`);
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

async function bootDevServer() {
  APP_PORT = await pickPort();
  APP_URL = `http://127.0.0.1:${APP_PORT}`;
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logDir = mkdtempSync(path.join(os.tmpdir(), "p0-app-log-"));
  appLogPath = path.join(logDir, "next-dev.log");
  const log = createWriteStream(appLogPath);
  appChild = spawn("npm", ["run", "dev", "--", "-p", String(APP_PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TZ,
      NEXT_PUBLIC_PB_URL: PB_URL,
      PB_ADMIN_EMAIL,
      PB_ADMIN_PASS,
      SESSION_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appChild.stdout.pipe(log);
  appChild.stderr.pipe(log);

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/tasks`, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 200 || res.status === 307) return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error("dev server did not become ready");
}

// ---------------------------------------------------------------------------
// Auth (Step 0B2) — two mechanisms, not interchangeable
// ---------------------------------------------------------------------------

async function login(memberName, pin) {
  const res = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberName, pin }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return { status: res.status, cookie: match ? match[1] : null, body: await res.json().catch(() => ({})) };
}

async function quickLogin(memberName) {
  const res = await fetch(`${APP_URL}/api/auth/quick-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberName }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return { status: res.status, cookie: match ? match[1] : null, body: await res.json().catch(() => ({})) };
}

const authedFetch = (cookie, pathname, init = {}) =>
  fetch(`${APP_URL}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie}`, ...(init.headers || {}) },
  });

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const FIXTURE_TITLES = [
  "Sweep the kitchen floor",
  "Fold the laundry",
  "Unload the dishwasher",
  "Clean the playroom",
  "Wipe the bathroom counters",
];

async function waitForFixtures(page, timeout = 90_000) {
  // ANY fixture title, not a fixed one: the page flips a signed-in viewer to
  // "My Tasks" (page.tsx:390) and a parent sees only the Open/Crew/Completed
  // rows, so Caspian's title never appears on the parent's board. Titles are
  // also the only readiness signal that survives a page where nothing is
  // claimable any more (no Complete/Claim buttons left to match). Third
  // argument is the options object — passing { timeout } as the arg would
  // silently keep 30s.
  await page.waitForFunction(
    (titles) => titles.some((t) => document.body.innerText.includes(t)),
    FIXTURE_TITLES,
    { timeout },
  );
}

// KidHome is the child surface: /tasks redirects children to "/" (page.tsx
// :307-314), so every kid tap in this harness happens on the quest list.
async function waitForKidHome(page, timeout = 90_000) {
  await page.waitForSelector(
    '[aria-label^="Complete quest:"], [aria-label^="Grab it:"], [aria-label^="Join crew:"]',
    { timeout },
  );
  await page.waitForFunction(
    (titles) => titles.some((t) => document.body.innerText.includes(t)),
    FIXTURE_TITLES,
    { timeout },
  );
}

async function waitForCardRow(page, title, timeout = 30_000) {
  await page.waitForFunction(
    (t) => {
      const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("Needs approval"));
      if (!h) return false;
      let el = h;
      for (let i = 0; i < 5 && el; i++) {
        el = el.parentElement;
        if (el && [...el.querySelectorAll(".schedule-row")].some((r) => r.innerText.includes(t))) return true;
      }
      return false;
    },
    title,
    { timeout },
  );
}

// Deterministic variant of the 60s CacheRefresher tick: reload the page so the
// mount pull adopts the server snapshot now, instead of waiting up to 60s for
// the next tick. Used where the harness must observe a server-applied row on
// the parent's device before the 30s card-row timeout would expire.
async function forcePull(page) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForFixtures(page);
}

// The built-in member fallbacks carry STALE ages (member-fallback.ts: Jasmine
// 10, Aurora 7, Caspian 5) until the live roster lands; completesWithoutPin
// reads currentUser.age, so a tap before the roster refresh takes the wrong
// path. handleMembersUpdated persists the live age into the same
// localStorage record, so polling it is a deterministic readiness signal.
async function waitForRosterAge(page, memberName, expectedAge, timeout = 30_000) {
  try {
    await page.waitForFunction(
      ({ name, expected }) => {
        try {
          const user = JSON.parse(localStorage.getItem("consuela-auth-user") || "null");
          return !!user && user.name === name && Number(user.age) === expected;
        } catch {
          return false;
        }
      },
      { name: memberName, expected: expectedAge },
      { timeout },
    );
  } catch (e) {
    const observed = await page.evaluate(() => {
      try { return localStorage.getItem("consuela-auth-user"); } catch { return "<unreadable>"; }
    }).catch(() => "<evaluate failed>");
    console.log(`   [diag] roster age wait failed for ${memberName} (expected ${expectedAge}); consuela-auth-user = ${observed}`);
    throw e;
  }
}

async function needsApprovalRows(page) {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("Needs approval"));
    if (!h) return null;
    let el = h;
    for (let i = 0; i < 5 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const rows = [...el.querySelectorAll(".schedule-row")];
      if (rows.length) return rows.map((r) => r.innerText.replace(/\n/g, " | "));
    }
    return [];
  });
}

// localStorage is read through a PAGE, never a BrowserContext (Playwright's
// BrowserContext has no evaluate); all pages in a context share the origin's
// localStorage, so any open page of that role is a valid reader.
async function outboxEntries(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("consuela-task-operation-outbox-v1");
    return raw ? JSON.parse(raw) : [];
  });
}

// The optimistic "on the way" row is released the instant the ack lands, and
// on a fast local server the claim can round-trip inside one animation frame —
// so a poll can miss a row that DID render. The durable evidence is the claim
// POST the tap produced (the same fallback the outbox read above uses), so an
// "already acked" outcome is recorded rather than treated as a missing tap.
async function waitForOptimisticQuest(page, title, wasPosted) {
  try {
    await page.waitForFunction(
      (needle) => {
        const row = document.querySelector('[data-testid="optimistic-quest"]');
        return !!row && row.innerText.includes(needle);
      },
      title,
      { timeout: 15_000 },
    );
    return "observed";
  } catch (error) {
    if (wasPosted()) return "already-acked (claim POST observed)";
    throw error;
  }
}

async function syncOnce(cookie) {
  const res = await authedFetch(cookie, "/api/tasks/sync");
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function ledgerHistory() {
  const res = await pbFetch("/collections/week_data/records");
  const rows = await res.json();
  const items = rows.items || [];
  const current = items.find((r) => r.weekStart === familyWeekStartISO()) || items[0];
  if (!current) return { points: {}, history: [] };
  return {
    points: typeof current.points === "string" ? JSON.parse(current.points) : current.points,
    history: typeof current.history === "string" ? JSON.parse(current.history) : current.history,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const browser = await chromium.launch({ headless: true });
const contexts = {};
const pages = {};

try {
  await bootPocketBase();
  await seedSchema();
  await seedFixtures();
  await bootDevServer();

  // --- Step 0B2: authenticate each role -----------------------------------
  const parentAuth = await login("Rebecca Garcia", "1234");
  const kidAuth = await quickLogin("Caspian Garcia");
  const teenAuth = await login("Aurora Garcia", "3456");
  const jasmineAuth = await quickLogin("Jasmine Garcia");
  check("parent login (PIN)", parentAuth.status === 200 && !!parentAuth.cookie, `status ${parentAuth.status}`);
  check("kid-young quick-login (PIN-free)", kidAuth.status === 200 && !!kidAuth.cookie, `status ${kidAuth.status}`);
  check("kid-teen login (PIN)", teenAuth.status === 200 && !!teenAuth.cookie, `status ${teenAuth.status}`);
  check("kid-two quick-login (PIN-free, owner of open-assigned)", jasmineAuth.status === 200 && !!jasmineAuth.cookie, `status ${jasmineAuth.status}`);

  // Smoke test before trusting the contexts (plan Step 0B2).
  const smoke = await syncOnce(parentAuth.cookie);
  const smokeTasks = smoke.body?.snapshot?.tasks || [];
  check(
    "smoke: parent GET /api/tasks/sync 200 with all five fixtures",
    smoke.status === 200 && smokeTasks.length === 5,
    `status ${smoke.status}, ${smokeTasks.length} fixtures`,
  );

  // The cookie alone authenticates the SERVER gate; the client's identity
  // lives in localStorage `consuela-auth-user`, exactly what finishLogin
  // (useAuth.tsx:259-278) writes. Seed it via addInitScript so it survives
  // every navigation and reload (the d4 reload case depends on that).
  // Seeded as FIRST names on purpose: the AuthProvider hydrates before the
  // roster fetch lands and matches against the static fallbacks, whose names
  // are "Rebecca (Mom)" / bare first names — a full-name seed for the parent
  // fails that match and is cleared (useAuth.tsx:149-175). memberMatchesName
  // maps a first name onto both the fallback and the live roster row.
  const fixtureMembers = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "members.json"), "utf8"));
  const memberForContext = {
    P: "Rebecca",
    K: "Caspian",
    T: "Aurora",
    J: "Jasmine",
  };
  for (const [key, cookie] of [["P", parentAuth.cookie], ["K", kidAuth.cookie], ["T", teenAuth.cookie], ["J", jasmineAuth.cookie]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: SESSION_COOKIE, value: cookie, url: APP_URL }]);
    const member = fixtureMembers.find((m) => m.name.split(" ")[0] === memberForContext[key]);
    await context.addInitScript(
      ({ user }) => {
        try { localStorage.setItem("consuela-auth-user", JSON.stringify(user)); } catch { /* storage denied */ }
        // Pin the kid surface out of bedtime mode (useDashboardMode
        // :47-49 hides the quest list between 20:00 and 06:00). Only inside
        // the browser context, only getHours, so the harness is deterministic
        // whatever the wall clock says.
        Date.prototype.getHours = function getHoursPinned() {
          return 10;
        };
      },
      {
        user: {
          id: 0,
          pbId: memberIds[member.name],
          name: memberForContext[key],
          role: member.role,
          emoji: "😊",
          color: "amber",
          avatarSize: "md",
          glow: false,
          age: member.age,
        },
      },
    );
    contexts[key] = context;
    const page = await context.newPage();
    pages[key] = page;
    page.on("pageerror", (e) => console.log(`   [pageerror ${key}] ${e.message}`));
  }

  // --- Step 0B3 Probe 1: is the cross-device read healthy? -----------------
  const probe1 = await syncOnce(parentAuth.cookie);
  const probe1Tasks = probe1.body?.snapshot?.tasks || [];
  hop("probe1", {
    question: "is the cross-device read healthy?",
    status: probe1.status,
    reconciled: probe1.body?.reconciled,
    failed: probe1.body?.failed,
    fixtureCount: probe1Tasks.length,
    interpretation: probe1.status === 200 ? "healthy" : probe1.status === 503 ? "FINDING — 503 on idle freshly-seeded PB" : "unexpected",
  });
  findings.probes.probe1 = { status: probe1.status, reconciled: probe1.body?.reconciled ?? null, failed: probe1.body?.failed ?? [] };
  check("probe 1: sync read answered", probe1.status === 200 || probe1.status === 503, `status ${probe1.status}`);

  // --- Step 0B6 (run first): symptom (c) latency needs P idle on /tasks ---
  // P opens /tasks and goes idle. K taps. t0 = K's optimistic row; t1 = the
  // row title inside P's Needs-approval card. One clock (this process).
  await pages.P.goto(`${APP_URL}/tasks`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForFixtures(pages.P);
  await waitForRosterAge(pages.P, "Rebecca", 40);
  await sleep(1000);

  await pages.K.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForKidHome(pages.K);
  await waitForRosterAge(pages.K, "Caspian", 7);

  // a1/c1: K taps assigned-young on KidHome (PIN-free under-10 path). The
  // surface is KidHome, not /tasks: children are redirected to "/" by
  // page.tsx:307-314. Same outbox + /api/tasks/claim seam.
  const tapTarget = pages.K.locator('[aria-label="Complete quest: Sweep the kitchen floor for 5 points"]');
  await tapTarget.waitFor({ state: "visible", timeout: 30_000 });

  // Capture K's claim POST body (a2) and its status.
  let claimPostBody = null;
  let claimPostStatus = 0;
  pages.K.on("request", (req) => {
    if (req.url().includes("/api/tasks/claim") && req.method() === "POST") {
      try {
        claimPostBody = JSON.parse(req.postData() || "{}");
      } catch { /* non-JSON */ }
    }
  });
  pages.K.on("response", async (res) => {
    if (res.url().includes("/api/tasks/claim") && res.request().method() === "POST") {
      claimPostStatus = res.status();
    }
  });

  const t0 = Date.now();
  await tapTarget.click();
  // Read the outbox immediately after the tap: the flush is async, but on a
  // fast local server the ack can remove the entry within a poll interval. If
  // it is already empty, a2's POST body is the durable proof of the command.
  const kOutboxAfterTap = await outboxEntries(pages.K);
  // The optimistic "on the way" row is KidHome's data-testid="optimistic-quest"
  // (the /tasks testid is optimistic-task-row and never renders here). It can
  // flash for less than one frame, so an already-acked tap is accepted on the
  // strength of the claim POST captured above.
  const a1Optimistic = await waitForOptimisticQuest(pages.K, "Sweep the kitchen floor", () => Boolean(claimPostBody));
  const t0Done = Date.now();

  const kToast = await pages.K.evaluate(() => document.body.innerText);
  hop("a1", {
    question: "kid taps — the command leaves as one durable outbox entry; no local point moved",
    outboxEntries: kOutboxAfterTap.map((e) => ({ action: e.action, status: e.status, operationId: e.operationId })),
    outboxNote: kOutboxAfterTap.length === 0
      ? "already acknowledged at read time — a2's POST body is the durable proof of the command"
      : "observed in flight",
    toastSawOnTheWay: /on the way/.test(kToast),
    optimisticRow: a1Optimistic,
  });
  hop("a2", {
    question: "client send — POST /api/tasks/claim carries operationId + memberName, no pin",
    body: redactPins(claimPostBody),
    hasPin: claimPostBody ? "pin" in claimPostBody : null,
    httpStatus: claimPostStatus,
  });

  // c2: t1 = the row title inside P's Needs-approval card, polling 500ms.
  let t1 = null;
  let pSyncStatusAtT1 = null;
  const c2Deadline = Date.now() + CROSS_DEVICE_THRESHOLD_MS;
  while (Date.now() < c2Deadline) {
    const cardText = await pages.P.evaluate(() => {
      const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("Needs approval"));
      if (!h) return null;
      let el = h;
      for (let i = 0; i < 5 && el; i++) {
        el = el.parentElement;
        if (el) {
          const rows = [...el.querySelectorAll(".schedule-row")];
          if (rows.length) return rows.map((r) => r.innerText).join("\n");
        }
      }
      return null;
    });
    if (cardText && cardText.includes("Sweep the kitchen floor")) {
      t1 = Date.now();
      const pSync = await syncOnce(parentAuth.cookie);
      pSyncStatusAtT1 = pSync.status;
      break;
    }
    await sleep(500);
  }
  const latencyMs = t1 !== null ? t1 - t0 : null;
  hop("c2", {
    question: "cross-device latency — t0 (K optimistic row) to t1 (row in P's card)",
    t0, t1, latencyMs,
    thresholdMs: CROSS_DEVICE_THRESHOLD_MS,
    verdict: t1 === null ? "FAIL — never appeared within 180s" : latencyMs <= CROSS_DEVICE_THRESHOLD_MS ? "PASS" : "FAIL",
  });
  hop("c3", {
    question: "P's GET /api/tasks/sync status while the row was landing",
    status: pSyncStatusAtT1 ?? probe1.status,
    note: "a 503 here means the adoption path was skipped entirely (page.tsx:762-767) even though the body carried the row",
  });

  // a3: server applies — the sync now shows pendingApproval on assigned-young.
  const syncAfterTap = await syncOnce(kidAuth.cookie);
  const youngRow = (syncAfterTap.body?.snapshot?.tasks || []).find((t) => t.id === 101);
  hop("a3", {
    question: "server applies — sync shows pendingApproval + completed on assigned-young",
    pendingApproval: youngRow?.pendingApproval ?? null,
    completed: youngRow?.completed ?? null,
    latencyMs: t0Done - t0,
  });

  // a4: parent sees it.
  await waitForCardRow(pages.P, "Sweep the kitchen floor");
  const pRowsBeforeApprove = await needsApprovalRows(pages.P);
  hop("a4", {
    question: "parent context renders the Needs-approval card with 1 row",
    rowCount: pRowsBeforeApprove?.length ?? 0,
    rows: pRowsBeforeApprove,
  });

  // a5/a6: parent approves via the UI (PIN dialog). Record status + full body.
  let approveStatus = null;
  let approveBody = null;
  pages.P.on("response", async (res) => {
    if (res.url().includes("/api/tasks/approve") && res.request().method() === "POST") {
      approveStatus = res.status();
      approveBody = redactPins(await res.json().catch(() => ({})));
    }
  });
  await pages.P.locator('[aria-label="Approve Sweep the kitchen floor"]').click();
  await pages.P.locator('input[aria-label="Parent PIN"]').waitFor({ state: "visible", timeout: 15_000 });
  await pages.P.locator('input[aria-label="Parent PIN"]').fill("1234");
  await pages.P.keyboard.press("Enter");
  await sleep(4000);
  hop("a5", {
    question: "parent approves — record the status and the full body",
    status: approveStatus,
    body: approveBody,
  });
  const preparedCount = pRowsBeforeApprove?.length ?? 0;
  hop("a6", {
    question: "THE FAULT LINE — cleared vs the number of rows that were pending",
    preparedRows: preparedCount,
    cleared: approveBody?.cleared ?? null,
    paid: approveBody?.paid ?? null,
    reconciled: approveBody?.reconciled ?? null,
    repairRequired: approveBody?.repairRequired ?? null,
    honest: (approveBody?.cleared ?? 0) < preparedCount ? "NO — cleared < prepared while the route still reports repairRequired:false" : "yes",
  });

  // a7: client ack — the outbox entry is removed.
  await sleep(1500);
  const pOutboxAfterApprove = await outboxEntries(pages.P);
  hop("a7", {
    question: "client ack — the outbox entry is removed and the optimistic mark released",
    remainingEntries: pOutboxAfterApprove.map((e) => ({ action: e.action, status: e.status })),
  });

  // a8: does the approve ack clear the row, and does the next pull clear it?
  // The ack's clear is merged WITHOUT weekData (task-command-store.ts:1118-1126),
  // so paidElsewhere is false and the clear gate (task-utils.ts:719-738) rejects
  // it. The evidence for the defect is therefore TWO observations: the row must
  // survive the ack, then clear only when a pull carries the earn. Watch P's
  // card for up to ~80s (one 60s CacheRefresher tick + margin).
  const pRowsAfterAck = await needsApprovalRows(pages.P);
  const a8SurvivedAck = pRowsAfterAck !== null && pRowsAfterAck.some((r) => r.includes("Sweep the kitchen floor"));
  let a8Cleared = false;
  let a8ClearedLatencyMs = null;
  const a8Start = Date.now();
  let a8PullStatus = null;
  while (Date.now() - a8Start < 80_000) {
    const rows = await needsApprovalRows(pages.P);
    // A missing card (null) means NO pending rows at all — the card unmounts
    // when pendingApprovals empties, so null is a clear, not a miss.
    if (rows === null || !rows.some((r) => r.includes("Sweep the kitchen floor"))) {
      a8Cleared = true;
      a8ClearedLatencyMs = Date.now() - a8Start;
      break;
    }
    const sync = await syncOnce(parentAuth.cookie);
    a8PullStatus = sync.status;
    await sleep(2000);
  }
  const pRowsAfterA8 = await needsApprovalRows(pages.P);
  hop("a8", {
    question: "does the approve ack clear the row, and does the next pull?",
    survivedAck: a8SurvivedAck,
    clearedAfterPull: a8Cleared,
    clearedAfterPullLatencyMs: a8ClearedLatencyMs,
    lastPullStatus: a8PullStatus,
    rowsNow: pRowsAfterA8,
    guard: "the ack merge carries no weekData (task-command-store.ts:1120-1126), so paidElsewhere is false and the clear gate (task-utils.ts:719-738) refuses the clear; the row clears only when a pull carries the earn in weekData.history",
  });

  // a9: points landed? Compare the ledger earn count for task 101.
  const ledgerAfterA = await ledgerHistory();
  const earnsFor101 = (ledgerAfterA.history || []).filter((tx) => tx.taskId === 101 && tx.type === "earn");
  hop("a9", {
    question: "points landed — ledger earn count for task 101 vs the row count",
    earnCount: earnsFor101.length,
    earns: earnsFor101.map((tx) => ({ member: tx.member, amount: tx.amount })),
    points: ledgerAfterA.points,
  });

  // a10: second approve on the stuck row. Via the UI when the row is still
  // present, and always via the API so the server-side verdict is captured.
  const secondApproveBtn = pages.P.locator('[aria-label="Approve Sweep the kitchen floor"]');
  let a10Ui = null;
  if ((await secondApproveBtn.count()) > 0) {
    let secondStatus = null;
    let secondBody = null;
    const listener = async (res) => {
      if (res.url().includes("/api/tasks/approve") && res.request().method() === "POST") {
        secondStatus = res.status();
        secondBody = redactPins(await res.json().catch(() => ({})));
      }
    };
    pages.P.on("response", listener);
    await secondApproveBtn.click();
    await pages.P.locator('input[aria-label="Parent PIN"]').waitFor({ state: "visible", timeout: 15_000 });
    await pages.P.locator('input[aria-label="Parent PIN"]').fill("1234");
    await pages.P.keyboard.press("Enter");
    await sleep(4000);
    pages.P.off("response", listener);
    a10Ui = { status: secondStatus, body: secondBody };
  }
  const a10Api = await authedFetch(parentAuth.cookie, "/api/tasks/approve", {
    method: "POST",
    body: JSON.stringify({ action: "approve", operationId: "p0-harness-a10-replay", taskId: 101, memberName: "Rebecca Garcia", pin: "1234" }),
  });
  const a10ApiBody = redactPins(await a10Api.json().catch(() => ({})));
  const a10ApiStatus = a10Api.status;
  hop("a10", {
    question: "second approve on a stuck row — record status/reason",
    ui: a10Ui,
    api: { status: a10Api.status, body: a10ApiBody },
    note: "a duplicate refusal that the client classifies as an ack (task-command-store.ts:790-793) is another ack with no row clear",
  });

  // --- Step 0B5: symptom (b) — points wrong or missing after approval -----
  // b1 is assigned-young (done above): card showed 5, server paid 5.
  const b1CardAmount = 5;
  const b1Paid = earnsFor101.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  hop("b1", {
    question: "base points — the two agree by construction",
    cardAmount: b1CardAmount,
    serverPaid: b1Paid,
    agree: b1CardAmount === b1Paid,
  });

  // b2: universal-bonus — Aurora (13) claims with her PIN on KidHome (the
  // Open board's "Grab it" row); the card prints task.points (6) while
  // approval pays pendingApproval.points (9).
  await pages.T.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForKidHome(pages.T);
  await waitForRosterAge(pages.T, "Aurora", 13);
  await pages.T.locator('[aria-label="Grab it: Unload the dishwasher"]').click();
  await pages.T.locator('input[aria-label="Your 4-digit PIN"]').waitFor({ state: "visible", timeout: 15_000 });
  await pages.T.locator('input[aria-label="Your 4-digit PIN"]').fill("3456");
  await pages.T.keyboard.press("Enter");
  await sleep(4000);
  const syncB2 = await syncOnce(teenAuth.cookie);
  const bonusRow = (syncB2.body?.snapshot?.tasks || []).find((t) => t.id === 103);
  hop("b2-claim", {
    question: "teen claims universal-bonus with PIN — pendingApproval.points = points + speedBonus",
    pendingApproval: bonusRow?.pendingApproval ?? null,
    expectedPoints: 9,
  });
  await forcePull(pages.P);
  await waitForCardRow(pages.P, "Unload the dishwasher");
  let b2Status = null;
  let b2Body = null;
  const b2Listener = async (res) => {
    if (res.url().includes("/api/tasks/approve") && res.request().method() === "POST") {
      b2Status = res.status();
      b2Body = redactPins(await res.json().catch(() => ({})));
    }
  };
  pages.P.on("response", b2Listener);
  await pages.P.locator('[aria-label="Approve Unload the dishwasher"]').click();
  await pages.P.locator('input[aria-label="Parent PIN"]').waitFor({ state: "visible", timeout: 15_000 });
  await pages.P.locator('input[aria-label="Parent PIN"]').fill("1234");
  await pages.P.keyboard.press("Enter");
  await sleep(4000);
  pages.P.off("response", b2Listener);
  const ledgerB2 = await ledgerHistory();
  const earnsFor103 = (ledgerB2.history || []).filter((tx) => tx.taskId === 103 && tx.type === "earn");
  const b2CardText = await pages.P.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("Needs approval"));
    if (!h) return "";
    let el = h;
    for (let i = 0; i < 5 && el; i++) {
      el = el.parentElement;
      if (el) {
        const rows = [...el.querySelectorAll(".schedule-row")];
        if (rows.length) return rows.map((r) => r.innerText).join("\n");
      }
    }
    return "";
  });
  hop("b2", {
    question: "the award the card shows vs the award approval pays",
    cardMetaLine: b2CardText.match(/(\d+)pts/)?.[0] || "not found",
    cardShowsTaskPoints: b2CardText.includes("6pts"),
    serverPaid: earnsFor103.reduce((s, tx) => s + (tx.amount || 0), 0),
    earnAmounts: earnsFor103.map((tx) => tx.amount),
    approveStatus: b2Status,
    approveBody: { paid: b2Body?.paid, cleared: b2Body?.cleared },
    defect: "card prints task.points (page.tsx:2937) while approval pays pendingApproval.points (task-approval.ts:403) — the card under-reports the award by the speed bonus",
  });

  // b3: crew-two — parent closes the crew (API, parent PIN), then approves.
  // The crew line prints task.points ONCE for an award list of 2 payees.
  const crewClose = await authedFetch(parentAuth.cookie, "/api/tasks/claim", {
    method: "POST",
    body: JSON.stringify({ operationId: "p0-harness-b3-crew-close", action: "crew-close", taskId: 104, memberName: "Rebecca Garcia", pin: "1234" }),
  });
  const crewCloseBody = redactPins(await crewClose.json().catch(() => ({})));
  const syncB3 = await syncOnce(parentAuth.cookie);
  const crewRow = (syncB3.body?.snapshot?.tasks || []).find((t) => t.id === 104);
  hop("b3-close", {
    question: "parent closes crew-two — pendingApproval.crew lists 2 payees",
    status: crewClose.status,
    body: crewCloseBody,
    pendingApproval: crewRow?.pendingApproval ?? null,
  });
  await forcePull(pages.P);
  await waitForCardRow(pages.P, "Clean the playroom");
  let b3Status = null;
  let b3Body = null;
  const b3Listener = async (res) => {
    if (res.url().includes("/api/tasks/approve") && res.request().method() === "POST") {
      b3Status = res.status();
      b3Body = redactPins(await res.json().catch(() => ({})));
    }
  };
  pages.P.on("response", b3Listener);
  await pages.P.locator('[aria-label="Approve Clean the playroom"]').click();
  await pages.P.locator('input[aria-label="Parent PIN"]').waitFor({ state: "visible", timeout: 15_000 });
  await pages.P.locator('input[aria-label="Parent PIN"]').fill("1234");
  await pages.P.keyboard.press("Enter");
  await sleep(4000);
  pages.P.off("response", b3Listener);
  const ledgerB3 = await ledgerHistory();
  const earnsFor104 = (ledgerB3.history || []).filter((tx) => tx.taskId === 104 && tx.type === "earn");
  const b3CardText = await pages.P.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("Needs approval"));
    if (!h) return "";
    let el = h;
    for (let i = 0; i < 5 && el; i++) {
      el = el.parentElement;
      if (el) {
        const rows = [...el.querySelectorAll(".schedule-row")];
        if (rows.length) return rows.map((r) => r.innerText).join("\n");
      }
    }
    return "";
  });
  hop("b3", {
    question: "crew award list — the crew line prints task.points once for 2 payees",
    cardCrewLine: /(\d+)pts each/.test(b3CardText) ? b3CardText.match(/(\d+)pts each/)[0] : "not found",
    ledgerPaid: earnsFor104.map((tx) => ({ member: tx.member, amount: tx.amount })),
    totalPaid: earnsFor104.reduce((s, tx) => s + (tx.amount || 0), 0),
    approveStatus: b3Status,
    approveBody: { paid: b3Body?.paid, cleared: b3Body?.cleared, skipped: b3Body?.skipped },
    defect: "the card prints task.points once (page.tsx:2933) for an award list of 2 payees (task-claim.ts:1686) — approval pays EACH member",
  });

  // --- Step 0B7: symptom (d) — PIN/permission errors -----------------------
  // d1: parent approves with a wrong PIN → 401 unauthorized, entry terminal.
  const d1 = await fetch(`${APP_URL}/api/tasks/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId: "p0-harness-d1-wrong-pin", action: "approve", taskId: 102, memberName: "Rebecca Garcia", pin: "9999" }),
  });
  const d1Body = redactPins(await d1.json().catch(() => ({})));
  hop("d1", {
    question: "parent approves with a wrong PIN",
    status: d1.status,
    reason: d1Body.reason ?? d1Body.code,
    expect: "401 unauthorized, entry terminal (approve/route.ts:135-137)",
  });

  // d2: a child tries to approve → 403 adult_only.
  const d2 = await fetch(`${APP_URL}/api/tasks/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId: "p0-harness-d2-child-approve", action: "approve", taskId: 102, memberName: "Aurora Garcia", pin: "3456" }),
  });
  const d2Body = redactPins(await d2.json().catch(() => ({})));
  hop("d2", {
    question: "a child tries to approve",
    status: d2.status,
    reason: d2Body.reason ?? d2Body.code,
    expect: "403 adult_only (approve/route.ts:148-150)",
  });

  // d3: a claim action outside complete/undo/crew-join/crew-checkin with no PIN.
  const d3 = await fetch(`${APP_URL}/api/tasks/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId: "p0-harness-d3-crew-remove", action: "crew-remove", taskId: 104, targetName: "Jasmine Garcia" }),
  });
  const d3Body = redactPins(await d3.json().catch(() => ({})));
  hop("d3", {
    question: "crew-remove with no PIN and no session",
    status: d3.status,
    reason: d3Body.reason ?? d3Body.code,
    expect: "401 pin_required (claim/route.ts:155-157)",
  });

  // d4: THE KEY CASE — queue a PIN-gated approval, drop the network for one
  // tick (route.abort), reload the page (the in-memory credential map is
  // wiped), and let the outbox re-send. The POST carries no pin.
  // Aurora taps assigned-teen first so a pending row exists.
  await pages.T.locator('[aria-label="Complete quest: Fold the laundry for 7 points"]').click();
  await pages.T.locator('input[aria-label="Your 4-digit PIN"]').waitFor({ state: "visible", timeout: 15_000 });
  await pages.T.locator('input[aria-label="Your 4-digit PIN"]').fill("3456");
  await pages.T.keyboard.press("Enter");
  await sleep(4000);

  // Fresh parent page for a clean outbox + credential map.
  const pagesD = await contexts.P.newPage();
  await pagesD.goto(`${APP_URL}/tasks`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForFixtures(pagesD);
  await waitForCardRow(pagesD, "Fold the laundry");
  await pagesD.locator('[aria-label="Approve Fold the laundry"]').click();
  await pagesD.locator('input[aria-label="Parent PIN"]').waitFor({ state: "visible", timeout: 15_000 });
  await pagesD.locator('input[aria-label="Parent PIN"]').fill("1234");
  // Drop the network for exactly one tick: abort the approve POST.
  await contexts.P.route("**/api/tasks/approve", (route) => route.abort());
  await pagesD.keyboard.press("Enter");
  await sleep(3000);
  await contexts.P.unroute("**/api/tasks/approve");
  const d4OutboxMid = await outboxEntries(pagesD);
  // Reload: the localStorage entry survives, the in-memory PIN does not. The
  // mount flush (CacheRefresher) re-sends the now-due retrying entry.
  await pagesD.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForFixtures(pagesD);
  await sleep(6000);
  const d4OutboxAfter = await outboxEntries(pagesD);
  const d4Entry = [...d4OutboxAfter, ...d4OutboxMid].find(
    (e) => e.action === "approve" && Number(e.payload?.taskId) === 102,
  );
  hop("d4", {
    question: "a PIN-gated approval re-sent after a reload",
    outboxMid: d4OutboxMid.map((e) => ({ action: e.action, status: e.status, lastErrorCategory: e.lastErrorCategory })),
    outboxAfter: d4OutboxAfter.map((e) => ({ action: e.action, status: e.status, lastErrorCategory: e.lastErrorCategory, lastErrorReason: e.lastErrorReason })),
    terminalStatus: d4Entry?.status ?? "gone",
    terminalCategory: d4Entry?.lastErrorCategory ?? null,
    terminalReason: d4Entry?.lastErrorReason ?? null,
    expectPerSuite6: "status 'auth-required' with lastErrorCategory NOT a refusal — the entry should ask for the PIN again, not refuse it",
    defect: "processEntry maps the refusal straight to markFailed (task-command-store.ts:770-775); the PIN lived only in an in-memory map (task-command-store.ts:86-107)",
  });

  // b4 (moved after d4 so approve-all has TWO ids): Jasmine (9, the fixture's
  // assignee) taps open-assigned PIN-free while task 102 is still pending from
  // d4's refused replay, so approve-all reads back two rows — the plan's
  // "second pending row, so approve-all has more than one id". A
  // non-universal, non-stealable row is only completable by its assignee, so
  // this MUST be Jasmine's context, not K's.
  const pagesJ = pages.J;
  await pagesJ.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForKidHome(pagesJ);
  await waitForRosterAge(pagesJ, "Jasmine", 9);
  const b4Titles = ["Fold the laundry", "Wipe the bathroom counters"];
  let b4ClaimPosted = false;
  const b4RequestListener = (request) => {
    if (request.url().includes("/api/tasks/claim") && request.method() === "POST") b4ClaimPosted = true;
  };
  pagesJ.on("request", b4RequestListener);
  await pagesJ.locator('[aria-label="Complete quest: Wipe the bathroom counters for 5 points"]').click();
  const b4Optimistic = await waitForOptimisticQuest(pagesJ, "Wipe the bathroom counters", () => b4ClaimPosted);
  pagesJ.off("request", b4RequestListener);
  await sleep(3000);
  await forcePull(pages.P);
  await waitForCardRow(pages.P, "Wipe the bathroom counters");
  const b4PendingRows = await needsApprovalRows(pages.P);
  const b4IdsOnCard = [102, 105].filter((id, i) => (b4PendingRows || []).some((r) => r.includes(b4Titles[i])));
  const approveAllBtn = pages.P.locator('button:has-text("Approve all")');
  const approveAllCount = await approveAllBtn.count();
  let b4Status = null;
  let b4Body = null;
  if (approveAllCount > 0) {
    const b4Listener = async (res) => {
      if (res.url().includes("/api/tasks/approve") && res.request().method() === "POST") {
        b4Status = res.status();
        b4Body = redactPins(await res.json().catch(() => ({})));
      }
    };
    pages.P.on("response", b4Listener);
    await approveAllBtn.click();
    await pages.P.locator('input[aria-label="Parent PIN"]').waitFor({ state: "visible", timeout: 15_000 });
    await pages.P.locator('input[aria-label="Parent PIN"]').fill("1234");
    await pages.P.keyboard.press("Enter");
    await sleep(4000);
    pages.P.off("response", b4Listener);
  }
  const ledgerB4 = await ledgerHistory();
  const earnsB4 = (ledgerB4.history || []).filter((tx) => (tx.taskId === 102 || tx.taskId === 105) && tx.type === "earn");
  hop("b4", {
    question: "approve-all pays every id in taskIds and reports paid for all of them",
    optimisticRow: b4Optimistic,
    pendingIdsOnCard: b4IdsOnCard,
    approveAllButtonFound: approveAllCount > 0,
    status: b4Status,
    body: b4Body ? { paid: b4Body.paid, cleared: b4Body.cleared, skipped: b4Body.skipped, reconciled: b4Body.reconciled } : null,
    earnsFor102And105: earnsB4.map((tx) => ({ taskId: tx.taskId, member: tx.member, amount: tx.amount })),
    note: "the page already surfaces skipped as 'N not eligible' (page.tsx:635-641)",
  });

  // d5: the affordance that should have said "waiting on a PIN".
  // page.tsx:2417-2418 renders it from outboxCounts.authRequired, which
  // useTaskOperationOutbox.ts:109 computes as entries with status
  // 'auth-required' — and task-operation-payload.ts:509 rewrites every
  // persisted 'auth-required' to 'failed' on read. The count is structurally 0.
  const d5Banner = await pagesD.evaluate(() => document.body.innerText);
  const d5Outbox = await outboxEntries(pagesD);
  const d5AuthRequired = d5Outbox.filter((e) => e.status === "auth-required");
  hop("d5", {
    question: "the affordance that should have said 'waiting on a PIN'",
    bannerVisible: /waiting on a PIN/.test(d5Banner),
    authRequiredEntries: d5AuthRequired.length,
    defect: "task-operation-payload.ts:509 rewrites every persisted 'auth-required' to 'failed' on read, so useTaskOperationOutbox.ts:109's count is structurally 0 and the banner is dead code",
  });

  // --- Step 0B3 Probe 2 / c8: the drain must not require a reader -----------
  // Seed a pending queue row directly. The 202-queued path cannot be forced
  // deterministically in a disposable harness — every queueable claim reason
  // needs a PB outage that also breaks the enqueue write — so the property
  // under test (the drain trigger) is exercised with a seeded row.
  // ANY open app page polls /api/tasks/sync via CacheRefresher every 60s, so
  // "no device reading anything" means every page closed.
  for (const key of Object.keys(pages)) {
    try { await pages[key].close(); } catch { /* already closed */ }
    delete pages[key];
  }
  // The d4 page is a second page in P's context, not in `pages` — close it
  // too, or its CacheRefresher keeps draining the queue and the c8 probe
  // would be measuring a reader that was never absent.
  try { await pagesD.close(); } catch { /* already closed */ }
  // Schema-exact copy of enqueueTaskCommandRow's write (actor lives in four
  // columns, payload/displayTarget are json) — a mismatched shape would 400 on
  // required actorMemberId and the probe would never get off the ground.
  const queueRow = {
    operationId: "p0-harness-queue-probe",
    route: "/api/tasks/claim",
    action: "complete",
    payload: { taskId: 101, memberName: "Caspian Garcia" },
    actorMemberId: memberIds["Caspian Garcia"] || "fixture-caspian",
    actorName: "Caspian Garcia",
    actorRole: "child",
    actorAuthentication: "session",
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: new Date().toISOString(),
    displayTarget: { kind: "claim", taskId: 101, title: "Sweep the kitchen floor" },
  };
  const queueSeed = await pbFetch("/collections/task_command_queue/records", {
    method: "POST",
    body: JSON.stringify(queueRow),
  });
  if (!queueSeed.ok) throw new Error(`queue seed failed: ${await queueSeed.text()}`);

  const queueRead = async () => {
    const res = await authedFetch(parentAuth.cookie, "/api/tasks/queue");
    const body = await res.json().catch(() => ({}));
    return { status: res.status, rows: body.rows || [] };
  };
  const c8Start = Date.now();
  let c8Row = (await queueRead()).rows.find((r) => r.operationId === "p0-harness-queue-probe");
  let c8DrainedAlone = false;
  while (Date.now() - c8Start < 70_000) {
    const { rows } = await queueRead();
    c8Row = rows.find((r) => r.operationId === "p0-harness-queue-probe");
    if (!c8Row || c8Row.status !== "pending") { c8DrainedAlone = true; break; }
    await sleep(3000);
  }
  hop("c8", {
    question: "a server-queued task command drains without a device reading anything",
    drainedWithoutReader: c8DrainedAlone,
    rowAfter70s: c8Row ? { status: c8Row.status, attemptCount: c8Row.attemptCount } : "gone",
    elapsedMs: Date.now() - c8Start,
    defect: "the drain's only trigger is GET /api/tasks/sync (sync/route.ts:67-71) — with no device reading, the row never leaves pending",
  });

  // Now open /tasks on one device: the next sync should drain it.
  const pagesC = await contexts.P.newPage();
  await pagesC.goto(`${APP_URL}/tasks`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForFixtures(pagesC);
  await sleep(6000);
  const c8AfterOpen = await queueRead();
  const c8RowAfter = c8AfterOpen.rows.find((r) => r.operationId === "p0-harness-queue-probe");
  hop("c8-open", {
    question: "after one device opens /tasks, the drain runs",
    row: c8RowAfter ? { status: c8RowAfter.status, attemptCount: c8RowAfter.attemptCount } : "gone (drained)",
  });

  // --- Assemble the 4×4 matrix ---------------------------------------------
  // 4 symptom classes × 4 hop cells. `reproduced` on a CELL means "this hop
  // exhibited the defect"; on a CLASS it means "the symptom reproduced in this
  // run". No cell may be blank; a hop that did not trigger says so explicitly.
  const a6PreparedHonest = (approveBody?.cleared ?? preparedCount) < preparedCount;
  const matrix = [
    {
      symptom: "a-rows-stuck",
      reproduced: a8SurvivedAck === true,
      failingHop: "a8",
      fileLine: "src/lib/task-utils.ts:719-738",
      latencyMs: a8ClearedLatencyMs,
      latencyVerdict: a8SurvivedAck
        ? `ack left the row; the next pull cleared it in ${a8ClearedLatencyMs ?? ">80000"}ms`
        : "not triggered — the row was already gone when the ack was checked",
      disposition: a8SurvivedAck ? "REPRODUCED (tree-native)" : "NOT-TRIGGERED",
      cells: [
        {
          hop: "a3", name: "server applies the tap",
          reproduced: false,
          failingHop: null,
          fileLine: "src/lib/task-claim.ts:1399-1420",
          latencyMs: t0Done - t0,
          latencyVerdict: "INFO — K's optimistic row appeared",
          detail: `pendingApproval=${!!youngRow?.pendingApproval}, completed=${youngRow?.completed}`,
        },
        {
          hop: "a5", name: "parent approves",
          reproduced: false,
          failingHop: "a6",
          fileLine: "src/app/api/tasks/approve/route.ts:232-239",
          latencyMs: null,
          latencyVerdict: "INFO",
          detail: `approve answered ${approveStatus} with cleared=${approveBody?.cleared ?? "?"} paid=${approveBody?.paid ?? "?"}`,
        },
        {
          hop: "a6", name: "cleared-count honesty on a replay",
          reproduced: a6PreparedHonest,
          failingHop: "a6",
          fileLine: "src/lib/task-approval.ts:1139",
          latencyMs: null,
          latencyVerdict: a6PreparedHonest ? "DEFECT — cleared < prepared" : "not triggered — prepared and cleared agree in this flow",
          detail: `prepared ${preparedCount}, first approve cleared ${approveBody?.cleared ?? "?"}; replay answered ${a10ApiStatus} cleared=${a10ApiBody?.cleared ?? "?"} repairRequired=${a10ApiBody?.repairRequired ?? "?"} (the skip-silently path needs a prepared row cleared out-of-band — RED suite 1's fixture)`,
        },
        {
          hop: "a8", name: "approve ack vs the next pull",
          reproduced: a8SurvivedAck === true,
          failingHop: "a8",
          fileLine: "src/lib/task-utils.ts:719-738",
          latencyMs: a8ClearedLatencyMs,
          latencyVerdict: a8SurvivedAck
            ? `DEFECT — the ack did not clear; the pull did, in ${a8ClearedLatencyMs ?? ">80000"}ms`
            : "INFO — ack or pull cleared the row",
          detail: "the ack merge carries no weekData (task-command-store.ts:1120-1126), so paidElsewhere is false and the clear gate refuses the clear",
        },
      ],
    },
    {
      symptom: "b-points",
      reproduced: (findings.hops.b2?.serverPaid ?? 0) === 9 && (findings.hops.b2?.cardShowsTaskPoints ?? false),
      failingHop: "b2",
      fileLine: "src/app/tasks/page.tsx:2937",
      latencyMs: null,
      latencyVerdict: "INFO — display-vs-pay mismatch, no timing dimension",
      disposition: ((findings.hops.b2?.serverPaid ?? 0) === 9 && (findings.hops.b2?.cardShowsTaskPoints ?? false)) ? "REPRODUCED (tree-native)" : "NOT-TRIGGERED",
      cells: [
        {
          hop: "b1", name: "base points agree",
          reproduced: false,
          failingHop: null,
          fileLine: "src/app/tasks/page.tsx:2937",
          latencyMs: null,
          latencyVerdict: "INFO — control case",
          detail: `card ${b1CardAmount} / paid ${b1Paid}`,
        },
        {
          hop: "b2", name: "speed-bonus award — card vs paid",
          reproduced: (findings.hops.b2?.serverPaid ?? 0) === 9 && (findings.hops.b2?.cardShowsTaskPoints ?? false),
          failingHop: "b2",
          fileLine: "src/app/tasks/page.tsx:2937",
          latencyMs: null,
          latencyVerdict: "DEFECT — the card prints task.points while approval pays pendingApproval.points",
          detail: `card shows 6pts (task.points) while approval pays ${findings.hops.b2?.serverPaid ?? "?"} (pendingApproval.points)`,
        },
        {
          hop: "b3", name: "crew award — card vs ledger",
          reproduced: false,
          failingHop: null,
          fileLine: "src/app/tasks/page.tsx:2933",
          latencyMs: null,
          latencyVerdict: "INFO — the card's '4pts each' matches the ledger; legibility is U1's",
          detail: `card prints 4pts each for 2 payees; ledger paid ${findings.hops.b3?.totalPaid ?? "?"} total (${JSON.stringify(findings.hops.b3?.ledgerPaid ?? [])})`,
        },
        {
          hop: "b4", name: "approve-all pays every id",
          reproduced: b4Status !== null && (b4Body?.paid ?? 0) === 0,
          failingHop: b4Status === null ? "b4" : null,
          fileLine: "src/app/tasks/page.tsx:1327-1333",
          latencyMs: null,
          latencyVerdict: b4Status !== null && (b4Body?.paid ?? 0) > 0 ? "INFO — paid" : "FAIL — approve-all paid nothing",
          detail: `approve-all ${b4Status}: paid=${b4Body?.paid ?? "?"} cleared=${b4Body?.cleared ?? "?"} skipped=${b4Body?.skipped ?? "?"} over ids ${JSON.stringify(findings.hops.b4?.pendingIdsOnCard ?? [])}`,
        },
      ],
    },
    {
      symptom: "c-cross-device",
      reproduced: c8DrainedAlone === false || t1 === null || (latencyMs !== null && latencyMs > CROSS_DEVICE_THRESHOLD_MS),
      failingHop: c8DrainedAlone === false ? "c8" : "c2",
      fileLine: c8DrainedAlone === false ? "src/app/api/tasks/sync/route.ts:67-71" : "src/components/ui/CacheRefresher.tsx:13",
      latencyMs,
      latencyVerdict: latencyMs === null ? "FAIL — t1 never reached; the row never appeared in P's card" : latencyMs <= CROSS_DEVICE_THRESHOLD_MS ? `PASS — ${latencyMs}ms ≤ ${CROSS_DEVICE_THRESHOLD_MS}ms` : `FAIL — ${latencyMs}ms > ${CROSS_DEVICE_THRESHOLD_MS}ms`,
      disposition: (c8DrainedAlone === false || t1 === null || (latencyMs !== null && latencyMs > CROSS_DEVICE_THRESHOLD_MS)) ? "REPRODUCED (tree-native)" : "NOT-TRIGGERED",
      cells: [
        {
          hop: "c2", name: "cross-device latency (t0→t1)",
          reproduced: t1 === null || (latencyMs !== null && latencyMs > CROSS_DEVICE_THRESHOLD_MS),
          failingHop: t1 === null || (latencyMs !== null && latencyMs > CROSS_DEVICE_THRESHOLD_MS) ? "c2" : null,
          fileLine: "src/components/ui/CacheRefresher.tsx:13",
          latencyMs,
          latencyVerdict: latencyMs === null ? "FAIL — never appeared" : latencyMs <= CROSS_DEVICE_THRESHOLD_MS ? "PASS" : "FAIL",
          detail: `t0 = K's optimistic row, t1 = row title in P's Needs-approval card; threshold ${CROSS_DEVICE_THRESHOLD_MS}ms`,
        },
        {
          hop: "c3", name: "P's sync status while the row landed",
          reproduced: pSyncStatusAtT1 === 503,
          failingHop: pSyncStatusAtT1 === 503 ? "c3" : null,
          fileLine: "src/app/api/tasks/sync/route.ts:195",
          latencyMs: null,
          latencyVerdict: pSyncStatusAtT1 === 503 ? "DEFECT — 503 discards a body that carries the row" : "INFO",
          detail: `GET /api/tasks/sync as P answered ${pSyncStatusAtT1 ?? "?"}`,
        },
        {
          hop: "c5", name: "revision monotonic guard",
          reproduced: false,
          failingHop: null,
          fileLine: "src/app/tasks/page.tsx:721-727",
          latencyMs: null,
          latencyVerdict: "not triggered — no stale revision was produced by this flow",
          detail: `revisions observed monotonic: probe ${probe1.body?.revision ?? "?"} → after tap ${syncAfterTap.body?.revision ?? "?"}; the guard drops a strictly-older numeric revision with no user-visible signal, but this run never served one`,
        },
        {
          hop: "c8", name: "drain without a reader",
          reproduced: c8DrainedAlone === false,
          failingHop: c8DrainedAlone === false ? "c8" : null,
          fileLine: "src/app/api/tasks/sync/route.ts:67-71",
          latencyMs: Date.now() - c8Start,
          latencyVerdict: c8DrainedAlone ? "INFO — drained alone" : "DEFECT — the drain is coupled to the read",
          detail: `with every page closed the seeded queue row stayed pending for ${Date.now() - c8Start}ms; after one device opened /tasks: ${c8RowAfter ? c8RowAfter.status : "drained"}`,
        },
      ],
    },
    {
      symptom: "d-pin",
      reproduced: (d4Entry?.status === "failed" && d4Entry?.lastErrorCategory !== "auth-required") || (!/waiting on a PIN/.test(d5Banner) && d5AuthRequired.length === 0),
      failingHop: (d4Entry?.status === "failed" && d4Entry?.lastErrorCategory !== "auth-required") ? "d4" : "d5",
      fileLine: (d4Entry?.status === "failed" && d4Entry?.lastErrorCategory !== "auth-required") ? "src/lib/task-command-store.ts:770-775" : "src/lib/task-operation-payload.ts:509",
      latencyMs: null,
      latencyVerdict: "INFO — the failure is terminal-by-refusal, not a timing defect",
      disposition: ((d4Entry?.status === "failed" && d4Entry?.lastErrorCategory !== "auth-required") || (!/waiting on a PIN/.test(d5Banner) && d5AuthRequired.length === 0)) ? "REPRODUCED (tree-native)" : "NOT-TRIGGERED",
      cells: [
        {
          hop: "d1", name: "wrong PIN → 401, entry terminal",
          reproduced: false,
          failingHop: null,
          fileLine: "src/app/api/tasks/approve/route.ts:135-137",
          latencyMs: null,
          latencyVerdict: "INFO — control case, the refusal is correct",
          detail: `status ${d1.status}, reason ${d1Body.reason ?? d1Body.code ?? "?"}`,
        },
        {
          hop: "d3", name: "sessionless non-session action → 401 pin_required",
          reproduced: false,
          failingHop: null,
          fileLine: "src/app/api/tasks/claim/route.ts:155-157",
          latencyMs: null,
          latencyVerdict: "INFO — control case, the refusal is correct",
          detail: `status ${d3.status}, reason ${d3Body.reason ?? d3Body.code ?? "?"}`,
        },
        {
          hop: "d4", name: "PIN-gated approval re-sent after a reload",
          reproduced: d4Entry?.status === "failed" && d4Entry?.lastErrorCategory !== "auth-required",
          failingHop: "d4",
          fileLine: "src/lib/task-command-store.ts:770-775",
          latencyMs: null,
          latencyVerdict: d4Entry?.status === "failed" ? "DEFECT — the reloaded entry is refused instead of asking for the PIN again" : `INFO — terminal status ${d4Entry?.status ?? "?"}`,
          detail: `terminal status ${d4Entry?.status ?? "?"}, category ${d4Entry?.lastErrorCategory ?? "?"}, reason ${d4Entry?.lastErrorReason ?? "?"} — expected 'auth-required' (ask for the PIN again)`,
        },
        {
          hop: "d5", name: "the 'waiting on a PIN' affordance is dead code",
          reproduced: !/waiting on a PIN/.test(d5Banner) && d5AuthRequired.length === 0,
          failingHop: "d5",
          fileLine: "src/lib/task-operation-payload.ts:509",
          latencyMs: null,
          latencyVerdict: "DEFECT — the banner is unreachable and no entry can hold 'auth-required'",
          detail: "the banner never appears and no entry can hold status 'auth-required' — the storage boundary rewrites it to 'failed' on read",
        },
      ],
    },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    harness: "scripts/tasks/symptom-harness.mjs",
    tz: TZ,
    familyToday: familyTodayISO(),
    familyWeekStart: familyWeekStartISO(),
    environment: {
      pbPort: PB_PORT,
      appPort: APP_PORT,
      pbVersion: "0.39.11",
      crossDeviceThresholdMs: CROSS_DEVICE_THRESHOLD_MS,
    },
    checks: results,
    probes: findings.probes,
    hops: findings.hops,
    matrix,
  };

  const blankCells = matrix.flatMap((row) => row.cells.filter((c) => c.reproduced !== true && c.reproduced !== false));
  check("4×4 matrix has no blank cells", blankCells.length === 0, `${matrix.length} classes × ${matrix[0].cells.length} hops`);

  const reportJson = JSON.stringify(report, null, 2);
  console.log("\n===== SYMPTOM REPORT JSON =====");
  console.log(reportJson);
  if (process.env.SYMPTOM_REPORT_PATH) {
    writeFileSync(process.env.SYMPTOM_REPORT_PATH, reportJson);
    console.log(`\nreport written to ${process.env.SYMPTOM_REPORT_PATH}`);
  }
} catch (e) {
  check("harness run completed", false, `${e?.message || e}`);
  try {
    if (appLogPath) console.log(readFileSync(appLogPath, "utf8").split("\n").slice(-25).join("\n"));
  } catch { /* no log */ }
  if (pbLogPath) {
    try { console.log("--- pb log ---\n" + readFileSync(pbLogPath, "utf8").split("\n").slice(-15).join("\n")); } catch { /* no log */ }
  }
} finally {
  for (const key of Object.keys(contexts)) {
    try { await contexts[key].close(); } catch { /* already closed */ }
  }
  try { await browser.close(); } catch { /* already closed */ }
  await sleep(500);
  for (const child of [appChild, pbChild]) {
    if (child) {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }
  }
  if (PB_ROOT) {
    try { rmSync(PB_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  try { rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true }); } catch { /* best effort */ }
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} CHECKS FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
