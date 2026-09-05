#!/usr/bin/env node
// Live probe for the Tasks polish + stealable-tasks feature (2026-09-04).
//
// Usage:
//   node scripts/consuela/verify-tasks-polish.mjs
//
// What it verifies (guest session, seeded localStorage, 390×844 + 1280×800):
//   1. /tasks loads with 0 page errors and no horizontal overflow at both sizes.
//   2. Pets excluded from the member filter strip (9 tiles: All + 7 + Up for grabs).
//   3. A stealable task past its due date appears under "Up for grabs" with a
//      "was due" meta; an on-time stealable task does not appear there.
//   4. Fresh week (no points): leaderboard shows "The crown is up for grabs",
//      no "Champion share", no Share button.
//   5. Week with points: champion card shows "Champion share" + an aria-labeled Share button.
//   6. "Consuela suggests" buttons read "Generate" and "Sync Google Tasks".
//   7. At 1280px the content column is capped (≤ 800px effective width) and centered.
//   8. Tapping a late stealable row opens the PIN modal with the "Claim for" select.
//   9. The Add Task modal includes the "Up for grabs when late" toggle.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3444;

let BASE = `http://127.0.0.1:${PORT}`;
let child = null;
let logPath = null;

// Reuse an already-running dev server on :3000 if present (Next only permits
// one dev server per project dir); otherwise boot our own on a free port.
async function resolveServer() {
  try {
    const res = await fetch("http://127.0.0.1:3000/tasks", { signal: AbortSignal.timeout(10_000) });
    if (res.status === 200 || res.status === 307) {
      BASE = "http://127.0.0.1:3000";
      return;
    }
  } catch {
    /* no live server — boot below */
  }
  const boot = await bootDevServer(PORT);
  child = boot.child;
  logPath = boot.logPath;
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

async function bootDevServer(port) {
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logDir = mkdtempSync(path.join(os.tmpdir(), "tasks-polish-probe-"));
  const logPath = path.join(logDir, "next-dev.log");
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return { child, logPath };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const isoOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mondayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SEED = JSON.stringify({
  tasks: [
    { id: 101, title: "Sweep the kitchen floor", assignee: "Jasmine", assigneeEmoji: "👧", due: isoOffset(0), points: 10, recurring: null, category: "Chores", completed: false, priority: "medium" },
    { id: 102, title: "Fold the laundry", assignee: "Aurora", assigneeEmoji: "👧", due: isoOffset(1), points: 8, recurring: null, category: "Chores", completed: false, priority: "low" },
    { id: 103, title: "Wipe the bathroom counters", assignee: "Emily", assigneeEmoji: "👧", due: isoOffset(-1), points: 12, recurring: null, category: "Chores", completed: false, priority: "high", stealable: true },
    { id: 104, title: "Water the plants", assignee: "Jasmine", assigneeEmoji: "👧", due: isoOffset(1), points: 5, recurring: null, category: "Chores", completed: false, priority: "low", stealable: true },
    { id: 105, title: "Put the bins out", assignee: "All", assigneeEmoji: "🤝", due: isoOffset(0), points: 10, recurring: null, category: "Chores", completed: false, priority: "medium", universal: true },
    { id: 106, title: "Feed Rocco and Rico", assignee: "Bailey", assigneeEmoji: "👧", due: isoOffset(0), points: 6, recurring: null, category: "Chores", completed: false, priority: "low" },
  ],
});
const SEED_TASKS_ONLY = JSON.stringify(JSON.parse(SEED).tasks); // `consuela-tasks` stores the bare array — loadTasks/migrateDueToISO map() it directly

async function probeViewport(browser, width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  // Seed BEFORE final load so the page mounts with data
  await page.evaluate((seed) => {
    localStorage.setItem("consuela-tasks", seed);
  }, SEED_TASKS_ONLY).then(() => page.reload({ waitUntil: "networkidle" }));

  await page.waitForSelector(".member-tile", { timeout: 30_000 });
  await sleep(600);

  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}: no horizontal overflow`, overflow <= 0, `overflow=${overflow}px`);

  const tiles = await page.$$eval(".member-tile-name", (els) => els.map((e) => (e.textContent || "").trim()));
  check(`${tag}: 9 member tiles (pets excluded)`, tiles.length === 9 && !tiles.includes("Rocco") && !tiles.includes("Rico"), tiles.join(","));

  // Consuela suggests buttons
  const btnTexts = await page.$$eval("button", (bs) => bs.map((b) => (b.textContent || "").trim()));
  check(`${tag}: honest Consuela-suggests labels`, btnTexts.includes("Generate") && btnTexts.includes("Sync Google Tasks"));

  // Up for grabs
  const upTile = await page.$('button.member-tile:has-text("Up for grabs")');
  await upTile.click();
  await sleep(300);
  let text = await page.evaluate(() => document.body.innerText);
  check(`${tag}: late stealable row shows under Up for grabs`, text.includes("Wipe the bathroom counters"));
  check(`${tag}: ...with a 'was due' meta`, /was due/.test(text));
  check(`${tag}: on-time stealable stays out`, !text.includes("Water the plants"));

  // Late stealable row opens claim modal with Claim-for select
  await page.$$eval("[role='button']", (rows) => {
    const r = rows.find((x) => (x.getAttribute("aria-label") || "").includes("Wipe the bathroom counters"));
    if (r) r.click();
  });
  await sleep(500);
  const modalText = await page.evaluate(() => document.body.innerText);
  check(`${tag}: claim modal opens with Claim-for select`, /enter your pin/i.test(modalText) && /claim for/i.test(modalText));
  await page.keyboard.press("Escape");
  await sleep(400);

  // Back to All filter for a clean list
  await (await page.$('button.member-tile:has-text("All")')).click();
  await sleep(200);

  // Add Task modal → stealable toggle
  await (await page.$('button[aria-label="Add task"]')).click();
  await sleep(500);
  const addText = await page.evaluate(() => document.body.innerText);
  check(`${tag}: Add Task offers 'Up for grabs when late'`, /up for grabs when late/i.test(addText));
  await page.keyboard.press("Escape");
  await sleep(400);

  // Fresh week (DEFAULT localStorage has no consuela-week-data → all-zero points)
  await page.getByRole("radio", { name: "Leaderboard" }).click();
  await sleep(600);
  const lbText = await page.evaluate(() => document.body.innerText);
  check(`${tag}: fresh-week crown card`, lbText.includes("The crown is up for grabs") && lbText.includes("Everyone starts at zero"));
  check(`${tag}: no fake 0% champion`, !lbText.includes("Champion share"));
  const shareZero = await page.$("[aria-label^='Share']");
  check(`${tag}: no Share button on zero week`, shareZero === null);

  // Back to tasks tab
  await page.getByRole("radio", { name: "Tasks" }).click();
  await sleep(500);

  if (width >= 1000) {
    const wrapper = await page.$eval("main > div.mx-auto", (el) => el.getBoundingClientRect());
    check(`${tag}: desktop column ≤ 800px and centered`, wrapper.width <= 800 && wrapper.left > 100, `w=${Math.round(wrapper.width)} left=${Math.round(wrapper.left)}`);
  }

  await page.close();
}

async function probeWithPoints(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.evaluate((week) => {
    localStorage.setItem("consuela-week-data", week);
  }, JSON.stringify({ weekStart: mondayISO(), points: { "Rebecca (Mom)": 15, Emily: 12 }, history: [], streak: {}, lastActive: {} }));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".member-tile", { timeout: 30_000 });
  await page.getByRole("radio", { name: "Leaderboard" }).click();
  await sleep(700);

  const text = await page.evaluate(() => document.body.innerText);
  const lower = text.toLowerCase();
  check("points week: champion card renders", lower.includes("this week's champion") && text.includes("Champion share"));
  const share = await page.$("[aria-label^='Share']");
  check("points week: Share button present + aria-labeled", !!share && /Share Rebecca/.test(await share.getAttribute("aria-label")));
  check("points week: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

await resolveServer();
try {
  const browser = await chromium.launch({ headless: true });
  await probeViewport(browser, 390, 844, "phone 390");
  await probeViewport(browser, 1280, 800, "desktop 1280");
  await probeWithPoints(browser);
  await browser.close();
} catch (e) {
  check("probe run completed", false, `${e?.message || e}`);
  try { console.log(readFileSync(logPath, "utf8").split("\n").slice(-25).join("\n")); } catch { /* no log */ }
} finally {
  child?.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} CHECKS FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
