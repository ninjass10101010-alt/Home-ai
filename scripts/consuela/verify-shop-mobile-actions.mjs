#!/usr/bin/env node
// Live probe for the Shop-tab mobile row-actions feature (2026-09-18):
// the mobile "More actions" (⋯) overflow button + GroceryItemActionsSheet,
// with the ≥640px inline cluster (priority Chip + lock + edit + delete)
// inside a `hidden sm:flex` wrapper and StorePill visible at all sizes.
//
// Usage:
//   node scripts/consuela/verify-shop-mobile-actions.mjs
//
// What it verifies (guest session, 390×844 + 1280×800, dark + light themes):
//   1. /meals?tab=shop loads with 0 page errors and the requested theme applied.
//   2. Three items added via the Add form ("Organic baby spinach", "Milk",
//      "Family Fare ground beef") render rows whose title (the div.truncate
//      inside div.min-w-0) is ≥150px wide and shows the full name.
//   3. No horizontal overflow (documentElement.scrollWidth === clientWidth).
//   4. @390: the ⋯ button ("More actions for {name}") is visible on every row
//      while the desktop lock/edit/delete buttons are display-hidden; tapping
//      ⋯ opens the sheet titled "{emoji} {name}" with Lock/Edit/Delete;
//      Delete removes the row; Lock flips the button to "unlock {name} for
//      auto-sync" on reopen; StorePill still opens the StorePicker.
//   5. @1280: the full inline cluster is visible, the ⋯ is display-hidden.

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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("http://127.0.0.1:3000/meals?tab=shop", { signal: AbortSignal.timeout(10_000) });
      if (res.status === 200 || res.status === 307) {
        BASE = "http://127.0.0.1:3000";
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(1500);
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
  const logDir = mkdtempSync(path.join(os.tmpdir(), "shop-actions-probe-"));
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

const ITEMS = ["Organic baby spinach", "Milk", "Family Fare ground beef"];

// Full valid ThemeConfig shape — useTheme only adopts a parsed config that
// passes its field validation, otherwise it resets to system mode.
const themeSeed = (mode) => JSON.stringify({
  mode,
  accentColor: "nori",
  accentHex: { selected: "#3b82f6", glow: "rgba(59,130,246,0.25)", button: "#2563eb", border: "rgba(59,130,246,0.35)" },
  contrastBoost: false,
});

async function addItem(page, name) {
  await page.getByLabel("Add grocery item").fill(name);
  await page.locator("xpath=//label[input[@aria-label='Add grocery item']]/following-sibling::button").click();
  await page.locator(`button[aria-label="Check off ${name}"]`).waitFor({ state: "attached", timeout: 15_000 });
}

async function rowFacts(page, name) {
  return page.evaluate((item) => {
    const checkbox =
      document.querySelector(`button[aria-label="Check off ${item}"]`) ||
      document.querySelector(`button[aria-label="Uncheck ${item}"]`);
    const row = checkbox ? checkbox.closest("div.group") : null;
    if (!row) return { found: false };
    const title = row.querySelector("div.min-w-0 > div.truncate");
    const more = row.querySelector(`button[aria-label="More actions for ${item}"]`);
    const byLabel = (label) => row.querySelector(`button[aria-label="${label}"]`);
    const lock =
      byLabel(`lock ${item} from auto-sync`) ||
      byLabel(`unlock ${item} for auto-sync`);
    const edit = byLabel(`Edit ${item}`);
    const del = byLabel(`Delete ${item}`);
    const visible = (el) => !!el && el.offsetParent !== null;
    return {
      found: true,
      titleWidth: title ? title.clientWidth : 0,
      titleText: title ? title.textContent || "" : "",
      moreVisible: visible(more),
      lockVisible: visible(lock),
      editVisible: visible(edit),
      deleteVisible: visible(del),
    };
  }, name);
}

async function openSheet(page, name) {
  await page.locator(`button[aria-label="More actions for ${name}"]`).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "attached", timeout: 10_000 });
  await sleep(300);
  return dialog;
}

async function probeMobile(browser, theme, tag) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((seed) => {
    localStorage.setItem("home-ai-theme-config", seed);
  }, themeSeed(theme));
  await page.goto(`${BASE}/meals?tab=shop`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByLabel("Add grocery item").waitFor({ state: "visible", timeout: 30_000 });
  await sleep(400);

  const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  check(`${tag}: theme applied`, applied === theme, `data-theme=${applied}`);

  for (const name of ITEMS) {
    await addItem(page, name);
  }
  const allAdded = (await Promise.all(ITEMS.map((n) => rowFacts(page, n)))).every((f) => f.found);
  check(`${tag}: three items added via the Add form`, allAdded);

  const facts = [];
  for (const name of ITEMS) facts.push(await rowFacts(page, name));
  const widths = facts.map((f) => f.titleWidth).join(",");
  check(
    `${tag}: row titles ≥150px wide with full names`,
    facts.every((f, i) => f.titleWidth >= 150 && f.titleText.includes(ITEMS[i])),
    `widths=${widths}px`
  );

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}: no horizontal overflow`, overflow === 0, `overflow=${overflow}px`);

  check(
    `${tag}: ⋯ visible on every row`,
    facts.every((f) => f.moreVisible)
  );
  check(
    `${tag}: desktop cluster display-hidden on every row`,
    facts.every((f) => !f.lockVisible && !f.editVisible && !f.deleteVisible)
  );

  // Sheet: open ⋯ on the spinach row
  const dialog = await openSheet(page, ITEMS[0]);
  const sheetTitle = ((await dialog.locator("h3").first().textContent()) || "").trim();
  const sheetButtons = await dialog.evaluate(() =>
    Array.from(document.querySelectorAll("button[aria-label]")).map((b) => b.getAttribute("aria-label"))
  );
  check(
    `${tag}: ⋯ opens the sheet titled with the item name + Lock/Edit/Delete`,
    sheetTitle.includes(ITEMS[0]) &&
      sheetButtons.includes(`lock ${ITEMS[0]} from auto-sync`) &&
      sheetButtons.includes(`Edit ${ITEMS[0]}`) &&
      sheetButtons.includes(`Delete ${ITEMS[0]}`),
    `title="${sheetTitle}"`
  );
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 5_000 });

  // Sheet: Delete removes the beef row
  const beef = ITEMS[2];
  const delDialog = await openSheet(page, beef);
  await delDialog.locator(`button[aria-label="Delete ${beef}"]`).click();
  await page.locator(`button[aria-label="More actions for ${beef}"]`).waitFor({ state: "detached", timeout: 10_000 });
  const beefGone = (await page.locator(`button[aria-label="Check off ${beef}"]`).count()) === 0;
  check(`${tag}: sheet Delete removes the row`, beefGone);

  // Sheet: Lock Milk → reopen → unlock label
  const milk = ITEMS[1];
  let milkDialog = await openSheet(page, milk);
  await milkDialog.locator(`button[aria-label="lock ${milk} from auto-sync"]`).click();
  await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 5_000 });
  milkDialog = await openSheet(page, milk);
  const unlockBtn = milkDialog.locator(`button[aria-label="unlock ${milk} for auto-sync"]`);
  const unlockVisible = await unlockBtn.isVisible();
  const unlockText = ((await unlockBtn.textContent()) || "").trim();
  check(
    `${tag}: sheet Lock flips to "unlock" on reopen`,
    unlockVisible && /Unlock auto-sync/i.test(unlockText),
    `text="${unlockText}"`
  );
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 5_000 });

  // StorePill still opens the StorePicker
  await page.evaluate(() => {
    const more = document.querySelector('button[aria-label="More actions for Milk"]');
    const row = more.closest("div.group");
    const wrappers = row.querySelectorAll("div.shrink-0");
    wrappers[wrappers.length - 1].querySelector("button").click();
  });
  try {
    await page.getByRole("heading", { name: "Pick a store" }).waitFor({ state: "visible", timeout: 10_000 });
    check(`${tag}: StorePill opens the StorePicker ("Pick a store")`, true);
  } catch {
    check(`${tag}: StorePill opens the StorePicker ("Pick a store")`, false);
  }

  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

async function probeDesktop(browser, theme, tag) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((seed) => {
    localStorage.setItem("home-ai-theme-config", seed);
  }, themeSeed(theme));
  await page.goto(`${BASE}/meals?tab=shop`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByLabel("Add grocery item").waitFor({ state: "visible", timeout: 30_000 });
  await sleep(400);

  const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  check(`${tag}: theme applied`, applied === theme, `data-theme=${applied}`);

  for (const name of ITEMS) {
    await addItem(page, name);
  }
  const facts = [];
  for (const name of ITEMS) facts.push(await rowFacts(page, name));
  const widths = facts.map((f) => f.titleWidth).join(",");
  check(
    `${tag}: three items added, names present at full width`,
    facts.every((f, i) => f.found && f.titleWidth >= 150 && f.titleText.includes(ITEMS[i])),
    `widths=${widths}px`
  );
  check(
    `${tag}: full inline cluster visible (lock/edit/delete)`,
    facts.every((f) => f.lockVisible && f.editVisible && f.deleteVisible)
  );
  check(
    `${tag}: ⋯ display-hidden on every row`,
    facts.every((f) => !f.moreVisible)
  );

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}: no horizontal overflow`, overflow === 0, `overflow=${overflow}px`);

  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

await resolveServer();
try {
  const browser = await chromium.launch({ headless: true });
  await probeMobile(browser, "dark", "phone 390 dark");
  await probeMobile(browser, "light", "phone 390 light");
  await probeDesktop(browser, "dark", "desktop 1280 dark");
  await probeDesktop(browser, "light", "desktop 1280 light");
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
