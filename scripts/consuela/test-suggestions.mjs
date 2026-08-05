#!/usr/bin/env node
// Integration smoke test for Task 1.4 (suggestions cron + public read/update routes).
//
// Usage:
//   set -a; source .env.integration; set +a
//   node scripts/consuela/test-suggestions.mjs
//
// What it verifies (C5):
//   1. POST /api/cron/consuela/suggestions returns 401 with a wrong secret.
//   2. The same route returns 200 { ok:true, scanned, inserted, rejected } with the
//      right secret (runs the suggestion engine — seeds data if needed).
//   3. GET /api/consuela/suggestions returns { items: [...] } (pending list, limit 20).
//   4. PATCH /api/consuela/suggestions flips a row to "dismissed" and GET no longer
//      returns that row.
//
// Manual curl equivalents:
//   curl -s -X POST -H "Authorization: Bearer wrong-secret" \
//     http://localhost:3000/api/cron/consuela/suggestions          # -> 401
//   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     http://localhost:3000/api/cron/consuela/suggestions          # -> 200 {ok:true,...}
//   curl -s http://localhost:3000/api/consuela/suggestions         # -> {items:[...]}
//   curl -s -X PATCH -H "Content-Type: application/json" \
//     -d '{"id":"<id>","status":"dismissed"}' \
//     http://localhost:3000/api/consuela/suggestions               # -> {ok:true}
//
// The script reuses an already-running dev server on :3000/:3100/:3200/:3400 if the
// cron route answers 401 to a wrong-secret probe (proves the integration env is
// loaded); otherwise it boots its own `npm run dev -p <free port>` and kills it.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
const CANDIDATE_PORTS = [3000, 3100, 3200, 3400];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().split("T")[0];

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
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}), ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PB ${path_} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function createPendingSuggestion(token) {
  const body = {
    idempotencyHash: `test-suggestions-${Date.now()}`,
    kind: "custom",
    severity: "info",
    title: "Test suggestion from test-suggestions.mjs",
    body: "Created by the integration test so PATCH verification is deterministic.",
    emoji: "🧪",
    status: "pending",
    scopeDate: today(),
    createdAt: new Date().toISOString(),
  };
  const rec = await pbJson("/api/collections/proactive_suggestions/records", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return rec.id;
}

async function probeWrongSecret(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/consuela/suggestions`, {
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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "consuela-suggestions-test-"));
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
  console.log(`PB: ${PB_URL} | today: ${today()} | cron secret: ${CRON_SECRET}`);

  let adminToken;
  await step("setup: PB admin auth works (dev PB reachable)", async () => {
    adminToken = await pbAdminToken();
  });

  let booted = null;
  let serverPort = 0;
  let pendingId = null;

  await step("POST cron route: 401 with wrong secret; 200 ok:true with right secret", async () => {
    for (const p of CANDIDATE_PORTS) {
      if (!(await isListening(p))) continue;
      const probe = await probeWrongSecret(p, 120_000);
      if (!probe.ok) continue;
      if (probe.status !== 401) {
        console.warn(`  note: server on :${p} answered ${probe.status} to the cron route probe`);
        continue;
      }
      const rightProbe = await fetch(`http://127.0.0.1:${p}/api/cron/consuela/suggestions`, {
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

      const right = await fetch(`http://127.0.0.1:${serverPort}/api/cron/consuela/suggestions`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(240_000),
      });
      const body = await right.json().catch(() => ({}));
      assert.equal(right.status, 200, `right secret: expected 200, got ${right.status} (${JSON.stringify(body).slice(0, 200)})`);
      assert.equal(body.ok, true, `expected ok:true, got ${JSON.stringify(body).slice(0, 200)}`);
      assert.equal(typeof body.scanned, "number", "scanned should be a number");
      assert.equal(typeof body.inserted, "number", "inserted should be a number");
      assert.equal(typeof body.rejected, "number", "rejected should be a number");
    } catch (e) {
      if (booted) {
        throw new Error(`${e.message}\n--- dev server log tail ---\n${serverLogTail(booted.logPath)}`);
      }
      throw e;
    }
  });

  await step("GET /api/consuela/suggestions returns { items: [...] }", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    assert.ok(Array.isArray(body.items), `expected items array, got ${JSON.stringify(body).slice(0, 200)}`);
    for (const item of body.items) {
      assert.equal(item.status, "pending", `list should only contain pending rows (got ${item.status})`);
      assert.ok(item.id, "each item should have an id");
    }
  });

  await step("PATCH flips status and GET no longer returns the row", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");

    let targetId;
    const listRes = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      signal: AbortSignal.timeout(60_000),
    });
    const listBody = await listRes.json().catch(() => ({}));
    if (Array.isArray(listBody.items) && listBody.items.length > 0) {
      targetId = listBody.items[0].id;
      console.log(`  (patching engine-produced row ${targetId})`);
    } else {
      targetId = await createPendingSuggestion(adminToken);
      console.log(`  (no pending rows after engine run; seeded test row ${targetId})`);
    }

    const patch = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: targetId, status: "dismissed" }),
      signal: AbortSignal.timeout(60_000),
    });
    const patchBody = await patch.json().catch(() => ({}));
    assert.equal(patch.status, 200, `expected 200, got ${patch.status} (${JSON.stringify(patchBody).slice(0, 200)})`);
    assert.equal(patchBody.ok, true, `expected ok:true, got ${JSON.stringify(patchBody).slice(0, 200)}`);

    const afterRes = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      signal: AbortSignal.timeout(60_000),
    });
    const afterBody = await afterRes.json().catch(() => ({}));
    assert.ok(Array.isArray(afterBody.items), "items should still be an array");
    assert.ok(
      !afterBody.items.some((i) => i.id === targetId),
      `dismissed row ${targetId} should no longer appear in the pending list`,
    );
  });

  await step("PATCH without id+status returns 400", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
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
