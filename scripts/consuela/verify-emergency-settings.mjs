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
const SANITIZED_MEMBERS = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🧑", age: 38, created: "Feb 2024", avatarSize: "md", glow: false },
  { id: 2, name: "Aurora", role: "child", emoji: "🧒", age: 7, created: "Mar 2024", avatarSize: "md", glow: false },
];
const sensitiveRequests = [];
const fontRequests = [];
let baseUrl = "";
let server = null;
let browser = null;
let logDir = "";
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

function authUser(role) {
  if (role === "parent") return SANITIZED_MEMBERS[0];
  if (role === "child" || role === "pet") return { ...SANITIZED_MEMBERS[1], role };
  return null;
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSanitizedState(context, role) {
  const user = authUser(role);
  await context.addInitScript((sanitizedUser) => {
    localStorage.clear();
    if (sanitizedUser) localStorage.setItem("consuela-auth-user", JSON.stringify(sanitizedUser));
  }, user);
  await installFontRouteGuards(context, fontRequests);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const body = request.postData();
    if (body && /"(?:pin|token|secret|api[_-]?key)"\s*:/i.test(body)) {
      sensitiveRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === "/api/auth/login" || pathname === "/api/auth/quick-login") {
      sensitiveRequests.push(`${request.method()} ${pathname}`);
      await fulfillJson(route, { error: "probe_signin_disabled" }, 423);
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

function bootDevServer(port, appUrl, logDir) {
  rmSync(path.join(REPO_ROOT, ".next", "dev"), { recursive: true, force: true });
  const logPath = path.join(logDir, "next-dev.log");
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

async function stopDevServer(server) {
  if (!server) return;
  const { child, log } = server;
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

function serverLogTail(logPath) {
  try {
    return readFileSync(logPath, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "(no server log)";
  }
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

async function probeRole(browser, role) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await installSanitizedState(context, role);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/emergency`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("heading", { level: 1, name: "Emergency" }).waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("link", { name: "Call 911" }).waitFor({ state: "visible", timeout: 60_000 });

    const links = page.locator('a[href="/settings/safety"]');
    await links.first().waitFor({ state: "visible", timeout: 60_000 });
    const count = await links.count();
    assert.ok(count >= 1, `${role ?? "guest"} Emergency should expose a Safety action`);
    for (let index = 0; index < count; index += 1) {
      assert.equal(await links.nth(index).getAttribute("href"), "/settings/safety");
    }

    if (role === "parent") {
      await page.getByText("Add or manage emergency contacts to get started.").waitFor({ state: "visible" });
      const labels = await links.allTextContents();
      assert.ok(labels.some((label) => /Add contacts/i.test(label)), "parent should see Add contacts");
      assert.ok(labels.some((label) => /Add or manage contacts/i.test(label)), "parent should see manage guidance");
    } else {
      await page.getByText("Ask a parent to add or manage emergency contacts.").waitFor({ state: "visible" });
      const labels = await links.allTextContents();
      assert.ok(labels.every((label) => /Open safety settings/i.test(label)), `${role ?? "guest"} should see neutral Safety guidance`);
    }

    await links.first().click();
     await page.waitForURL("**/settings/safety", { timeout: 30_000 });
     await waitForSettingsSectionReady(
       () => readSectionSurface(page, "safety"),
       { section: "safety", readyText: "Emergency reference", timeoutMs: 60_000, intervalMs: 50 },
     );
     assert.match(await page.locator('[data-settings-surface="true"]').textContent() ?? "", /Emergency reference/i);
    console.log(`PASS ${role ?? "guest"}: Emergency role copy and /settings/safety navigation`);
  } finally {
    await context.close();
  }
}

async function main() {
  logDir = mkdtempSync(path.join(os.tmpdir(), "emergency-settings-test-"));
  cleanupProbe = createIdempotentProbeCleanup({
    browser: { close: async () => { if (browser) await browser.close(); } },
    server: true,
    stopServer: async () => { await stopDevServer(server); },
    removeTemp: () => { rmSync(logDir, { recursive: true, force: true }); },
  });
  installProbeSignalHandlers(cleanupProbe);
  try {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = bootDevServer(port, baseUrl, logDir);
    await waitForReady(server);
    browser = await chromium.launch({ headless: true });
    for (const role of ["parent", "child", "pet", null]) {
      await probeRole(browser, role);
    }
     assert.deepEqual(sensitiveRequests, [], "probe must not send auth/PIN/credential requests");
     assert.deepEqual(fontRequests, [], "probe must not attempt external Google font requests");
    console.log("ALL EMERGENCY-SETTINGS CHECKS PASSED");
  } catch (error) {
    console.error("FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    console.error(serverLogTail(server?.logPath ?? path.join(logDir, "next-dev.log")));
    process.exitCode = 1;
  } finally {
    await cleanupProbe();
  }
}

await main();
