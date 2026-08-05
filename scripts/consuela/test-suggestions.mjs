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
//   5. POST /api/consuela/suggestions/act (hardening R2 + R3): an admin tool
//      (trigger_update) is rejected with 400 "tool not allowed" and the row stays
//      pending; a valid tool that fails (complete_grocery_item, unknown item) returns
//      400 and the row stays pending; a success (add_grocery_item) flips the row to
//      "actioned" and persists the write.
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

async function createSuggestionWithPayload(token, { tool, args, title }) {
  const rec = await pbJson("/api/collections/proactive_suggestions/records", token, {
    method: "POST",
    body: JSON.stringify({
      idempotencyHash: `test-act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "custom",
      severity: "info",
      title,
      body: "Created by test-suggestions.mjs (act route hardening).",
      emoji: "🧪",
      actionLabel: "Act",
      actionPayload: { tool, args },
      status: "pending",
      scopeDate: today(),
      createdAt: new Date().toISOString(),
    }),
  });
  return rec;
}

async function fetchSuggestion(token, id) {
  return pbJson(`/api/collections/proactive_suggestions/records/${id}`, token);
}

async function deleteSuggestion(token, id) {
  await fetch(`${PB_URL}/api/collections/proactive_suggestions/records/${id}`, {
    method: "DELETE",
    headers: { authorization: token },
  });
}

// C3 — the PATCH + /act routes now require a family-member PIN; members are user
// data (not seeded), so if the dev PB has no member with a PIN, create a
// dedicated test member and return its pin + id for cleanup.
async function resolveTestMemberPin(token) {
  const data = await pbJson("/api/collections/members/records?perPage=100", token);
  const member = (data.items || []).find(
    (m) => m.pin !== undefined && m.pin !== null && String(m.pin).trim().length > 0
  );
  if (member) return { pin: String(member.pin), id: null };
  const created = await pbJson("/api/collections/members/records", token, {
    method: "POST",
    body: JSON.stringify({
      name: `test-c3-member-${Date.now()}`,
      pin: "4242",
      role: "kid",
      emoji: "🧪",
      color: "violet",
    }),
  });
  return { pin: "4242", id: created.id };
}

async function actOnSuggestion(serverPort, id, pin) {
  const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions/act`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(pin ? { "x-consuela-pin": pin } : {}),
    },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
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

  let validPin = "";
  let testMemberId = null;
  await step("setup: resolve a family member PIN from PB (C3 authorized path)", async () => {
    const resolved = await resolveTestMemberPin(adminToken);
    validPin = resolved.pin;
    testMemberId = resolved.id;
    console.log(`  (using pin ${validPin} for member auth in subsequent steps)`);
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
      headers: { "content-type": "application/json", "x-consuela-pin": validPin },
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
      headers: { "content-type": "application/json", "x-consuela-pin": validPin },
      body: JSON.stringify({ status: "dismissed" }),
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  // ---- C3: PIN required on write routes ----
  const actRows = [];
  let pinTargetId = null;
  await step("PATCH without pin returns 401 { error: pin required } (C3)", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    pinTargetId = await createPendingSuggestion(adminToken);
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: pinTargetId, status: "dismissed" }),
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(res.status, 401, `expected 401, got ${res.status}`);
    const body = await res.json().catch(() => ({}));
    assert.equal(body.error, "pin required");
    const after = await fetchSuggestion(adminToken, pinTargetId);
    assert.equal(after.status, "pending", "row must stay pending without a pin");
    await deleteSuggestion(adminToken, pinTargetId);
  });

  await step("PATCH with wrong pin returns 401 (C3)", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/consuela/suggestions`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-consuela-pin": "9999" },
      body: JSON.stringify({ id: pinTargetId || "does-not-matter", status: "dismissed" }),
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(res.status, 401, `expected 401, got ${res.status}`);
  });

  await step("act without pin returns 401 (C3)", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const rec = await createSuggestionWithPayload(adminToken, {
      tool: "add_grocery_item",
      args: { items: "should-never-be-inserted" },
      title: "hardening-test-suggestion-nopin",
    });
    actRows.push(rec.id);
    const { status, body } = await actOnSuggestion(serverPort, rec.id);
    assert.equal(status, 401, `expected 401, got ${status} (${JSON.stringify(body).slice(0, 200)})`);
    assert.equal(body.error, "pin required");
    const after = await fetchSuggestion(adminToken, rec.id);
    assert.equal(after.status, "pending", "row must stay pending without a pin");
  });

  const actGroceryName = `hardening-act ${Date.now()}`;

  await step("act route: admin tool is rejected by the allowlist (R2), row stays pending", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const rec = await createSuggestionWithPayload(adminToken, {
      tool: "trigger_update",
      args: {},
      title: "hardening-test-suggestion-admin",
    });
    actRows.push(rec.id);
    const { status, body } = await actOnSuggestion(serverPort, rec.id, validPin);
    assert.equal(status, 400, `expected 400, got ${status} (${JSON.stringify(body).slice(0, 200)})`);
    assert.equal(body.ok, false, `expected ok:false, got ${JSON.stringify(body).slice(0, 200)}`);
    assert.equal(body.error, "tool not allowed", `expected "tool not allowed", got ${body.error}`);
    const after = await fetchSuggestion(adminToken, rec.id);
    assert.equal(after.status, "pending", `row should stay pending, got ${after.status}`);
  });

  await step("act route: valid tool that errors (ok:false) returns 400, row stays pending (R3)", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const rec = await createSuggestionWithPayload(adminToken, {
      tool: "complete_grocery_item",
      args: { item: `no-such-item-${Date.now()}` },
      title: "hardening-test-suggestion-toolerror",
    });
    actRows.push(rec.id);
    const { status, body } = await actOnSuggestion(serverPort, rec.id, validPin);
    assert.equal(status, 400, `expected 400, got ${status} (${JSON.stringify(body).slice(0, 200)})`);
    assert.equal(body.ok, false, `expected ok:false, got ${JSON.stringify(body).slice(0, 200)}`);
    const after = await fetchSuggestion(adminToken, rec.id);
    assert.equal(after.status, "pending", `row should stay pending on tool error, got ${after.status}`);
  });

  await step("act route: success flips the row to actioned (R3)", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const rec = await createSuggestionWithPayload(adminToken, {
      tool: "add_grocery_item",
      args: { items: actGroceryName },
      title: "hardening-test-suggestion-ok",
    });
    actRows.push(rec.id);
    const { status, body } = await actOnSuggestion(serverPort, rec.id, validPin);
    assert.equal(status, 200, `expected 200, got ${status} (${JSON.stringify(body).slice(0, 200)})`);
    assert.equal(body.ok, true, `expected ok:true, got ${JSON.stringify(body).slice(0, 200)}`);
    assert.equal(body.tool, "add_grocery_item");
    assert.equal(body.result?.inserted, 1, `expected 1 inserted, got ${JSON.stringify(body.result)}`);
    const after = await fetchSuggestion(adminToken, rec.id);
    assert.equal(after.status, "actioned", `row should be actioned, got ${after.status}`);
    const grocery = await pbJson(
      `/api/collections/grocery_list_items/records?filter=${encodeURIComponent(`(name~"hardening-act")`)}`,
      adminToken,
    );
    assert.ok(
      (grocery.items || []).some((g) => g.name === actGroceryName),
      "grocery row from the acted suggestion should exist",
    );
  });

  await step("act route still finds past-day suggestions (C2): scopeDate=yesterday is actionable", async () => {
    if (!serverPort) throw new Error("no server to test (previous step failed)");
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const pastName = `hardening-act past-day ${Date.now()}`;
    const rec = await createSuggestionWithPayload(adminToken, {
      tool: "add_grocery_item",
      args: { items: pastName },
      title: "hardening-test-suggestion-pastday",
    });
    actRows.push(rec.id);
    await pbJson(`/api/collections/proactive_suggestions/records/${rec.id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ scopeDate: yesterday }),
    });
    const { status, body } = await actOnSuggestion(serverPort, rec.id, validPin);
    assert.equal(status, 200, `expected 200, got ${status} (${JSON.stringify(body).slice(0, 200)})`);
    const after = await fetchSuggestion(adminToken, rec.id);
    assert.equal(after.status, "actioned", "past-day suggestion should be actionable");
    const grocery = await pbJson(
      `/api/collections/grocery_list_items/records?filter=${encodeURIComponent(`(name~"hardening-act")`)}`,
      adminToken,
    );
    assert.ok(
      (grocery.items || []).some((g) => g.name === pastName),
      "grocery row from the past-day acted suggestion should exist",
    );
  });

  for (const id of actRows) {
    await deleteSuggestion(adminToken, id).catch(() => {});
  }
  const actGrocery = await pbJson(
    `/api/collections/grocery_list_items/records?filter=${encodeURIComponent(`(name~"hardening-act")`)}`,
    adminToken,
  );
  for (const g of actGrocery.items || []) {
    await fetch(`${PB_URL}/api/collections/grocery_list_items/records/${g.id}`, {
      method: "DELETE",
      headers: { authorization: adminToken },
    }).catch(() => {});
  }
  if (testMemberId) {
    await fetch(`${PB_URL}/api/collections/members/records/${testMemberId}`, {
      method: "DELETE",
      headers: { authorization: adminToken },
    }).catch(() => {});
  }

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
