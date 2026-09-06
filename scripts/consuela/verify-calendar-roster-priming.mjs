#!/usr/bin/env node
// Fix-B probe: Calendar member chips show the LIVE/primed roster after a
// client-side Home → Calendar navigation — not the stale 8-entry
// DEFAULT_CALENDAR_MEMBERS fallback list the snapshot module used to ship.
//
// Usage (against the ALREADY RUNNING dev server — this probe boots nothing):
//   node scripts/consuela/verify-calendar-roster-priming.mjs [base-url]
//
// Contract verified at 390px:
//   1. Home loads, then the capsule nav CLIENT-navigates to /calendar.
//   2. The member chips match the roster the client cache actually holds:
//      signed-in → /api/members/admin names; guest (401) → the fallback
//      family INCLUDING the pets (Rocco/Rico) — never the 7-person DEFAULT
//      list (which has no pets and is byte-identical to the old bug).
//   3. Zero page errors.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The hardcoded fallback the snapshot module ships (the bug's fingerprint):
// All + 7 humans, NO pets.
const DEFAULT_LIST = ["All", "Rebecca", "Jeffery", "Emily", "Bailey", "Jasmine", "Aurora", "Caspian"];
// The honest fallback family (src/lib/member-fallback.ts) — 9 incl. pets.
const FALLBACK_FIRST_NAMES = ["Rebecca", "Jeffery", "Emily", "Bailey", "Jasmine", "Aurora", "Caspian", "Rocco", "Rico"];

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name} — ${e.message}`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  // 1. Home first (where the startup hydrate + roster dispatches fire while
  //    the Calendar is UNMOUNTED — the exact flow that stranded the chips).
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Calendar"]', { timeout: 30_000 });
  await sleep(1500); // let the hydrate roster fetch settle

  // What does the roster endpoint say for this browser? (signed-in vs guest)
  const rosterRes = await page.evaluate(async () => {
    const r = await fetch("/api/members/admin", { cache: "no-store" });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, members: (await r.json()).members?.map((m) => m.name) ?? [] };
  });

  // 2. CLIENT navigation to Calendar (no reload) — the reported repro path.
  await page.click('button[aria-label="Calendar"]');
  await page.waitForURL(/\/calendar/, { timeout: 15_000 });
  await page.waitForSelector(".calendar-member-chip", { timeout: 15_000 });
  await sleep(1000); // allow the subscribe-time priming + any late dispatch to land

  const chips = await page.$$eval(".calendar-member-chip", (els) =>
    // The name is the chip's trailing <span> (the leading Avatar can carry
    // injected <style> text, so textContent on the button is unusable).
    els.map((e) => (e.lastElementChild?.textContent ?? "").trim())
  );
  const chipNames = chips;
  console.log("chips:", JSON.stringify(chips));
  console.log("roster endpoint:", JSON.stringify(rosterRes));

  check("chips are NOT the stale DEFAULT fallback list", () => {
    assert.notDeepEqual(chipNames, DEFAULT_LIST, "chips byte-identical to DEFAULT_CALENDAR_MEMBERS — priming did not land");
  });

  if (rosterRes.ok) {
    const liveFirst = rosterRes.members.map((n) => n.split(" ")[0]);
    check("signed-in: chips carry the live roster names", () => {
      for (const n of liveFirst) {
        assert.ok(chipNames.some((c) => c.startsWith(n)), `live member ${n} missing from chips`);
      }
    });
  } else {
    assert.equal(rosterRes.status, 401);
    check("guest: chips match the fallback roster INCLUDING pets (not the 7-item DEFAULT)", () => {
      assert.ok(chipNames.includes("All"), "All chip missing");
      for (const n of FALLBACK_FIRST_NAMES) {
        assert.ok(chipNames.includes(n), `fallback member ${n} missing from chips`);
      }
      assert.equal(chipNames.length, FALLBACK_FIRST_NAMES.length + 1);
    });
  }

  check("zero page errors across the session", () => {
    assert.deepEqual(pageErrors, []);
  });

  // 3. Direct full load of /calendar — the SSR/hydration path must stay
  //    mismatch-free (server HTML and the client's first render both use the
  //    deterministic fallback; the live roster swaps in after hydration).
  const consoleErrors = [];
  const page2 = await ctx.newPage();
  page2.on("console", (m) => {
    if (m.type() === "error" && /hydration|did not match|server HTML/i.test(m.text())) {
      consoleErrors.push(m.text());
    }
  });
  page2.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page2.goto(`${BASE}/calendar`, { waitUntil: "domcontentloaded" });
  await page2.waitForSelector(".calendar-member-chip", { timeout: 15_000 });
  await sleep(1500);
  await page2.close();
  check("direct /calendar load: zero hydration errors", () => {
    assert.deepEqual(consoleErrors, []);
  });
} finally {
  await browser.close();
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(failed.length ? `\n${failed.length} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed.length ? 1 : 0);
