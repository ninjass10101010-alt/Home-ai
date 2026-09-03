// Verify the Ledger integration end-to-end against the live NAS dashboard.
// Usage: PARENT_PIN=#### CHILD_PIN=#### node scripts/consuela/verify-ledger-integration.mjs
// Optional overrides: DASHBOARD_URL, PARENT_NAME (default Rebecca), CHILD_NAME (default Emily).
// PINs come from the environment only — never hardcode or commit them.
import { chromium } from "playwright";

const BASE = process.env.DASHBOARD_URL ?? "http://192.168.0.28:3000";
const PARENT = { name: process.env.PARENT_NAME ?? "Rebecca", pin: process.env.PARENT_PIN };
const CHILD = { name: process.env.CHILD_NAME ?? "Emily", pin: process.env.CHILD_PIN };

if (!PARENT.pin || !CHILD.pin) {
  console.error("Set PARENT_PIN and CHILD_PIN env vars before running.");
  process.exit(2);
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failures++;
    console.error(`❌ ${name}: ${e.message}`);
  }
}

async function loginCookie(member) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberName: member.name, pin: member.pin }),
  });
  if (!res.ok) throw new Error(`login failed for ${member.name}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/consuela_session=([^;]+)/);
  if (!m) throw new Error("no session cookie in login response");
  return m[1];
}

const browser = await chromium.launch();

async function authedContext(cookieValue, member) {
  const ctx = await browser.newContext();
  const url = new URL(BASE);
  await ctx.addCookies([
    { name: "consuela_session", value: cookieValue, domain: url.hostname, path: "/" },
  ]);
  // The httpOnly cookie satisfies the SERVER gate, but the client widget/page
  // gate on useAuth().isParent, which hydrates from localStorage (a real UI
  // login sets both). Seed the same auth record the login flow writes so the
  // browser checks exercise the true parent path.
  if (member) {
    const authUser = {
      id: member.id ?? 1,
      name: member.name,
      role: member.role,
      emoji: member.emoji ?? "🙂",
      color: member.color ?? "rose",
      avatarSize: "md",
      glow: false,
    };
    await ctx.addInitScript(
      ([key, val]) => {
        try {
          localStorage.setItem(key, val);
        } catch {}
      },
      ["consuela-auth-user", JSON.stringify(authUser)]
    );
  }
  return ctx;
}

// --- anonymous gates (plain fetch, no cookie) ---
await check("guest /ledger redirects to /", async () => {
  const res = await fetch(`${BASE}/ledger`, { redirect: "manual" });
  if (res.status !== 307) throw new Error(`got ${res.status}`);
});
await check("guest /api/data/dashboard 403s adult_only", async () => {
  const res = await fetch(`${BASE}/api/data/dashboard`);
  if (res.status !== 403) throw new Error(`got ${res.status}`);
});
await check("guest /assets/* 403s", async () => {
  const res = await fetch(`${BASE}/assets/index-x.js`);
  if (res.status !== 403) throw new Error(`got ${res.status}`);
});

// --- parent experience ---
const parentCookie = await loginCookie(PARENT);
await check("parent /ledger returns 200", async () => {
  const res = await fetch(`${BASE}/ledger`, {
    headers: { cookie: `consuela_session=${parentCookie}` },
  });
  if (res.status !== 200) throw new Error(`got ${res.status}`);
});
await check("parent /ledger-app/ proxies the ledger HTML", async () => {
  const res = await fetch(`${BASE}/ledger-app/`, {
    headers: { cookie: `consuela_session=${parentCookie}` },
  });
  const html = await res.text();
  if (!html.includes("The Ledger")) throw new Error("ledger HTML missing title");
});
await check("parent /api/data/dashboard returns yearData", async () => {
  const res = await fetch(`${BASE}/api/data/dashboard`, {
    headers: { cookie: `consuela_session=${parentCookie}` },
  });
  const json = await res.json();
  if (!json.yearData) throw new Error("no yearData");
});

{
  const ctx = await authedContext(parentCookie, { name: "Rebecca", role: "parent", emoji: "🐱", color: "rose" });
  const page = await ctx.newPage();
  await check("Home shows The Ledger card for parent", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=The Ledger", { timeout: 15000 });
  });
  await check("/ledger page mounts the iframe", async () => {
    await page.goto(`${BASE}/ledger`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("iframe[src='/ledger-app/']", { timeout: 15000 });
    await page.waitForSelector("text=Open full size", { timeout: 5000 });
  });
  await ctx.close();
}

// --- child experience ---
const childCookie = await loginCookie(CHILD);
await check("child /ledger redirects to /", async () => {
  const res = await fetch(`${BASE}/ledger`, {
    headers: { cookie: `consuela_session=${childCookie}` },
    redirect: "manual",
  });
  if (res.status !== 307) throw new Error(`got ${res.status}`);
});
await check("child /api/data/dashboard 403s", async () => {
  const res = await fetch(`${BASE}/api/data/dashboard`, {
    headers: { cookie: `consuela_session=${childCookie}` },
  });
  if (res.status !== 403) throw new Error(`got ${res.status}`);
});
{
  const ctx = await authedContext(childCookie, { name: "Emily", role: "child", emoji: "👧", color: "violet" });
  const page = await ctx.newPage();
  await check("Home hides The Ledger card for child", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500); // allow widget hydration
    if (await page.locator("text=The Ledger").count()) throw new Error("widget visible to child");
  });
  await ctx.close();
}

await browser.close();
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Ledger integration checks passed.");
