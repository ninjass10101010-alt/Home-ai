#!/usr/bin/env node
// Integration smoke test for Stream #5 (Google Calendar auto-sync cron).
//
// Usage:
//   set -a; source .env.integration; set +a
//   node scripts/consuela/test-google-sync.mjs
//
// What it verifies:
//   1. checkQuota() reads today's consuela_google_api_usage row (count=10) from PB
//      and reports { ok:true, used:10, cap:48000 } (and ok:false when used >= cap).
//   2. POST /api/cron/consuela/google-sync returns 401 with a wrong secret.
//   3. The same route returns 409 { code: "no_grant" } with the right secret when
//      Google is not connected (expected locally - no Google grant on this Mac).
//
// Manual curl equivalent (if you prefer not to boot a dev server):
//   curl -s -X POST -H "Authorization: Bearer wrong-secret" \
//     http://localhost:3000/api/cron/consuela/google-sync        # -> 401
//   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     http://localhost:3000/api/cron/consuela/google-sync        # -> 409 no_grant
//
// The script reuses an already-running dev server on :3000/:3100/:3200 if the
// route answers 401 to a wrong-secret probe; otherwise it boots its own
// `npm run dev -p <free port>` and kills it afterwards.

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

async function upsertUsageRow(token, count) {
  const filter = encodeURIComponent(`date="${today()}"`);
  const list = await pbJson(`/api/collections/consuela_google_api_usage/records?perPage=1&filter=${filter}`, token);
  const payload = { date: today(), count, last_endpoint: "test-google-sync", last_reset_at: new Date().toISOString() };
  if (list.items.length) {
    await pbJson(`/api/collections/consuela_google_api_usage/records/${list.items[0].id}`, token, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    await pbJson("/api/collections/consuela_google_api_usage/records", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

function runCheckQuota() {
  const code = [
    `import { checkQuota } from "./src/lib/google/quota-guard.ts";`,
    `checkQuota().then(r => process.stdout.write(JSON.stringify(r)))`,
    `.catch(e => { console.error(e); process.exit(1); });`,
  ].join("");
  const out = execFileSync(TSCLI, ["-e", code], {
    cwd: REPO_ROOT,
    env: { ...process.env, NEXT_PUBLIC_PB_URL: PB_URL, PB_ADMIN_EMAIL: ADMIN_EMAIL, PB_ADMIN_PASS: ADMIN_PASS },
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.trim());
}

function runEnsureCollections() {
  const code = [
    `import { ensureGoogleCollections } from "./src/lib/google/pb-collections.ts";`,
    `ensureGoogleCollections().then(r => process.stdout.write(JSON.stringify(r)))`,
    `.catch(e => { console.error(e); process.exit(1); });`,
  ].join("");
  execFileSync(TSCLI, ["-e", code], {
    cwd: REPO_ROOT,
    env: { ...process.env, NEXT_PUBLIC_PB_URL: PB_URL, PB_ADMIN_EMAIL: ADMIN_EMAIL, PB_ADMIN_PASS: ADMIN_PASS },
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function probeWrongSecret(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/consuela/google-sync`, {
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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "consuela-cron-test-"));
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
  await step("setup: ensureGoogleCollections() creates consuela_google_api_usage on PB", async () => {
    adminToken = await pbAdminToken();
    runEnsureCollections();
  });

  await step("insert consuela_google_api_usage row for today (count=10)", async () => {
    await upsertUsageRow(adminToken, 10);
    console.log(`  (usage row for ${today()} set to count=10)`);
  });

  await step("checkQuota() reports used=10, cap=48000, ok=true", async () => {
    const q = runCheckQuota();
    assert.deepEqual(q, { ok: true, used: 10, cap: 48000 });
  });

  await step("checkQuota() reports ok=false when used >= cap (count=49000)", async () => {
    await upsertUsageRow(adminToken, 49000);
    const q = runCheckQuota();
    assert.deepEqual(q, { ok: false, used: 49000, cap: 48000 });
    await upsertUsageRow(adminToken, 10);
  });

  let booted = null;
  let serverPort = 0;
  await step("POST cron route: 401 with wrong secret, 409 no_grant with right secret", async () => {
    for (const p of CANDIDATE_PORTS) {
      if (!(await isListening(p))) continue;
      const probe = await probeWrongSecret(p, 120_000);
      if (!probe.ok) continue;
      if (probe.status !== 401) {
        console.warn(`  note: server on :${p} answered ${probe.status} to the cron route probe`);
        continue;
      }
      const rightProbe = await fetch(`http://127.0.0.1:${p}/api/cron/consuela/google-sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (rightProbe.status !== 409) {
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

      const right = await fetch(`http://127.0.0.1:${serverPort}/api/cron/consuela/google-sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(240_000),
      });
      const body = await right.json().catch(() => ({}));
      assert.equal(right.status, 409, `right secret: expected 409, got ${right.status} (${JSON.stringify(body).slice(0, 200)})`);
      assert.equal(body.ok, false);
      assert.equal(body.code, "no_grant");
      assert.equal(body.error, "Google account is not connected");
    } catch (e) {
      if (booted) {
        throw new Error(`${e.message}\n--- dev server log tail ---\n${serverLogTail(booted.logPath)}`);
      }
      throw e;
    } finally {
      if (booted) {
        booted.child.kill("SIGTERM");
        await sleep(5000);
        if (booted.child.exitCode === null) booted.child.kill("SIGKILL");
        rmSync(path.dirname(booted.logPath), { recursive: true, force: true });
      }
    }
  });

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
