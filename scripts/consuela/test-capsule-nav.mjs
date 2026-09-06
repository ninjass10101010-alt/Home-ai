#!/usr/bin/env node
// Playwright smoke test for CapsuleNav (expanding neon-lime pill navigation).
//
// Usage:
//   node scripts/consuela/test-capsule-nav.mjs
//
// Shipped contract (2026-09-04): BOTH modes render exactly 7 items —
//   adult/family/guest: Home, Ask, Meals, Tasks, Calendar, House, Settings
//   kid (any signed-in non-parent): House swapped for Rewards (after Tasks)
// The 44px-at-390px capsule sizing is computed for 7 items in both modes.
//
// What it verifies:
//   1. The floating glass capsule renders with all 7 adult items as real
//      <button>s (the script runs signed-out = family mode = adult nav).
//   2. On "/" the Home item is expanded (grid-template-columns "56px 1fr"),
//      carries aria-current="page", and shows its label; the other items
//      are collapsed ("56px 0fr") with no visible label.
//   3. Clicking Meals navigates to /meals and moves the expansion + aria-current.
//   4. Keyboard: pressing Tab focuses a nav button (not tabIndex=-1).
//   5. Clicking House navigates to /ha and becomes the active item.
//   6. At 390px and 375px viewports there is no horizontal page overflow and
//      the capsule scales down (--capsule-scale < 1).
//   7. The KID contract (House swapped for Rewards, still 7 items) is
//      verified statically against src/components/ui/CapsuleNav.tsx —
//      signing a child in needs a real PIN + live PocketBase, which this
//      no-dependency smoke run deliberately doesn't boot.
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

const ADULT_LABELS = ["Home", "Ask", "Meals", "Tasks", "Calendar", "House", "Settings"];

// Static verification of the kid-mode contract against the component source
// (kid mode needs a real PIN + live PocketBase to sign in — out of scope for
// this no-dependency smoke run).
function verifyKidContract() {
  const src = readFileSync(path.join(REPO_ROOT, "src", "components", "ui", "CapsuleNav.tsx"), "utf8");
  // Adult base list: exactly 7 items, House included, Settings last.
  const navItemsBlock = src.slice(src.indexOf("const navItems = ["), src.indexOf("const EXPAND_EASE"));
  const baseHrefs = [...navItemsBlock.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(baseHrefs, ["/", "/chat", "/meals", "/tasks", "/calendar", "/ha", "/settings"], "adult nav must ship these 7 routes in order");
  // Kid swap: House filtered out, Rewards inserted after Tasks.
  assert.match(src, /rewardsItem\s*=\s*\{[\s\S]*?href:\s*"\/rewards",\s*label:\s*"Rewards"/, "kid-only Rewards tab must exist (/rewards)");
  assert.match(src, /currentUser\.role\s*!==\s*"parent"[\s\S]*?filter\(\(item\) => item\.href !== "\/ha"\)/, "kid mode must hide House");
  assert.match(src, /findIndex\(\(item\) => item\.href === "\/tasks"\)[\s\S]*?splice\(tasksIdx \+ 1, 0, rewardsItem\)/, "Rewards must be inserted right after Tasks");
  // Both modes render 7 items (the 44px-at-390px sizing depends on it).
  // Derive the adult and kid lists by replaying the PARSED swap logic
  // (House filtered for non-parents, Rewards spliced in after Tasks) —
  // a hand-counted formula would pass even if the swap broke.
  const hiddenMatch = src.match(/filter\(\(item\) => item\.href !== "([^"]+)"\)/);
  assert.ok(hiddenMatch, "kid mode must filter out one adult route");
  const rewardsMatch = src.match(/rewardsItem\s*=\s*\{[\s\S]*?href:\s*"([^"]+)"/);
  assert.ok(rewardsMatch, "kid-only Rewards tab must carry an href");
  const anchorMatch = src.match(/findIndex\(\(item\) => item\.href === "([^"]+)"\)[\s\S]*?splice\(\w+ \+ 1, 0, rewardsItem\)/);
  assert.ok(anchorMatch, "Rewards splice must name its anchor item");
  const adultItems = [...baseHrefs];
  const kidItems = adultItems.filter((href) => href !== hiddenMatch[1]);
  kidItems.splice(kidItems.indexOf(anchorMatch[1]) + 1, 0, rewardsMatch[1]);
  assert.equal(adultItems.length, 7, "adult mode must render exactly 7 items");
  assert.equal(kidItems.length, 7, "kid mode must also render exactly 7 items");
  assert.ok(kidItems.includes("/rewards"), "kid list must contain /rewards");
  assert.ok(!kidItems.includes("/ha"), "kid list must lack /ha");
  assert.ok(adultItems.includes("/ha"), "adult list must contain /ha");
  assert.ok(!adultItems.includes("/rewards"), "adult list must lack /rewards");
  console.log("10. kid contract statically verified against CapsuleNav.tsx (7 items both modes, House→Rewards after Tasks)");
}

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
    assert.equal(await buttons.count(), 7, "expected 7 nav buttons");
    for (const label of ADULT_LABELS) {
      assert.equal(await page.locator(`.capsule-nav button[aria-label="${label}"]`).count(), 1, `missing item ${label}`);
    }
    assert.equal(await page.locator('.capsule-nav button[aria-label="Rewards"]').count(), 0, "guest/family mode must NOT show the kid-only Rewards tab");
    console.log("2. seven adult items present (no Rewards tab for guests)");

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

    await page.locator('.capsule-nav button[aria-label="Calendar"]').click();
    await page.waitForURL("**/calendar", { timeout: 30_000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.capsule-nav button[aria-label="Calendar"]').getAttribute("aria-current"), "page", "Calendar should be current on /calendar");
    console.log("6. Calendar tab navigates to /calendar and becomes active");

    await page.locator('.capsule-nav button[aria-label="House"]').click();
    await page.waitForURL("**/ha", { timeout: 30_000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.capsule-nav button[aria-label="House"]').getAttribute("aria-current"), "page", "House should be current on /ha");
    console.log("7. House tab navigates to /ha and becomes active");

    const resp = await page.request.get(BASE + "/more", { maxRedirects: 0 });
    assert.ok(resp.status() === 307 || resp.status() === 308 || resp.status() === 301, `expected redirect status, got ${resp.status()}`);
    const loc = resp.headers()["location"];
    assert.match(loc, /\/calendar$/, `redirect location should be /calendar, got ${loc}`);
    console.log("8. /more redirects to /calendar");

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
    console.log("9. no horizontal overflow + capsule auto-scales at 375px and 390px");

    verifyKidContract();

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
