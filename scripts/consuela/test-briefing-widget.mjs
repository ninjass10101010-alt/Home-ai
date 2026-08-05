#!/usr/bin/env node
// Playwright smoke test for Task 4.3 (morning briefing Home widget).
//
// Usage:
//   set -a; source .env.integration; set +a
//   node scripts/consuela/test-briefing-widget.mjs
//
// What it verifies (C6):
//   1. Seeds an event/task/meal/pantry row so the briefing has all four sections,
//      then runs the cron route to generate today's briefing row.
//   2. Playwright (real Chromium, 390x844) opens / and asserts:
//      - the "Morning Briefing" card renders at the TOP of the Home widget stack
//        (its y < the "Today" card's y) with a "4 items" count badge,
//      - tapping the badge expands the card and shows all four sections with the
//        seeded rows (events / priority tasks / meals / Consuela's noticed),
//      - "Got it ✓" collapses the card, shows "Acknowledged ✓", and fades it,
//      - Settings -> Layout & display lists "Morning Briefing"; hiding it removes
//        the card from Home.
//   3. Cleans up all seeded rows (event/task/meal/pantry + suggestions + briefing
//      row if it did not pre-exist) via the admin REST API.
//
// Reuses a running dev server on :3000/:3100/:3200/:3400 if the cron route answers
// 401 to a wrong-secret probe; otherwise boots its own `npm run dev -p <free port>`.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PB_URL = process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8091";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASS = process.env.PB_ADMIN_PASS;
const CRON_SECRET = process.env.CRON_SECRET || "dev-cron-secret-2026";
const TSCLI = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const CANDIDATE_PORTS = [3000, 3100, 3200, 3400];

const TEST_PREFIX = `TestBriefingWidget2026`;
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
  if (!id) return;
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
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/consuela/briefing`, {
        method: "POST",
        headers: { authorization: `Bearer wrong-secret-${Date.now()}` },
        signal: AbortSignal.timeout(60_000),
      });
      return { status: res.status, ok: true };
    } catch {
      await sleep(2000);
    }
  }
  return { status: 0, ok: false };
}

async function bootDevServer(port) {
  // Clear the dev cache so no stale NEXT_PUBLIC_PB_URL-inlined modules survive a
  // previous dev server that ran against a different env (see Task 1.5 report).
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logDir = mkdtempSync(path.join(os.tmpdir(), "consuela-briefing-widget-test-"));
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
    return readFileSync(logPath, "utf8").split("\n").slice(-40).join("\n");
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

  await step("setup: run pb-seed.mjs (idempotent) so morning_briefing exists", async () => {
    const out = runSeed();
    assert.ok(out.includes("morning_briefing"), "seed output missing morning_briefing");
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
      adminToken,
    );
    seeded.task = await createRow(
      "tasks",
      { taskId: 999902, title: TEST_TASK_TITLE, assignee: "Caspian", due: today(), points: 12, status: "pending", priority: "medium", category: "chore", createdAt: new Date().toISOString() },
      adminToken,
    );
    seeded.meal = await createRow(
      "meal_plan_entries",
      { name: TEST_MEAL_NAME, emoji: "🌮", weekOf: weekStart, date: today(), mealType: "dinner", time: "18:00", servings: 4 },
      adminToken,
    );
    seeded.pantry = await createRow(
      "pantry_items",
      { item: TEST_PANTRY_ITEM, status: "out", category: "dairy", quantity: 0, unit: "cartons" },
      adminToken,
    );
    console.log(`  seeded event=${seeded.event} task=${seeded.task} meal=${seeded.meal} pantry=${seeded.pantry}`);
  });

  let booted = null;
  let serverPort = 0;
  let briefingId = null;
  let expectedCount = 0;

  await step("boot/reuse dev server with integration env, run cron route", async () => {
    for (const p of CANDIDATE_PORTS) {
      if (!(await isListening(p))) continue;
      const probe = await probeWrongSecret(p, 120_000);
      if (!probe.ok || probe.status !== 401) continue;
      const rightProbe = await fetch(`http://127.0.0.1:${p}/api/cron/consuela/briefing`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (rightProbe.status !== 200) continue;
      serverPort = p;
      console.log(`  (reusing dev server on :${p})`);
      break;
    }
    if (!serverPort) {
      serverPort = (await Promise.all(CANDIDATE_PORTS.map(async (p) => ((await isListening(p)) ? null : p)))).find(Boolean);
      if (!serverPort) throw new Error("no free port for a dev server");
      booted = await bootDevServer(serverPort);
      console.log(`  (booted dev server on :${serverPort})`);
    }

    try {
      let right = null;
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        try {
          const candidate = await fetch(`http://127.0.0.1:${serverPort}/api/cron/consuela/briefing`, {
            method: "POST",
            headers: { authorization: `Bearer ${CRON_SECRET}` },
            signal: AbortSignal.timeout(120_000),
          });
          if (candidate.status === 200) {
            right = candidate;
            break;
          }
          if (candidate.status !== 503) break;
        } catch {
          // server still compiling the route - retry
        }
        await sleep(3000);
      }
      assert.ok(right, "cron route never returned 200");
      const body = await right.json().catch(() => ({}));
      assert.equal(right.status, 200, `expected 200, got ${right.status}`);
      assert.equal(body.ok, true);
      assert.ok(body.summary, "expected a summary object");
      assert.ok(body.summary.events.some((e) => e.title === TEST_EVENT_TITLE), "summary.events should include the seeded event");
      assert.ok(body.summary.tasks.some((t) => t.title === TEST_TASK_TITLE), "summary.tasks should include the seeded task");
      assert.ok(body.summary.meals.some((m) => m.name === TEST_MEAL_NAME), "summary.meals should include the seeded meal");
      assert.ok(body.summary.suggestions.some((s) => String(s.title || "").includes(TEST_PANTRY_ITEM)), "summary.suggestions should include the pantry_low row");
      console.log(`  summary: ${body.summary.events.length} events, ${body.summary.tasks.length} tasks, ${body.summary.meals.length} meals, ${body.summary.suggestions.length} suggestions`);
      expectedCount = body.summary.events.length + body.summary.tasks.length + body.summary.meals.length + body.summary.suggestions.length;
      const rec = await findBriefingByScopeDate(today(), adminToken);
      assert.ok(rec, "expected a morning_briefing row for today after the cron run");
      briefingId = rec.id;
    } catch (e) {
      if (booted) throw new Error(`${e.message}\n--- dev server log tail ---\n${serverLogTail(booted.logPath)}`);
      throw e;
    }
  });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const base = `http://127.0.0.1:${serverPort}`;

    await step("Home renders the Morning Briefing card at the top with a count badge", async () => {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      const heading = page.getByRole("heading", { name: "Morning Briefing" });
      await heading.waitFor({ state: "visible", timeout: 90_000 });
      const badge = page.getByRole("button", { name: "Expand morning briefing" });
      assert.ok(await badge.isVisible(), "expected the count badge button (Expand morning briefing)");
      const badgeText = (await badge.textContent()) || "";
      assert.ok(new RegExp(`^${expectedCount} item`).test(badgeText.trim()), `expected '${expectedCount} items' in badge, got '${badgeText.trim()}'`);
      await page.getByText("Tap the badge above to see today’s plan.").waitFor({ state: "visible", timeout: 10_000 });

      const briefingBox = await heading.boundingBox();
      const todayCard = page.getByRole("heading", { name: "Today" });
      await todayCard.waitFor({ state: "visible", timeout: 30_000 });
      const todayBox = await todayCard.boundingBox();
      assert.ok(briefingBox && todayBox && briefingBox.y < todayBox.y, "briefing card should sit above the Today card (top of Home)");
    });

    await step("tap to expand: all four sections + seeded rows render", async () => {
      await page.getByRole("button", { name: "Expand morning briefing" }).click();
      for (const label of ["Today's events", "Priority tasks", "Meals", "Consuela's noticed"]) {
        await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
      }
      await page.getByText(TEST_EVENT_TITLE, { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
      await page.getByText(TEST_TASK_TITLE, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
      await page.getByText(TEST_MEAL_NAME, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
      await page.getByText(TEST_PANTRY_ITEM, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
    });

    await step('"Got it ✓" collapses the card, shows Acknowledged ✓, and fades it', async () => {
      await page.getByRole("button", { name: /Got it/ }).click();
      await page.getByText("Acknowledged ✓", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      const sections = await page.getByText("Priority tasks", { exact: true }).count();
      assert.equal(sections, 0, "card should be collapsed after ack (no section labels)");
      const heading = page.getByRole("heading", { name: "Morning Briefing" });
      const opacity = await heading.evaluate((el) => {
        let node = el;
        for (let i = 0; i < 4; i++) node = node.parentElement;
        return getComputedStyle(node).opacity;
      });
      assert.ok(Number(opacity) < 1, `expected the card to be faded, got opacity ${opacity}`);
      const pendingBriefing = await findBriefingByScopeDate(today(), adminToken);
      assert.equal(pendingBriefing?.acknowledged, true, "briefing row should be acknowledged in PB");
    });

    await step("Settings -> Layout & display lists Morning Briefing; hiding removes it from Home", async () => {
      await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
      const row = page.locator('[draggable="true"]', { hasText: "Morning Briefing" });
      await row.first().waitFor({ state: "visible", timeout: 60_000 });
      const visibleCount = await page.locator('[draggable="true"]', { hasText: "Morning Briefing" }).count();
      assert.ok(visibleCount >= 1, "Layout & display should list Morning Briefing as a visible widget");
      await row.first().locator('label:has(input[type="checkbox"])').click();
      await page.getByText(/Hidden · 1/).waitFor({ state: "visible", timeout: 15_000 });

      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      const count = await page.getByRole("heading", { name: "Morning Briefing" }).count();
      assert.equal(count, 0, "briefing card should be gone from Home after hiding it in Layout");
    });
  } finally {
    await browser.close();
  }

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
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(2);
});
