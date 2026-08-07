#!/usr/bin/env node
// Playwright smoke test for CapsuleNav (expanding neon-lime pill navigation).
//
// Usage:
//   node scripts/consuela/test-capsule-nav.mjs
//
// What it verifies:
//   1. The floating glass capsule renders with all 6 items
//      (Home, Ask, Meals, Tasks, Settings, More) as real <button>s.
//   2. On "/" the Home item is expanded (grid-template-columns "56px 1fr"),
//      carries aria-current="page", and shows its label; the other items
//      are collapsed ("56px 0fr") with no visible label.
//   3. Clicking Meals navigates to /meals and moves the expansion + aria-current.
//   4. Keyboard: pressing Tab focuses a nav button (not tabIndex=-1).
//   5. At 390px and 375px viewports there is no horizontal page overflow and
//      the capsule scales down (--capsule-scale < 1).
//
// Boots its own `npm run dev -p <free port>`; no PocketBase or cron needed
// (the dashboard runs on in-memory fallbacks).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3300;
const BASE = `http://127.0.0.1:${PORT}`;

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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "capsule-nav-test-"));
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

const serverLogTail = (logPath) => {
  try {
    return readFileSync(logPath, "utf8").split("\n").slice(-30).join("\n");
  } catch {
    return "(no log)";
  }
};

const LABELS = ["Home", "Ask", "Meals", "Tasks", "Settings", "More"];

async function main() {
  const { child, logPath } = await bootDevServer(PORT);
  let browser;
  try {
    await waitForReady();
    console.log(`dev server ready at ${BASE}`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

    const capsule = page.locator(".capsule-nav");
    await capsule.waitFor({ state: "visible", timeout: 60_000 });
    console.log("1. capsule renders");

    const buttons = page.locator('.capsule-nav button[aria-label]');
    assert.equal(await buttons.count(), 6, "expected 6 nav buttons");
    for (const label of LABELS) {
      assert.equal(await page.locator(`.capsule-nav button[aria-label="${label}"]`).count(), 1, `missing item ${label}`);
    }
    console.log("2. six items present");

    const homeBtn = page.locator('.capsule-nav button[aria-label="Home"]');
    assert.equal(await homeBtn.getAttribute("aria-current"), "page", "Home should be current on /");
    const homeStyle = await homeBtn.getAttribute("style");
    assert.match(homeStyle, /grid-template-columns:\s*56px 1fr/, "Home should be expanded (1fr)");
    assert.equal(await page.locator('.capsule-nav button[aria-label="Home"] .capsule-label-text').isVisible(), true, "Home label visible");
    const mealsBtn = page.locator('.capsule-nav button[aria-label="Meals"]');
    assert.match(await mealsBtn.getAttribute("style"), /56px 0fr/, "Meals should be collapsed (0fr)");
    console.log("3. Home expanded with label; Meals collapsed");

    await mealsBtn.click();
    await page.waitForURL("**/meals", { timeout: 30_000 });
    await page.waitForTimeout(800);
    assert.equal(await mealsBtn.getAttribute("aria-current"), "page", "Meals should be current after click");
    assert.equal(await homeBtn.getAttribute("aria-current"), null, "Home should lose current");
    assert.match(await mealsBtn.getAttribute("style"), /56px 1fr/, "Meals expanded after click");    console.log("4. click switches active item (navigation + aria-current + expansion)");

    await page.locator('.capsule-nav button[aria-label="Home"]').focus();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLButtonElement ? el.getAttribute("aria-label") : "";
    });
    assert.equal(focused, "Home", "nav button should receive focus");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/", { timeout: 30_000 });
    assert.equal(await page.locator('.capsule-nav button[aria-label="Home"]').getAttribute("aria-current"), "page", "Enter activates the focused nav item");
    console.log("5. keyboard focus + Enter activation work");

    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `no horizontal overflow at ${width}px (got +${overflow}px)`);
      const scale = await page.evaluate(() => {
        const el = document.querySelector(".capsule-nav");
        const transform = getComputedStyle(el).transform;
        const m = new DOMMatrixReadOnly(transform);
        return m.a;
      });
      assert.ok(scale < 1 && scale > 0.5, `capsule should scale down at ${width}px (got ${scale})`);
    }
    console.log("6. no horizontal overflow + capsule auto-scales at 375px and 390px");

    console.log("\nALL CAPSULE NAV CHECKS PASSED");
  } catch (err) {
    console.error("\nFAILED:");
    console.error(err.message);
    console.error("--- dev server log tail ---");
    console.error(serverLogTail(logPath));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
  }
}

main();
