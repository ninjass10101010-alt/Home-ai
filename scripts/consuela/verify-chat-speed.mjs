#!/usr/bin/env node
// Chat speed probe: no pre-flight request, SSE reply renders, fast first paint.
// Run against a dev server: BASE_URL=http://localhost:3000 node scripts/consuela/verify-chat-speed.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SSE_BODY =
  'data: {"t":"You have "}\n\n' +
  'data: {"t":"3 chores "}\n\n' +
  'data: {"t":"today."}\n\n' +
  "data: [DONE]\n\n";

const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
await page.route("**/api/chat/messages**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, messages: [] }) }));
await page.route("**/api/hermes/chat", (route) =>
  route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: SSE_BODY }));

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? "ok" : "FAIL"} - ${name}`); if (!ok) failures++; };

await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
const t0 = Date.now();
await page.locator("textarea").fill("what do I have today?");
await page.getByTitle("Send message").click();
await page.waitForFunction(() => document.body.innerText.includes("3 chores"), null, { timeout: 5000 });
const elapsed = Date.now() - t0;

check("reply rendered from SSE", await page.locator("text=You have 3 chores today.").count() > 0);
check("no /api/chat/process pre-flight", !requests.some((u) => u.includes("/api/chat/process")));
check(`first paint under 2s (${elapsed}ms)`, elapsed < 2000);

await browser.close();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
