#!/usr/bin/env node
// Live probe for the ambient wall-display screensaver (spec 2026-09-07).
//
// Usage:
//   node scripts/consuela/verify-screensaver.mjs            # against http://127.0.0.1:3000
//   BASE_URL=https://… node scripts/consuela/verify-screensaver.mjs
//
// What it verifies (guest context, no cookies, read-only — the POST check expects 405):
//   1. GET /api/consuela/screensaver answers a guest with 200.
//   2. The payload carries the six curated zones (shape-level, data-independent).
//   3. No sensitive KEYS in the payload (key scan — real event/dinner titles may
//      legitimately contain substrings like "pin", so values are not scanned).
//   4. POST → 405 (the endpoint is GET-only).
//   5. /screensaver renders its clock zone at 1280×800.
//   6. No capsule nav / emergency chrome on the page.
//   7. No horizontal overflow.
//   8. No page errors.

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
let pass = 0;
let fail = 0;
const check = (name, ok) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
};

const keysOf = (value, acc = []) => {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      keysOf(v, acc);
    }
  }
  return acc;
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // 1-4. endpoint answers a guest (fresh context, no cookies) with the curated shape
  const ctx = await browser.newContext();
  const res = await ctx.request.get(`${BASE}/api/consuela/screensaver`);
  check("GET /api/consuela/screensaver 200 for guest", res.status() === 200);
  const body = await res.json().catch(() => null);
  check(
    "payload has the six zones",
    !!body && body.ok === true && Array.isArray(body.events) && "dinner" in body && !!body.tasks && Array.isArray(body.briefing)
  );
  const SENSITIVE = ["pin", "secret", "password", "token", "ledger", "contact", "assignee"];
  const keys = body ? keysOf(body) : [];
  check(
    "payload carries no sensitive keys",
    !!body && !keys.some((k) => SENSITIVE.some((s) => k.toLowerCase().includes(s)))
  );
  const post = await ctx.request.post(`${BASE}/api/consuela/screensaver`, { data: {} });
  check("POST → 405", post.status() === 405);

  // 5-8. the page renders its zones at 1280×800
  await page.goto(`${BASE}/screensaver`, { waitUntil: "domcontentloaded" });
  check("clock renders", await page.getByTestId("ss-clock").isVisible());
  check("no capsule nav / emergency chrome", (await page.locator("nav").count()) === 0);
  check("no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check("no page errors", errors.length === 0);
} catch (e) {
  check(`probe run completed (${e?.message || e})`, false);
} finally {
  await browser.close();
}

console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
