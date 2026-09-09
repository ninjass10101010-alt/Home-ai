#!/usr/bin/env node
// Live probe for the ApoloSign wall display profile (2026-09-09, Task 10).
//
// Usage:
//   node scripts/consuela/verify-wall-mode.mjs
//
// What it verifies (guest session — no sign-in, so the member rail renders
// in its signed-out state):
//   1. Wall run — 1080×1920 portrait, isMobile+hasTouch, /?wall=1:
//      <html data-wall="true">, the Home grid carries grid-cols-2 +
//      auto-rows-[440px], no horizontal overflow, the wall member rail
//      renders with ≥1 tile, capsule nav items are ≥64px tall, tapping a
//      rail tile opens the WallPinPad dialog ("Sign in as …") with ≥64px
//      keys, and the weather hero temp renders ≥90px on the wall.
//   2. Control run — same viewport WITHOUT ?wall=1 (manual "off" seeded, so
//      auto-detect cannot fire on this wall-shaped canvas): data-wall unset,
//      no wall grid pair.
//   3. Phone control — 390×844 without the param: data-wall unset.

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

// Reuse the shared dev server on :3000 if present (it is NOT restarted);
// otherwise boot our own on a free port (Next only permits one dev server
// per project dir, so a live :3000 means that one is the server).
async function resolveServer() {
  try {
    const res = await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(10_000) });
    if (res.status === 200 || res.status === 307) {
      BASE = "http://127.0.0.1:3000";
      console.log(`using shared dev server at ${BASE}`);
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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "wall-mode-probe-"));
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

const GUEST_INIT = `
  try {
    // Guest state: never sign in, and let auto-detect decide the profile.
    localStorage.removeItem("consuela-auth-user");
    localStorage.removeItem("consuela-wall-mode");
  } catch {}
`;
const WALL_OFF_INIT = `
  try {
    localStorage.removeItem("consuela-auth-user");
    // Manual off beats auto-detect — deterministic wall-off control on a
    // canvas shaped exactly like the wall panel (1080×1920 coarse pointer).
    localStorage.setItem("consuela-wall-mode", "off");
  } catch {}
`;

async function probeWall(browser) {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(GUEST_INIT);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/?wall=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });

  // data-wall is set on <html> after hydration (useWallMode → WallModeSync).
  let wallAttr = null;
  try {
    await page.waitForFunction(() => document.documentElement.dataset.wall === "true", null, { timeout: 60_000 });
    wallAttr = "true";
  } catch {
    wallAttr = await page.evaluate(() => document.documentElement.dataset.wall);
  }
  check("wall: html[data-wall=true]", wallAttr === "true", `dataset.wall=${String(wallAttr)}`);

  await sleep(1500); // let the wall grid + widgets settle

  const grid = await page.evaluate(() => {
    const el = document.querySelector('div[class*="auto-rows-[440px]"]');
    return el ? el.className : null;
  });
  check(
    "wall: Home grid is grid-cols-2 + auto-rows-[440px]",
    !!grid && grid.includes("grid-cols-2") && grid.includes("auto-rows-[440px]"),
    grid ? "found" : "wall grid element not found"
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - Math.max(document.documentElement.clientWidth, window.innerWidth)
  );
  check("wall: no horizontal overflow (scrollWidth ≤ 1080)", overflow <= 0, `overflow=${overflow}px`);

  const rail = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="wall-member-rail"]');
    return el ? el.querySelectorAll("button").length : 0;
  });
  check("wall: member rail renders with ≥1 tile", rail >= 1, `tiles=${rail}`);

  const capH = await page.evaluate(() => {
    const el = document.querySelector(".capsule-item");
    return el ? parseFloat(getComputedStyle(el).height) : null;
  });
  check("wall: capsule-item height ≥ 64", capH !== null && capH >= 64, `h=${capH}`);

  // Tap rail tiles in order until the WallPinPad dialog opens. The first
  // tile may be a pin-free under-10 kid (quickLogin signs in with no pad —
  // the established under-10 flow), so walk the rail and report which tile
  // opened the pad.
  const tiles = await page.$$('[data-testid="wall-member-rail"] button');
  let dialog = null;
  let openedBy = -1;
  for (let i = 0; i < tiles.length; i++) {
    try {
      await tiles[i].tap();
    } catch {
      await tiles[i].click();
    }
    try {
      dialog = await page.waitForSelector('[role="dialog"][aria-label^="Sign in as"]', { timeout: 5000 });
      openedBy = i;
      break;
    } catch {
      /* pin-free quickLogin path — try the next tile */
    }
  }
  check(
    "wall: rail tile opens WallPinPad dialog (Sign in as …)",
    !!dialog,
    openedBy === 0 ? "first tile" : openedBy > 0 ? `tile #${openedBy + 1} (earlier tiles were pin-free quick-login kids)` : "no tile opened the pad"
  );

  if (dialog) {
    const keys = await dialog.evaluate((d) =>
      [...d.querySelectorAll("button")]
        .map((b) => ({ label: b.getAttribute("aria-label") || b.textContent.trim(), h: parseFloat(getComputedStyle(b).height), w: parseFloat(getComputedStyle(b).width) }))
        .filter((k) => /^\d$/.test(k.label))
    );
    const minKey = keys.reduce((m, k) => Math.min(m, k.h, k.w), Infinity);
    check("wall: PIN pad keys ≥ 64px", keys.length >= 10 && minKey >= 64, `keys=${keys.length} min=${minKey}px`);
    const cancel = await dialog.$('button:has-text("Cancel")');
    if (cancel) await cancel.click();
  }
  await sleep(400);

  // Weather hero: scroll it into view (wall rows are 440px tall).
  const heroFs = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="wx-hero-temp"]');
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    await new Promise((r) => setTimeout(r, 400));
    return parseFloat(getComputedStyle(el).fontSize);
  });
  check(
    "wall: wx-hero-temp font-size ≥ 90px",
    heroFs !== null && heroFs >= 90,
    heroFs === null ? "weather widget not reachable (hidden/reordered?)" : `fs=${heroFs}px`
  );

  check("wall: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

async function probeWallOffControl(browser) {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(WALL_OFF_INIT);
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await sleep(2500);

  const wallAttr = await page.evaluate(() => document.documentElement.dataset.wall);
  check("control 1080 (wall off): data-wall unset", !wallAttr, `dataset.wall=${String(wallAttr)}`);
  const wallGrid = await page.evaluate(() => {
    const el = document.querySelector('div[class*="auto-rows-[440px]"]');
    return el ? el.className : null;
  });
  check(
    "control 1080 (wall off): no wall grid pair",
    !wallGrid || !(wallGrid.includes("grid-cols-2") && wallGrid.includes("auto-rows-[440px]")),
    wallGrid ? "grid element present but wall pair absent" : "no wall grid element"
  );
  await context.close();
}

async function probePhoneControl(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(GUEST_INIT);
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await sleep(2500);

  const wallAttr = await page.evaluate(() => document.documentElement.dataset.wall);
  check("phone control 390: data-wall unset", !wallAttr, `dataset.wall=${String(wallAttr)}`);
  const wallGrid = await page.evaluate(() => !!document.querySelector('div[class*="auto-rows-[440px]"]'));
  check("phone control 390: no wall grid", !wallGrid);
  await context.close();
}

await resolveServer();
try {
  const browser = await chromium.launch({ headless: true });
  await probeWall(browser);
  await probeWallOffControl(browser);
  await probePhoneControl(browser);
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
