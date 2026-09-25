import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { finished } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProbeEnv } from "./probe-env.mjs";
import {
  createIdempotentProbeCleanup,
  installFontRouteGuards,
  installProbeSignalHandlers,
  waitForSettingsSectionReady,
} from "./probe-helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEEP_ARTIFACTS = process.env.KEEP_SETTINGS_PROBE_ARTIFACTS === "1";
let runDir = "";
let logPath = "";
let baseUrl = "";
const PARENT_SECTIONS = ["me", "family", "safety", "appearance", "home", "system"];
const CHILD_SECTIONS = ["me", "safety", "appearance"];
const PARENT_ONLY_SECTIONS = ["family", "home", "system"];
const SECTION_READY = {
  me: "Your profile",
  family: "Family members",
  safety: "Emergency reference",
  appearance: "Theme & accent",
  home: "Layout & display",
  system: "Integrations",
};
const SANITIZED_MEMBERS = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🧑", age: 38, created: "Feb 2024", avatarSize: "md", glow: false },
  { id: 2, name: "Aurora", role: "child", emoji: "🧒", age: 7, created: "Mar 2024", avatarSize: "md", glow: false },
];
const results = [];
const sensitiveRequests = [];
const fontRequests = [];
let server = null;
let browser = null;
let cleanupProbe = async () => {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function getFreePort() {
  return new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      const port = typeof address === "object" && address ? address.port : null;
      reservation.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("could not reserve an ephemeral port"));
      });
    });
  });
}

function check(name, ok, detail = "") {
  const passed = Boolean(ok);
  results.push({ name, ok: passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function authUser(role) {
  return role === "parent"
    ? { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🧑", color: "amber", avatarSize: "md", glow: false, age: 38 }
    : { id: 2, name: "Aurora", role: "child", emoji: "🧒", color: "violet", avatarSize: "md", glow: false, age: 7 };
}

function themeConfig(mode, contrastBoost) {
  return {
    mode,
    accentColor: "violet",
    contrastBoost,
    accentHex: {
      selected: "#7c6ff7",
      glow: "rgba(124,111,247,0.28)",
      button: "#7c6ff7",
      border: "rgba(124,111,247,0.35)",
    },
  };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSanitizedState(context, { role, mode, contrastBoost = false, wallMode = "off" }) {
  const user = authUser(role);
  assert.equal("pin" in user, false);
  await context.addInitScript(
    ({ sanitizedUser, theme, wall }) => {
      localStorage.clear();
      localStorage.setItem("consuela-auth-user", JSON.stringify(sanitizedUser));
      localStorage.setItem("home-ai-theme-config", JSON.stringify(theme));
      localStorage.setItem("consuela-wall-mode", wall);
    },
    { sanitizedUser: user, theme: themeConfig(mode, contrastBoost), wall: wallMode },
  );
  await installFontRouteGuards(context, fontRequests);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const body = request.postData();
    if (body && /"(?:pin|token|secret|api[_-]?key)"\s*:/i.test(body)) {
      sensitiveRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === "/api/auth/login" || pathname === "/api/auth/quick-login") {
      sensitiveRequests.push(`${request.method()} ${pathname}`);
      await fulfillJson(route, { error: "probe_signin_disabled" }, 423);
      return;
    }
    if (pathname === "/api/auth/logout") {
      await fulfillJson(route, { ok: true });
      return;
    }
    if (pathname === "/api/members/admin") {
      await fulfillJson(route, { ok: true, source: "live", members: SANITIZED_MEMBERS });
      return;
    }
    if (pathname === "/api/emergency-contacts") {
      await fulfillJson(route, { ok: true, contactsSource: "live", contacts: [] });
      return;
    }
    if (pathname === "/api/google/state") {
      await fulfillJson(route, {
        ok: true,
        connected: false,
        account_email: null,
        granted_at: null,
        revoked_at: null,
        expires_at: null,
        scope: null,
        minutes_until_expiry: null,
      });
      return;
    }
    if (pathname === "/api/google/calendars") {
      await fulfillJson(route, { ok: true, calendars: [] });
      return;
    }
    if (pathname === "/api/google/sync-state") {
      await fulfillJson(route, { ok: true, connected: false, status: "unconnected" });
      return;
    }
    if (pathname === "/api/ha/notify-targets") {
      await fulfillJson(route, { ok: true, targets: [], telegramAvailable: false });
      return;
    }
    if (pathname === "/api/ha/notify-prefs") {
      await fulfillJson(route, { ok: true, prefs: { briefing: false, weather: false, calendar: false } });
      return;
    }
    if (pathname === "/api/admin/version") {
      await fulfillJson(route, {
        ok: true,
        built_at: { hash: "probe", short: "probe", message: "Sanitized probe build", date: "2026-01-01T00:00:00.000Z" },
        latest_remote: null,
        update_available: false,
      });
      return;
    }
    await fulfillJson(route, { ok: true, data: [], items: [], members: SANITIZED_MEMBERS, contacts: [] });
  });
}

async function waitForReady(server, deadlineMs = 240_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (server.childError) throw server.childError;
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`dev server exited before readiness (code=${server.child.exitCode}, signal=${server.child.signalCode})`);
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
      let readyLog = false;
      try {
        readyLog = /Ready in/i.test(readFileSync(server.logPath, "utf8"));
      } catch {}
      if (response.status === 200 && readyLog && server.child.exitCode === null && server.child.signalCode === null) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("dev server did not become ready");
}

function bootDevServer(port, appUrl) {
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: buildProbeEnv(appUrl),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const server = { child, log, logPath, childError: null };
  child.once("error", (error) => { server.childError = error; });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return server;
}

async function finishLogStream(log) {
  if (log.closed) return;
  log.end();
  await finished(log);
}

async function stopDevServer(instance) {
  if (!instance) return;
  const { child, log } = instance;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
    const timedOut = await Promise.race([exited.then(() => false), sleep(5000).then(() => true)]);
    if (timedOut && child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
      await Promise.race([once(child, "exit"), sleep(2000)]);
    }
  }
  await finishLogStream(log);
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
}

function serverLogTail(serverLogPath) {
  try {
    return readFileSync(serverLogPath, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "(no server log)";
  }
}

async function openSettings(page, route = "/settings") {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("[data-settings-page]", { state: "attached", timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector("[data-settings-page]")?.getAttribute("data-settings-hydrated") === "true",
    null,
    { timeout: 60_000 },
  );
}

function readSectionSurface(page, section) {
  return page.evaluate((routeSection) => {
    const surface = document.querySelector('[data-settings-surface][data-section]');
    return {
      path: window.location.pathname,
      section: surface?.getAttribute("data-section"),
      loading: Boolean(surface?.querySelector('[data-settings-section-loading="true"]')),
      text: surface?.textContent ?? "",
    };
  }, section);
}

async function activateSection(page, section) {
  await page.locator(`nav[aria-label="Settings sections"] a[href="/settings/${section}"]`).click();
  await page.waitForURL(`**/settings/${section}`, { timeout: 60_000 });
  await waitForSettingsSectionReady(
    () => readSectionSurface(page, section),
    { section, readyText: SECTION_READY[section], timeoutMs: 60_000, intervalMs: 50 },
  );
}

async function openLockedSection(page, section) {
  await page.goto(`${baseUrl}/settings/${section}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(
    (routeSection) => {
      const surface = document.querySelector('[data-settings-surface][data-settings-role="child"]');
      return Boolean(
        surface
        && !surface.querySelector('[data-settings-section-loading="true"]')
        && /not available/i.test(surface.textContent || "")
        && window.location.pathname === `/settings/${routeSection}`
      );
    },
    section,
    { timeout: 60_000 },
  );
}

async function inspectSettingsOverflow(page) {
  return page.evaluate(() => {
    const content = document.querySelector('[data-settings-content="true"]');
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const rootOverflow = Math.max(root.scrollWidth - viewportWidth, document.body.scrollWidth - viewportWidth);
    if (!content) {
      return { missing: true, rootOverflow, contentOverflow: 0, offenderCount: 0, offenders: [] };
    }
    const elements = [content, ...content.querySelectorAll("*")];
    const offenders = elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      if (!visible || (rect.left >= -1 && rect.right <= viewportWidth + 1)) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        marker: element.getAttribute("data-settings-overflow-regression"),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }];
    });
    const contentRect = content.getBoundingClientRect();
    const contentOverflow = Math.max(0, contentRect.right - viewportWidth, -contentRect.left);
    return {
      missing: false,
      rootOverflow,
      contentOverflow,
      offenderCount: offenders.length,
      offenders: offenders.slice(0, 5),
    };
  });
}

async function launcherMetrics(page) {
  const overflow = await inspectSettingsOverflow(page);
  const metrics = await page.evaluate(() => {
    const launcher = document.querySelector('[data-settings-launcher="true"]');
    const grid = launcher?.querySelector('[data-settings-launcher-grid="true"]');
    const cards = Array.from(launcher?.querySelectorAll("a.widget-card") ?? []);
    const rects = cards.map((card) => card.getBoundingClientRect());
    const firstTop = rects[0]?.top ?? 0;
    const columns = rects.filter((rect) => Math.abs(rect.top - firstTop) <= 2).length;
    const html = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    return {
      count: cards.length,
      hrefs: cards.map((card) => card.getAttribute("href")),
      columns,
      gridDisplay: grid ? getComputedStyle(grid).display : null,
      minCardHeight: rects.length ? Math.min(...rects.map((rect) => rect.height)) : 0,
      minCardWidth: rects.length ? Math.min(...rects.map((rect) => rect.width)) : 0,
      composition: cards.every((card) => (
        card.parentElement?.parentElement?.tagName === "UL"
        && card.querySelector("h2")?.textContent?.trim()
        && card.querySelector("[data-settings-icon]")?.getAttribute("aria-hidden") === "true"
        && card.querySelector("[data-settings-status]")?.textContent?.trim()
        && card.querySelector("[data-settings-chevron]")?.getAttribute("aria-hidden") === "true"
      )),
      role: document.querySelector("[data-settings-page]")?.getAttribute("data-settings-role"),
      theme: html.getAttribute("data-theme"),
      contrast: html.getAttribute("data-contrast"),
      wall: html.getAttribute("data-wall"),
      reducedMotion: reducedMotion.matches,
      reducedMotionStyles: cards.every((card) => {
        const style = getComputedStyle(card);
        return style.transitionDuration === "0s" && style.animationDuration === "0s" && style.transform === "none";
      }),
    };
  });
  return {
    ...metrics,
    overflow: overflow.rootOverflow,
    contentOverflow: overflow.contentOverflow,
    offenderCount: overflow.offenderCount,
    offenders: overflow.offenders,
    overflowMissing: overflow.missing,
  };
}

async function screenshot(page, name) {
  if (!KEEP_ARTIFACTS) return;
  await page.screenshot({ path: path.join(runDir, `${name}.png`), fullPage: true });
}

async function verifyOverflowRegression(page) {
  await page.evaluate(() => {
    const content = document.querySelector('[data-settings-content="true"]');
    const marker = document.createElement("div");
    marker.dataset.settingsOverflowRegression = "true";
    marker.style.width = `${document.documentElement.clientWidth + 96}px`;
    marker.style.height = "2px";
    marker.style.flexShrink = "0";
    content?.appendChild(marker);
  });
  const detected = await inspectSettingsOverflow(page);
  await page.evaluate(() => {
    document.querySelector('[data-settings-overflow-regression="true"]')?.remove();
  });
  const clean = await inspectSettingsOverflow(page);
  check(
    "desktop: deliberate clipped descendant overflow is detected",
    detected.offenderCount > 0
      && detected.offenders.some((offender) => offender.marker === "true"),
    `offenders=${detected.offenderCount}`,
  );
  check(
    "desktop: overflow probe returns clean after removing the regression",
    clean.offenderCount === 0 && clean.contentOverflow <= 1,
    `offenders=${clean.offenderCount}`,
  );
}

async function checkLauncher(page, label, expectedSections, expectedColumns, expectedTheme, expectedContrast, expectedWall) {
  const metrics = await launcherMetrics(page);
  check(`${label}: ${expectedSections.length} role-filtered category links`, metrics.count === expectedSections.length, `count=${metrics.count}`);
  check(
    `${label}: approved category order and hrefs`,
    JSON.stringify(metrics.hrefs) === JSON.stringify(expectedSections.map((section) => `/settings/${section}`)),
    metrics.hrefs.join(","),
  );
  check(
    `${label}: ${expectedColumns}-column responsive grid`,
    metrics.gridDisplay === "grid" && metrics.columns === expectedColumns,
    `display=${metrics.gridDisplay} columns=${metrics.columns}`,
  );
  check(
    `${label}: card composition is complete`,
    metrics.composition && metrics.minCardHeight >= 176,
    `complete=${metrics.composition} minHeight=${Math.round(metrics.minCardHeight)}px`,
  );
  check(
    `${label}: no horizontal overflow in content or visible descendants`,
    !metrics.overflowMissing
      && metrics.overflow <= 1
      && metrics.contentOverflow <= 1
      && metrics.offenderCount === 0,
    `root=${metrics.overflow}px content=${metrics.contentOverflow}px offenders=${metrics.offenderCount}`,
  );
  check(
    `${label}: expected theme state`,
    metrics.theme === expectedTheme && (expectedContrast ? metrics.contrast === "boost" : metrics.contrast === null),
    `theme=${metrics.theme} contrast=${metrics.contrast}`,
  );
  if (expectedWall) {
    check(
      `${label}: wall profile and 64px category controls`,
      metrics.wall === "true" && metrics.minCardWidth >= 64 && metrics.minCardHeight >= 64,
      `wall=${metrics.wall} min=${Math.round(metrics.minCardWidth)}×${Math.round(metrics.minCardHeight)}px`,
    );
  }
  if (label === "desktop") {
    check(
      `${label}: reduced-motion contract`,
      metrics.reducedMotion && metrics.reducedMotionStyles,
      `media=${metrics.reducedMotion} styles=${metrics.reducedMotionStyles}`,
    );
  }
  await screenshot(page, label);
  return metrics;
}

async function probeWall(browser) {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    isMobile: true,
    hasTouch: true,
  });
  const pageErrors = [];
  try {
    await installSanitizedState(context, { role: "parent", mode: "dark", wallMode: "on" });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await openSettings(page);
    await page.waitForFunction(() => document.documentElement.dataset.wall === "true", null, { timeout: 60_000 });
    await checkLauncher(page, "wall", PARENT_SECTIONS, 2, "dark", false, true);

     await activateSection(page, "home");
     const wallRoute = await page.evaluate(() => {
      const surface = document.querySelector('[data-settings-surface="true"]');
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const controls = Array.from(surface?.querySelectorAll(
        'button, a, [role="button"], [role="radio"], input:not(.sr-only):not([type="hidden"]), select, textarea, label:has(> input.sr-only)',
      ) ?? []).filter(visible);
      const dimensions = controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      const back = surface?.querySelector('a[href="/settings"]');
      const backRect = back?.getBoundingClientRect();
      return {
        controlCount: dimensions.length,
        minWidth: dimensions.length ? Math.min(...dimensions.map((item) => item.width)) : 0,
        minHeight: dimensions.length ? Math.min(...dimensions.map((item) => item.height)) : 0,
        backWidth: backRect?.width ?? 0,
        backHeight: backRect?.height ?? 0,
        overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth),
      };
    });
    const wallOverflow = await inspectSettingsOverflow(page);
    check(
      "wall: focused-section controls meet the 64px floor",
      wallRoute.controlCount > 0 && wallRoute.minWidth >= 64 && wallRoute.minHeight >= 64,
      `controls=${wallRoute.controlCount} min=${Math.round(wallRoute.minWidth)}×${Math.round(wallRoute.minHeight)}px`,
    );
    check(
      "wall: Back to Settings is a real 64px link",
      wallRoute.backWidth >= 64 && wallRoute.backHeight >= 64,
      `${Math.round(wallRoute.backWidth)}×${Math.round(wallRoute.backHeight)}px`,
    );
    check(
      "wall: focused section content and descendants have no horizontal overflow",
      wallOverflow.rootOverflow <= 1
        && wallOverflow.contentOverflow <= 1
        && wallOverflow.offenderCount === 0,
      `root=${wallOverflow.rootOverflow}px content=${wallOverflow.contentOverflow}px offenders=${wallOverflow.offenderCount}`,
    );

      await activateSection(page, "appearance");
      check("wall: category navigation switches sections", await page.getByRole("heading", { level: 1, name: "Appearance" }).isVisible());
    await page.getByRole("link", { name: "Back to Settings" }).click();
    await page.waitForURL("**/settings", { timeout: 30_000 });
    await page.locator('[data-settings-launcher="true"]').waitFor({ state: "visible" });
    check("wall: Back to Settings returns to the launcher", await page.locator('[data-settings-launcher="true"]').isVisible());
  } catch (error) {
    check("wall probe completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    check("wall: no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    await context.close();
  }
}

async function probePhone(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const pageErrors = [];
  try {
    await installSanitizedState(context, { role: "child", mode: "light", wallMode: "off" });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await openSettings(page);
    const metrics = await checkLauncher(page, "phone", CHILD_SECTIONS, 1, "light", false, false);
    check("phone: child launcher exposes only safe categories", metrics.role === "child" && !metrics.hrefs.includes("/settings/family") && !metrics.hrefs.includes("/settings/system"));

    for (const section of PARENT_ONLY_SECTIONS) {
      await openLockedSection(page, section);
      const state = await page.evaluate((routeSection) => {
        const surface = document.querySelector('[data-settings-surface="true"]');
        return {
          path: window.location.pathname,
          expectedPath: `/settings/${routeSection}`,
          unavailable: /not available/i.test(surface?.textContent ?? ""),
          overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth),
        };
      }, section);
      const overflow = await inspectSettingsOverflow(page);
      check(
        `phone: child is blocked from /settings/${section}`,
        state.path === state.expectedPath
          && state.unavailable
          && overflow.rootOverflow <= 1
          && overflow.contentOverflow <= 1
          && overflow.offenderCount === 0,
        `path=${state.path} unavailable=${state.unavailable} offenders=${overflow.offenderCount}`,
       );
     }

     await page.getByRole("link", { name: "Back to Settings" }).click();
     await page.waitForURL("**/settings", { timeout: 30_000 });
     const expectedCopy = {
      me: "Your profile",
      safety: "Emergency reference",
      appearance: "Theme & accent",
    };
     for (const section of CHILD_SECTIONS) {
       await activateSection(page, section);
       const state = await page.evaluate((routeSection) => {
        const surface = document.querySelector('[data-settings-surface="true"]');
        return {
          section: surface?.getAttribute("data-section"),
          unavailable: /not available/i.test(surface?.textContent ?? ""),
          overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth),
          text: surface?.textContent ?? "",
        };
      }, section);
      const overflow = await inspectSettingsOverflow(page);
      check(
        `phone: child can open ${section}`,
        state.section === section
          && !state.unavailable
          && state.text.includes(expectedCopy[section])
          && overflow.rootOverflow <= 1
          && overflow.contentOverflow <= 1
          && overflow.offenderCount === 0,
        `section=${state.section} unavailable=${state.unavailable} offenders=${overflow.offenderCount}`,
      );
    }
  } catch (error) {
    check("phone probe completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    check("phone: no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    await context.close();
  }
}

const SYSTEM_CHUNK_PATTERN = /SystemSettingsSection|GoogleConnectCard|AiModelsCard|HaNotificationsCard|ServicesKeysCard|MuseApiCard/;
const SECTION_CHUNK_PATTERNS = [
  ["me", /MeSettingsSection/],
  ["family", /FamilySettingsSection/],
  ["safety", /SafetySettingsSection/],
  ["appearance", /AppearanceSettingsSection/],
  ["home", /HomeSettingsSection/],
  ["system", /SystemSettingsSection/],
];
const SYSTEM_API_PREFIXES = [
  "/api/admin/version",
  "/api/ai/",
  "/api/google/",
  "/api/ha/",
  "/api/muse/",
  "/api/services/",
];

async function verifyMeIsolation(browser, pageErrors) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  const systemApiRequests = [];
  const systemChunkRequests = new Map();
  const sectionChunkRequests = new Map();
  const recordSystemChunk = (url, body = "") => {
    const match = SYSTEM_CHUNK_PATTERN.exec(body);
    const index = match?.index ?? -1;
    const snippet = index >= 0 ? body.slice(Math.max(0, index - 100), index + 180).replace(/\s+/g, " ") : "url-match";
    systemChunkRequests.set(url, snippet);
  };
  const recordSectionChunk = (url, body = "") => {
    for (const [section, pattern] of SECTION_CHUNK_PATTERNS) {
      if (pattern.test(url) || pattern.test(body)) {
        sectionChunkRequests.set(section, url);
        break;
      }
    }
  };
  const responseReads = [];
  try {
    await installSanitizedState(context, { role: "parent", mode: "dark", contrastBoost: true, wallMode: "off" });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (SYSTEM_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
        systemApiRequests.push(pathname);
      }
    });
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      const url = response.url();
      if (SYSTEM_CHUNK_PATTERN.test(url)) {
        recordSystemChunk(url);
        recordSectionChunk(url);
        return;
      }
      responseReads.push(response.text().then((body) => {
        if (SYSTEM_CHUNK_PATTERN.test(body)) recordSystemChunk(url, body);
        recordSectionChunk(url, body);
      }).catch(() => undefined));
    });
     await page.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
     await page.locator('[data-settings-launcher="true"]').waitFor({ state: "visible", timeout: 60_000 });
      await page.locator('[data-settings-section="me"]').click();
      await page.waitForURL("**/settings/me", { timeout: 60_000 });
      await waitForSettingsSectionReady(
         () => readSectionSurface(page, "me"),
         { section: "me", readyText: SECTION_READY.me, timeoutMs: 60_000, intervalMs: 50 },
       );
     await page.waitForLoadState("networkidle", { timeout: 60_000 });
    await Promise.all(responseReads);
    const otherSectionChunks = Array.from(sectionChunkRequests.entries()).filter(([section]) => section !== "me");
    check(
      "desktop: launcher navigation loads no other section chunks",
      otherSectionChunks.length === 0,
      otherSectionChunks.map(([section, url]) => `${section}:${url}`).join(" | "),
    );
    check(
      "desktop: Me navigation issues no System-only API request",
      systemApiRequests.length === 0,
      systemApiRequests.join(", "),
    );
    check(
      "desktop: Me navigation loads no SystemSettingsSection or integration chunks",
      systemChunkRequests.size === 0,
      Array.from(systemChunkRequests.entries()).map(([url, snippet]) => `${url} :: ${snippet}`).join(" | "),
    );
  } finally {
    await context.close();
  }
}

async function probeDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  const pageErrors = [];
  try {
    await installSanitizedState(context, { role: "parent", mode: "dark", contrastBoost: true, wallMode: "off" });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await openSettings(page);
    await checkLauncher(page, "desktop", PARENT_SECTIONS, 2, "dark", true, false);
    await verifyMeIsolation(browser, pageErrors);
    await verifyOverflowRegression(page);

    const meCard = page.locator('[data-settings-section="me"]');
    await meCard.focus();
    await page.keyboard.press("Tab");
    const keyboardState = await page.evaluate(() => {
      const active = document.activeElement;
      const style = active ? getComputedStyle(active) : null;
      return {
        target: active?.getAttribute("data-settings-section"),
        focusVisible: active?.matches(":focus-visible") ?? false,
        outlineWidth: style ? Number.parseFloat(style.outlineWidth) || 0 : 0,
        outlineStyle: style?.outlineStyle ?? "none",
        boxShadow: style?.boxShadow ?? "none",
      };
    });
    check(
      "desktop: keyboard Tab advances with a visible focus-visible ring",
      keyboardState.target === "family"
        && keyboardState.focusVisible
        && ((keyboardState.outlineWidth >= 2 && keyboardState.outlineStyle !== "none") || keyboardState.boxShadow !== "none"),
      `focus=${keyboardState.target} focusVisible=${keyboardState.focusVisible} outline=${keyboardState.outlineWidth}px shadow=${keyboardState.boxShadow}`,
    );
      await page.keyboard.press("Enter");
      await page.waitForURL("**/settings/family", { timeout: 60_000 });
      await waitForSettingsSectionReady(
        () => readSectionSurface(page, "family"),
         { section: "family", readyText: SECTION_READY.family, timeoutMs: 60_000, intervalMs: 50 },
       );
     check("desktop: keyboard Enter opens the focused category", await page.getByRole("heading", { level: 1, name: "Family" }).isVisible());
    const backLink = page.getByRole("link", { name: "Back to Settings" });
    await backLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/settings", { timeout: 30_000 });
    await page.locator('[data-settings-launcher="true"]').waitFor({ state: "visible" });
    check("desktop: keyboard Back returns to the launcher", await page.locator('[data-settings-launcher="true"]').isVisible());

    const expectedCopy = {
      me: "Your profile",
      family: "Family members",
      safety: "Emergency reference",
      appearance: "Theme & accent",
      home: "Layout & display",
      system: "Integrations",
    };
     for (const section of PARENT_SECTIONS) {
       await activateSection(page, section);
       const state = await page.evaluate((routeSection) => {
        const surface = document.querySelector('[data-settings-surface="true"]');
        return {
          section: surface?.getAttribute("data-section"),
          unavailable: /not available/i.test(surface?.textContent ?? ""),
          overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth),
          text: surface?.textContent ?? "",
        };
      }, section);
      const overflow = await inspectSettingsOverflow(page);
      check(
        `desktop: parent ${section} renders without content overflow`,
        state.section === section
          && !state.unavailable
          && state.text.includes(expectedCopy[section])
          && overflow.rootOverflow <= 1
          && overflow.contentOverflow <= 1
          && overflow.offenderCount === 0,
        `section=${state.section} unavailable=${state.unavailable} offenders=${overflow.offenderCount}`,
      );
    }
  } catch (error) {
    check("desktop probe completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    check("desktop: no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    await context.close();
  }
}

async function main() {
  runDir = mkdtempSync(path.join(os.tmpdir(), "settings-launcher-probe-"));
  logPath = path.join(runDir, "next-dev.log");
  cleanupProbe = createIdempotentProbeCleanup({
    browser: { close: async () => { if (browser) await browser.close(); } },
    server: true,
    stopServer: async () => { await stopDevServer(server); },
    removeTemp: () => {
      if (KEEP_ARTIFACTS) console.log(`SETTINGS_PROBE_ARTIFACTS=${runDir}`);
      else rmSync(runDir, { recursive: true, force: true });
    },
  });
  installProbeSignalHandlers(cleanupProbe);
  try {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = bootDevServer(port, baseUrl);
    await waitForReady(server);
    browser = await chromium.launch({ headless: true });
    await probeWall(browser);
    await probePhone(browser);
    await probeDesktop(browser);
     check("probe used sanitized identities and made zero PIN/auth requests", sensitiveRequests.length === 0, sensitiveRequests.join(", "));
     check("probe made zero external Google font requests", fontRequests.length === 0, fontRequests.join(", "));
  } catch (error) {
    check("probe run completed", false, error instanceof Error ? error.message : String(error));
    console.error(serverLogTail(server?.logPath ?? logPath));
  } finally {
    await cleanupProbe();
  }
  const failures = results.filter((result) => !result.ok);
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : "CHECKS FAILED"} (${results.length - failures.length}/${results.length})`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
