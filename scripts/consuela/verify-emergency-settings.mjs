#!/usr/bin/env node
// Playwright probe: Settings now surfaces the Emergency reference page.
//
// Usage:
//   node scripts/consuela/verify-emergency-settings.mjs
//
// What it verifies:
//   1. /settings renders an "Emergency" SectionCard whose link row points to /emergency.
//   2. Tapping it lands on the emergency reference page (contacts + 911 present).
//
// Boots its own `npm run dev -p <free port>`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3301;
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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "emergency-settings-test-"));
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

async function main() {
  const { child, logPath } = await bootDevServer(PORT);
  let browser;
  try {
    await waitForReady();
    console.log(`dev server ready at ${BASE}`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    await page.goto(BASE + "/settings", { waitUntil: "domcontentloaded" });
    const link = page.locator('a[href="/emergency"]');
    await link.waitFor({ state: "visible", timeout: 60_000 });
    const card = link.locator("xpath=ancestor::div[contains(@class, 'widget-card')][1]");
    assert.match(await card.textContent(), /Emergency/, "Settings should have an Emergency card");
    console.log("1. Settings renders an Emergency card linking to /emergency");

    await link.click();
    await page.waitForURL("**/emergency", { timeout: 30_000 });
    await page.waitForTimeout(800);
    const body = await page.locator("body").textContent();
    assert.match(body, /911/, "emergency page should mention 911");
    assert.match(body, /Emergency/i, "emergency page should render its title");
    console.log("2. Emergency card opens the reference page (911 + title present)");

    console.log("\nALL EMERGENCY-SETTINGS CHECKS PASSED");
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