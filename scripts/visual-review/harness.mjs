// Shared visual-review harness for warm-glass-v2.
//
// Boots the PRODUCTION build (`next start`) on an OS-assigned port so many
// critic agents can review concurrently without fighting Next's per-directory
// dev lock. Every browser context is hermetic: auth + theme are seeded into
// localStorage and ALL /api/** traffic is stubbed with sanitized fixtures, so
// no real family data, credential, or PocketBase is ever reachable.
//
// Contains NO secrets. All env values are placeholders inherited from
// scripts/consuela/probe-env.mjs.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildProbeEnv, SAFE_PROBE_ENV } from "../consuela/probe-env.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const VIEWPORTS = Object.freeze({
  wall: { width: 1920, height: 1080, label: "wall (1920x1080)" },
  desktop: { width: 1280, height: 900, label: "desktop (1280x900)" },
  laptop: { width: 1024, height: 768, label: "laptop (1024x768)" },
  tablet: { width: 768, height: 1024, label: "tablet (768x1024)" },
  phone: { width: 390, height: 844, label: "phone (390x844)" },
  phoneSmall: { width: 320, height: 568, label: "phone-small (320x568)" },
});

export const ROLES = Object.freeze(["parent", "child", "guest", "pet"]);

export function roleUser(role) {
  const users = {
    parent: { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🧑", color: "amber", avatarSize: "md", glow: false, age: 38 },
    child: { id: 2, name: "Aurora", role: "child", emoji: "🧒", color: "violet", avatarSize: "md", glow: false, age: 7 },
    guest: { id: 3, name: "Nora", role: "guest", emoji: "🧓", color: "sage", avatarSize: "md", glow: false, age: 71 },
    pet: { id: 4, name: "Biscuit", role: "pet", emoji: "🐕", color: "rose", avatarSize: "md", glow: false, age: 4 },
  };
  const user = users[role];
  if (!user) throw new Error(`Unknown role: ${role}`);
  return user;
}

export const SANITIZED_MEMBERS = Object.freeze([
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🧑", age: 38, created: "Feb 2024", avatarSize: "md", glow: false },
  { id: 2, name: "Aurora", role: "child", emoji: "🧒", age: 7, created: "Mar 2024", avatarSize: "md", glow: false },
]);

export function themeConfig(mode = "dark", contrastBoost = false, accentColor = "violet") {
  const accents = {
    violet: { selected: "#7c6ff7", glow: "rgba(124,111,247,0.28)", button: "#7c6ff7", border: "rgba(124,111,247,0.35)" },
    amber: { selected: "#f5a524", glow: "rgba(245,165,36,0.28)", button: "#f5a524", border: "rgba(245,165,36,0.35)" },
    sage: { selected: "#5fb08a", glow: "rgba(95,176,138,0.28)", button: "#5fb08a", border: "rgba(95,176,138,0.35)" },
  };
  return { mode, accentColor, contrastBoost, accentHex: accents[accentColor] ?? accents.violet };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const { port } = reservation.address();
      reservation.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForReady(baseUrl, child, logPath, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early (code=${child.exitCode}). Log:\n${readLog(logPath)}`);
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`next start never became ready. Log:\n${readLog(logPath)}`);
}

function readLog(logPath) {
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "(log unavailable)";
  }
}

/**
 * Boot the production build. Returns { baseUrl, stop() }.
 * Uses `next start` (read-only on .next) so N agents can run concurrently.
 */
export async function bootServer() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logDir = path.join(os.tmpdir(), "warmglass-vr");
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `next-start-${port}.log`);
  rmSync(logPath, { force: true });
  const log = createWriteStream(logPath);

  const env = {
    ...buildProbeEnv(baseUrl),
    NODE_ENV: "production",
  };

  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  await waitForReady(baseUrl, child, logPath);

  return {
    baseUrl,
    logPath,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline && child.exitCode === null) await sleep(150);
      if (child.exitCode === null) child.kill("SIGKILL");
      log.end();
    },
  };
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Seed auth/theme into localStorage and stub every /api/** call.
 * `overrides` lets a reviewer customize specific endpoints per review.
 */
export async function installSanitizedState(context, opts) {
  const { role = "parent", mode = "dark", contrastBoost = false, accentColor = "violet", wallMode = "off", overrides = {} } = opts ?? {};
  const user = roleUser(role);

  await context.addInitScript(
    ({ sanitizedUser, theme, wall }) => {
      localStorage.clear();
      localStorage.setItem("consuela-auth-user", JSON.stringify(sanitizedUser));
      localStorage.setItem("home-ai-theme-config", JSON.stringify(theme));
      localStorage.setItem("consuela-wall-mode", wall);
    },
    { sanitizedUser: user, theme: themeConfig(mode, contrastBoost, accentColor), wall: wallMode },
  );

  // Kill external font calls so reviews are hermetic + offline-safe.
  await context.route("https://fonts.googleapis.com/**", (route) => route.abort("blockedbyclient"));
  await context.route("https://fonts.gstatic.com/**", (route) => route.abort("blockedbyclient"));

  const unstubbed = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (Object.prototype.hasOwnProperty.call(overrides, pathname)) {
      const override = overrides[pathname];
      if (override === "passthrough") return route.continue();
      return fulfillJson(route, override.body ?? override, override.status ?? 200);
    }

    if (pathname === "/api/auth/login" || pathname === "/api/auth/quick-login") {
      return fulfillJson(route, { error: "visual_review_signin_disabled" }, 423);
    }
    if (pathname === "/api/auth/logout") return fulfillJson(route, { ok: true });
    if (pathname === "/api/members/admin") {
      return fulfillJson(route, { ok: true, source: "visual-review", members: SANITIZED_MEMBERS });
    }
    if (pathname === "/api/emergency-contacts") {
      return fulfillJson(route, { ok: true, contactsSource: "visual-review", contacts: [] });
    }
    if (pathname === "/api/google/state") {
      return fulfillJson(route, {
        ok: true, connected: false, account_email: null, granted_at: null,
        revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null,
      });
    }
    if (pathname === "/api/google/calendars") return fulfillJson(route, { ok: true, calendars: [] });
    if (pathname === "/api/google/sync-state") {
      return fulfillJson(route, { ok: true, connected: false, status: "unconnected" });
    }
    if (pathname === "/api/ha/notify-targets") {
      return fulfillJson(route, { ok: true, targets: [], telegramAvailable: false });
    }
    if (pathname === "/api/ha/notify-prefs") {
      return fulfillJson(route, { ok: true, prefs: { briefing: false, weather: false, calendar: false } });
    }
    if (pathname === "/api/admin/version") {
      return fulfillJson(route, {
        ok: true,
        built_at: { hash: "visual-review", short: "vr", message: "Sanitized visual-review build", date: "2026-01-01T00:00:00.000Z" },
        latest_remote: null,
        update_available: false,
      });
    }

    // Record anything not explicitly handled: an unstubbed endpoint usually
    // means the page renders an error/empty state it would never show live.
    unstubbed.push(`${request.method()} ${pathname}`);
    return fulfillJson(route, {
      ok: true,
      data: [],
      items: [],
      members: SANITIZED_MEMBERS,
      contacts: [],
      tasks: [],
      events: [],
      entries: [],
      results: [],
    });
  });

  return { unstubbed };
}

/**
 * In-page audit: the objective triple-A gate.
 * Mirrors the binding contracts in AGENTS.md "UI Contracts":
 *   - 12px (0.75rem) type floor
 *   - 44x44 tap targets (or documented .hit-44 equivalent)
 *   - WCAG AA contrast in dark AND light
 *   - no horizontal overflow
 *   - glyph-only controls need an accessible name
 */export const AUDIT_FN = `
(() => {
  const problems = [];
  const seen = new Set();
  const push = (rule, severity, detail) => {
    const key = rule + '|' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ rule, severity, detail });
  };

  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
    if (cls) s += '.' + cls;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    if (label) s += ' "' + label + '"';
    return s;
  };

  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);

  // ---------- 1. document-level horizontal overflow ----------
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) {
    push('horizontal-overflow', 'error',
      'document scrollWidth=' + doc.scrollWidth + ' exceeds viewport=' + window.innerWidth);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1) {
        push('element-past-viewport', 'error',
          describe(el) + ' right=' + Math.round(r.right) + ' > viewport=' + window.innerWidth);
      }
    }
  }

  // ---------- 2. CLIPPED content (cut off, unreachable) ----------
  // An element that scrolls internally is fine ONLY if it is actually scrollable
  // (overflow-x auto/scroll). overflow:hidden + wider content == silently lost UI.
  for (const el of all) {
    const st = getComputedStyle(el);
    const ox = st.overflowX;
    const clipped = ox === 'hidden' || ox === 'clip';
    if (!clipped) continue;
    if (el.clientWidth <= 1) continue; // .sr-only and friends are 1px by design
    if (el.scrollWidth > el.clientWidth + 1) {
      push('clipped-content', 'error',
        describe(el) + ' overflow-x:hidden with scrollWidth=' + el.scrollWidth +
        ' > clientWidth=' + el.clientWidth + ' (' + (el.scrollWidth - el.clientWidth) + 'px unreachable)');
    }
  }

  // ---------- 3. type floor ----------
  const textEls = all.filter((el) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
  );
  for (const el of textEls) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) {
      push('type-floor', 'error', describe(el) + ' font-size=' + fs.toFixed(2) + 'px (floor 12px)');
    }
  }

  // ---------- 4. contrast (honest: only assert what we can resolve) ----------
  const parseColor = (c) => {
    if (!c) return null;
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Resolve the backdrop we can actually measure. Returns {color, via}.
  // via 'solid'   = opaque background-color on the element/ancestor  -> high confidence
  // via 'pseudo'  = painted by ::before/::after                      -> approximate
  // via 'gradient'= extracted from a gradient                        -> approximate
  // null          = unresolvable, so we stay SILENT rather than guess.
  const backdropAt = (st) => {
    const solid = parseColor(st.backgroundColor);
    if (solid && solid.a >= 0.85) return { color: solid, via: 'solid' };
    const img = st.backgroundImage;
    if (img && img !== 'none' && /gradient/.test(img)) {
      const first = img.match(/rgba?\\([^)]+\\)/);
      if (first) {
        const gc = parseColor(first[0]);
        if (gc && gc.a >= 0.85) return { color: gc, via: 'gradient' };
      }
    }
    return null;
  };

  const resolveBg = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const direct = backdropAt(getComputedStyle(node));
      if (direct) return direct;
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(node, pseudo);
        if (!ps || (ps.content === 'none' && ps.backgroundImage === 'none')) continue;
        const found = backdropAt(ps);
        if (found) return { color: found.color, via: 'pseudo' };
      }
      node = node.parentElement;
    }

    // Warm-glass cards paint their backdrop on absolutely-positioned layers that
    // are SIBLINGS of the content (e.g. .wx-sky gradients + a card scrim), so the
    // ancestor chain reads transparent. Find whatever visually covers the text.
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const layers = Array.from(document.querySelectorAll('body *')).filter((cand) => {
        if (cand === el || cand.contains(el) || el.contains(cand)) return false;
        const cs = getComputedStyle(cand);
        if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
        const cr = cand.getBoundingClientRect();
        if (cr.width < 8 || cr.height < 8) return false;
        return cx >= cr.left && cx <= cr.right && cy >= cr.top && cy <= cr.bottom;
      });
      // Later in DOM order paints on top among equally-positioned siblings.
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const found = backdropAt(getComputedStyle(layers[i]));
        if (found) return { color: found.color, via: 'overlay' };
      }
    }

    const bodyBg = backdropAt(getComputedStyle(document.body));
    if (bodyBg && bodyBg.via === 'solid') return bodyBg;
    return null;
  };

  for (const el of textEls) {
    const st = getComputedStyle(el);
    const fg = parseColor(st.color);
    const bg = resolveBg(el);
    if (!fg || !bg || fg.a === 0) continue;
    const cr = ratio(fg, bg.color);
    const w = parseInt(st.fontWeight, 10) || 400;
    const fs = parseFloat(st.fontSize);
    const large = fs >= 24 || (fs >= 18.66 && w >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      // ALWAYS advisory. The warm-glass backdrop can be painted by stacked
      // gradients, scrims and translucent layers that no static analysis can
      // resolve exactly, so a hard 'error' here would be a false positive.
      // The harsh visual critic is the final judge of contrast.
      push('contrast', 'warn',
        describe(el) + ' ratio~' + cr.toFixed(2) + ':1 needs ' + need + ':1 ' +
        '(fg ' + st.color + ' vs backdrop resolved via ' + bg.via + ' — CONFIRM BY EYE)');
    }
  }

  // ---------- 5. tap targets + accessible names ----------
  const interactives = Array.from(document.querySelectorAll(
    'button, a[href], [role="button"], [role="tab"], [role="switch"], input[type="checkbox"], input[type="radio"]'
  )).filter(isVisible);
  for (const el of interactives) {
    const cls = el.getAttribute('class') || '';
    if (/\\bhit-44\\b/.test(cls) || /after:-inset-|before:-inset-/.test(cls)) continue;
    if (getComputedStyle(el).display === 'contents') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      push('tap-target', 'error',
        describe(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' (need 44x44 or .hit-44)');
    }
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    if (!name) push('accessible-name', 'error', describe(el) + ' has no aria-label/title/text');
  }

  // ---------- 6. images ----------
  for (const img of Array.from(document.querySelectorAll('img')).filter(isVisible)) {
    if (!img.hasAttribute('alt')) push('img-alt', 'error', describe(img) + ' missing alt');
  }

  // ---------- 7. headings / landmarks sanity ----------
  if (document.querySelectorAll('h1').length === 0) {
    push('no-h1', 'warn', 'page has no <h1>');
  }

  return { problems, counts: { textEls: textEls.length, interactives: interactives.length, visible: all.length } };
})()
`;
export async function auditPage(page) {
  return page.evaluate(AUDIT_FN);
}

export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * One-shot review of a route. Returns a structured report + writes screenshots.
 */
export async function reviewRoute(browser, { baseUrl, route, role = "parent", viewport = "phone", outDir, themeMode, wallMode = "off", overrides = {}, settleMs = 1200, fullPage = true }) {
  const vp = typeof viewport === "string" ? VIEWPORTS[viewport] : viewport;
  if (!vp) throw new Error(`Unknown viewport: ${viewport}`);
  mkdirSync(outDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const { unstubbed } = await installSanitizedState(context, { role, mode: themeMode, wallMode, overrides });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.includes("fonts.g")) return; // intentionally blocked
    failedRequests.push(`${req.method()} ${url} — ${req.failure()?.errorText ?? "unknown"}`);
  });

  const target = `${baseUrl}${route}`;
  let navError = null;
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await sleep(settleMs);
  } catch (error) {
    navError = String(error).slice(0, 300);
  }

  const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?=&]/g, "-");
  const base = `${slug}__${role}__${vp.width}x${vp.height}${themeMode ? `__${themeMode}` : ""}`;
  // Viewport-only is the shot of record: it is the only one that shows
  // position:fixed chrome (the CapsuleNav dock) where a human would see it.
  // A fullPage shot renders fixed elements at the scroll origin, so it lies.
  const shot = `${outDir}/${base}.png`;
  const shotFull = `${outDir}/${base}__full.png`;
  let audit = { problems: [], counts: {} };
  try {
    if (!navError) audit = await auditPage(page);
    await page.screenshot({ path: shot });
    await page.screenshot({ path: shotFull, fullPage: true }).catch(() => {});
  } catch (error) {
    navError = navError ?? String(error).slice(0, 300);
  }

  await context.close();

  return {
    route, role, viewport: vp.label, themeMode: themeMode ?? "(default)",
    screenshot: shot, screenshotFull: shotFull,
    navError,
    consoleErrors: [...new Set(consoleErrors)],
    pageErrors: [...new Set(pageErrors)],
    failedRequests: [...new Set(failedRequests)],
    unstubbed: [...new Set(unstubbed)],
    problems: audit.problems,
    counts: audit.counts,
  };
}

/** Convenience: boot, review many route/role/viewport combos, boot down. Always tears down. */
export async function runReviews(targets, opts = {}) {
  const server = await bootServer();
  try {
    return await withBrowser(async (browser) => {
      const reports = [];
      for (const t of targets) reports.push(await reviewRoute(browser, { ...opts, ...t, baseUrl: server.baseUrl }));
      return { baseUrl: server.baseUrl, reports };
    });
  } finally {
    await server.stop();
  }
}

export { SAFE_PROBE_ENV };