#!/usr/bin/env node
// Integration smoke test for Task 4.2 (morning briefing generator + cron + public routes).
//
// Usage:
//   set -a; source .env.integration; set +a
//   node scripts/consuela/test-briefing-cron.mjs
//
// What it verifies:
//   1. POST /api/cron/consuela/briefing returns 401 with a wrong secret.
//   2. With the right secret it runs generateBriefing (engine first, then events /
//      pending tasks / week meals / pending suggestions) and returns 200
//      { ok:true, summary } whose arrays contain the seeded test data.
//   3. A morning_briefing row for today exists in PB after the cron run.
//   4. GET /api/consuela/briefing returns { ok:true, briefing } (latest, and via ?scopeDate=).
//   5. PATCH /api/consuela/briefing { id } acks the briefing (acknowledged=true).
//
// Manual curl equivalents:
//   curl -s -X POST -H "Authorization: Bearer wrong-secret" \
//     http://localhost:3000/api/cron/consuela/briefing            # -> 401
//   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     http://localhost:3000/api/cron/consuela/briefing            # -> 200 {ok:true,summary}
//   curl -s http://localhost:3000/api/consuela/briefing           # -> {ok:true,briefing}
//   curl -s -X PATCH -H "Content-Type: application/json" -d '{"id":"<id>"}' \
//     http://localhost:3000/api/consuela/briefing                 # -> {ok:true}
//
// The script reuses an already-running dev server on :3000/:3100/:3200/:3400 if the
// cron route answers 401 to a wrong-secret probe (proves the integration env is
// loaded); otherwise it boots its own `npm run dev -p <free port>` and kills it.
// All seeded rows (event/task/meal/pantry + generated suggestions + briefing row)
// are cleaned up via the admin REST API afterwards.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
const CRON_SECRET = process.env.CRON_SECRET || "dev-cron-secret-2026";
const TSCLI = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const CANDIDATE_PORTS = [3000, 3100, 3200, 3400];

const TEST_PREFIX = `TestBriefing2026`;
const TEST_EVENT_TITLE = `${TEST_PREFIX} Soccer`;
const TEST_TASK_TITLE = `${TEST_PREFIX} Chore`;
const TEST_MEAL_NAME = `${TEST_PREFIX} Taco Night`;
const TEST_PANTRY_ITEM = `${TEST_PREFIX}OatMilk`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().split("T")[0];

function weekStartFor(todayStr) {
  const d = new Date(todayStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().split("T")[0];
}

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

async function isListening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
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

async function createRow(collection, body, token) {
  const rec = await pbJson(`/api/collections/${collection}/records`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return rec.id;
}

async function deleteRow(collection, id, token) {
  try {
    await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
      method: "DELETE",
      headers: { authorization: token },
    });
  } catch { /* ok if cleanup fails */ }
}

async function findBriefingByScopeDate(scopeDate, token) {
  const filter = encodeURIComponent(`scopeDate="${scopeDate}"`);
  const data = await pbJson(`/api/collections/morning_briefing/records?filter=${filter}&perPage=1`, token);
  return data.items && data.items.length > 0 ? data.items[0] : null;
}

async function deleteSuggestionsMatchingTitle(title, token) {
  const filter = encodeURIComponent(`title~"${title}"`);
  const data = await pbJson(`/api/collections/proactive_suggestions/records?filter=${filter}&perPage=100`, token);
  for (const r of data.items || []) {
    await fetch(`${PB_URL}/api/collections/proactive_suggestions/records/${r.id}`, {
      method: "DELETE",
      headers: { authorization: token },
    });
  }
}

async function probeWrongSecret(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/consuela/briefing`, {
        method: "POST",
        headers: { authorization: `Bearer wrong-secret-${Date.now()}` },
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body, ok: true };
    } catch (e) {
      lastErr = e;
      await sleep(2000);
    }
  }
  return { status: 0, body: {}, ok: false, lastErr: String(lastErr) };
}

async function bootDevServer(port) {
  const logDir = mkdtempSync(path.join(os.tmpdir(), "consuela-briefing-test-"));
  const logPath = path.join(logDir, "next-dev.log");
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_PB_URL: PB_URL,
      PB_ADMIN_EMAIL: ADMIN_EMAIL,
      PB_ADMIN_PASS: ADMIN_PASS,
      CRON_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return { child, logPath };
}

function serverLogTail(logPath) {
  try {
    const lines = readFileSync(logPath, "utf8").split("\n").slice(-40);
    return lines.join("\n");
  } catch {
    return "(no log)";
  }
}

async function main() {
  const weekStart = weekStartFor(today());
  console.log(`PB: ${PB_URL} | today: ${today()} | week: ${weekStart} | cron secret: ${CRON_SECRET}`);

  let adminToken;
  await step("setup: PB admin auth works (dev PB reachable)", async () => {
    adminToken = await pbAdminToken();
  });

  let seedOutput = "";
  await step("setup: run pb-seed.mjs (idempotent) so morning_briefing exists", async () => {
    seedOutput = runSeed();
    assert.ok(seedOutput.includes("morning_briefing"), `seed output missing morning_briefing`);
  });

  const preExistingBriefing = await findBriefingByScopeDate(today(), adminToken);
  if (preExistingBriefing) {
    console.log(`  note: a briefing for ${today()} already existed (id ${preExistingBriefing.id}); will leave it`);
  }

  const seeded = { event: null, task: null, meal: null, pantry: null };
  await step("seed test event/task/meal/pantry data", async () => {
    seeded.event = await createRow(
      "events",
      { title: TEST_EVENT_TITLE, date: today(), time: "16:00", icon: "⚽", color: "mint", member: "Caspian" },
      adminToken
    );
    seeded.task = await createRow(
      "tasks",
      { taskId: 999901, title: TEST_TASK_TITLE, assignee: "Caspian", due: today(), points: 5, status: "pending", priority: "low", category: "chore", createdAt: new Date().toISOString() },
      adminToken
    );
    seeded.meal = await createRow(
      "meal_plan_entries",
      { name: TEST_MEAL_NAME, emoji: "🌮", weekOf: weekStart, date: today(), mealType: "dinner", time: "18:00", servings: 4 },
      adminToken
    );
    seeded.pantry = await createRow(
      "pantry_items",
      { item: TEST_PANTRY_ITEM, status: "out", category: "dairy", quantity: 0, unit: "cartons" },
      adminToken
    );
    console.log(`  seeded event=${seeded.event} task=${seeded.task} meal=${seeded.meal} pantry=${seeded.pantry}`);
  });

  let booted = null;
  let serverPort = 0;
  let briefingId = null;

  await step("POST cron route: 401 with wrong secret; 200 ok:true + summary with right secret", async () => {
    for (const p of CANDIDATE_PORTS) {
      if (!(await isListening(p))) continue;
      const probe = await probeWrongSecret(p, 120_000);
      if (!probe.ok) continue;
      if (probe.status !== 401) {
        console.warn(`  note: server on :${p} answered ${probe.status} to the cron route probe`);
        continue;
      }
      const rightProbe = await fetch(`http://127.0.0.1:${p}/api/cron/consuela/briefing`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (rightProbe.status !== 200) {
        console.warn(
          `  note: server on :${p} lacks the integration env (right secret got ${rightProbe.status}); skipping`,
        );
        continue;
      }
      serverPort = p;
      console.log(`  (reusing dev server on :${p})`);
      break;
    }
    if (!serverPort) {
      const anyListening = (await Promise.all(CANDIDATE_PORTS.map(isListening))).some(Boolean);
      if (anyListening) {
        console.warn(
          "  note: running servers lack the integration env; booting our own with .env.integration vars",
        );
      }
      serverPort = (await Promise.all(CANDIDATE_PORTS.map(async (p) => ((await isListening(p)) ? null : p)))).find(Boolean);
      if (!serverPort) throw new Error("no free port for a dev server");
      booted = await bootDevServer(serverPort);
      console.log(`  (booted dev server on :${serverPort})`);
    }

    try {
      const wrong = await probeWrongSecret(serverPort, 300_000);
      assert.equal(wrong.status, 401, `wrong secret: expected 401, got ${wrong.status}`);
      assert.equal(wrong.body.error, "unauthorized");

      const right = await fetch(`http://127.0.0.1:${serverPort}/api/cron/consuela/briefing`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(240_000),
      });
      const body = await right.json().catch(() => ({}));
      assert.equal(right.status, 200, `right secret: expected 200, got ${right.status} (${JSON.stringify(body).slice(0, 200)})`);
      assert.equal(body.ok, true, `expected ok:true, got ${JSON.stringify(body).slice(0, 200)}`);
      assert.ok(body.summary, "expected a summary object");
      assert.ok(Array.isArray(body.summary.events), "summary.events should be an array");
      assert.ok(Array.isArray(body.summary.tasks), "summary.tasks should be an array");
      assert.ok(Array.isArray(body.summary.meals), "summary.meals should be an array");
      assert.ok(Array.isArray(body.summary.suggestions), "summary.suggestions should be an array");
      assert.ok(typeof body.summary.generatedAt === "string", "summary.generatedAt should be an ISO string");
      assert.ok(body.summary.events.some((e) => e.title === TEST_EVENT_TITLE), "summary.events should include the seeded event");
      assert.ok(
        body.summary.tasks.some((t) => t.title === TEST_TASK_TITLE && t.status !== "done"),
        "summary.tasks should include the seeded pending task",
      );
      assert.ok(body.summary.meals.some((m) => m.name === TEST_MEAL_NAME), "summary.meals should include the seeded meal");
      assert.ok(
        body.summary.suggestions.some((s) => s.title && s.title.includes(TEST_PANTRY_ITEM)),
        `summary.suggestions should include the pantry_low suggestion for ${TEST_PANTRY_ITEM}`,
      );
      console.log(`  summary: ${body.summary.events.length} events, ${body.summary.tasks.length} tasks, ${body.summary.meals.length} meals, ${body.summary.suggestions.length} suggestions`);
    } catch (e) {
      if (booted) {
        throw new Error(`${e.message}\n--- dev server log tail ---\n${serverLogTail(booted.logPath)}`);
      }
      throw e;
    }
  });

  await step("morning_briefing row for today exists in PB with the summary", async () => {
    const rec = await findBriefingByScopeDate(today(), adminToken);
    assert.ok(rec, `expected a morning_briefing row for ${today()}`);
    briefingId = rec.id;
    assert.equal(rec.scopeDate, today());
    assert.equal(rec.acknowledged, false);
    assert.ok(rec.summary && Array.isArray(rec.summary.events), "row summary should have an events array");
    assert.ok(rec.summary.events.some((e) => e.title === TEST_EVENT_TITLE), "row summary should include the seeded event");
    console.log(`  briefing row: ${rec.id}`);
  });

  await step("GET /api/consuela/briefing returns latest briefing", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/briefing`, {
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    assert.equal(body.ok, true, `expected ok:true, got ${JSON.stringify(body).slice(0, 200)}`);
    assert.ok(body.briefing, `expected briefing, got ${JSON.stringify(body).slice(0, 200)}`);
    assert.equal(body.briefing.scopeDate, today(), "latest briefing should be today");
  });

  await step("GET /api/consuela/briefing?scopeDate=<today> returns that day", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/briefing?scopeDate=${today()}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    assert.ok(body.briefing, "expected a briefing");
    assert.equal(body.briefing.scopeDate, today());
    assert.equal(body.briefing.id, briefingId, "should be the row created by the cron run");
  });

  await step("PATCH { id } acks the briefing and GET reflects acknowledged=true", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const patch = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/briefing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: briefingId }),
      signal: AbortSignal.timeout(60_000),
    });
    const patchBody = await patch.json().catch(() => ({}));
    assert.equal(patch.status, 200, `expected 200, got ${patch.status} (${JSON.stringify(patchBody).slice(0, 200)})`);
    assert.equal(patchBody.ok, true, `expected ok:true, got ${JSON.stringify(patchBody).slice(0, 200)}`);

    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/briefing?scopeDate=${today()}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(body.briefing.acknowledged, true, "acknowledged should be true after PATCH");
  });

  await step("PATCH without id returns 400", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/briefing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  await step("cleanup: delete seeded rows + test suggestions" + (preExistingBriefing ? " (keeping pre-existing briefing)" : " + today's briefing"), async () => {
    await deleteRow("events", seeded.event, adminToken);
    await deleteRow("tasks", seeded.task, adminToken);
    await deleteRow("meal_plan_entries", seeded.meal, adminToken);
    await deleteRow("pantry_items", seeded.pantry, adminToken);
    await deleteSuggestionsMatchingTitle(TEST_PANTRY_ITEM, adminToken);
    if (!preExistingBriefing && briefingId) {
      await deleteRow("morning_briefing", briefingId, adminToken);
    }
  });

  if (booted) {
    booted.child.kill("SIGTERM");
    await sleep(5000);
    if (booted.child.exitCode === null) booted.child.kill("SIGKILL");
    rmSync(path.dirname(booted.logPath), { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} step(s) FAILED` : "\nAll steps passed");
  if (booted && booted.child.exitCode === null) {
    console.error("note: booted dev server may still be shutting down");
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
