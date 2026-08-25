import { getServiceConfig, getServiceStatus } from "./config";

// Per-service live health checks backing the "Test" buttons in
// Settings → Services & Keys. Every outbound call gets a 5s timeout; a
// service with unset required credentials short-circuits to not_configured.

export interface ServiceTestResult {
  ok: boolean;
  detail: string;
  ms: number;
}

const TIMEOUT_MS = 5000;

function timed(): { signal: AbortSignal; done(): number } {
  const start = Date.now();
  return { signal: AbortSignal.timeout(TIMEOUT_MS), done: () => Date.now() - start };
}

async function required(service: string, key: string): Promise<string | null> {
  const status = await getServiceStatus(service);
  const f = status.find((s) => s.key === key);
  if (f?.required && !f.set) return null;
  return getServiceConfig(service, key);
}

function errDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function testHa(): Promise<ServiceTestResult> {
  const t = timed();
  const host = await required("home_assistant", "HA_HOST");
  const token = await required("home_assistant", "HA_TOKEN");
  if (!host || !token) return { ok: false, detail: "not_configured", ms: t.done() };
  try {
    const { res } = await fetchJson(`${host.replace(/\/+$/, "")}/api/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { ok: false, detail: "reachable but token rejected (401)", ms: t.done() };
    if (res.status >= 500) return { ok: false, detail: `HA returned ${res.status}`, ms: t.done() };
    return { ok: true, detail: `reachable (${res.status})`, ms: t.done() };
  } catch (err) {
    return { ok: false, detail: errDetail(err), ms: t.done() };
  }
}

async function telegramTest(token: string | null): Promise<ServiceTestResult> {
  const t = timed();
  if (!token) return { ok: false, detail: "not_configured", ms: t.done() };
  try {
    const { res, body } = await fetchJson(`https://api.telegram.org/bot${token}/getMe`);
    if (res.ok && body?.ok) return { ok: true, detail: `bot @${body.result?.username ?? "?"}`, ms: t.done() };
    return { ok: false, detail: body?.description || `HTTP ${res.status}`, ms: t.done() };
  } catch (err) {
    return { ok: false, detail: errDetail(err), ms: t.done() };
  }
}

async function testTelegramAlert(): Promise<ServiceTestResult> {
  const chatId = await getServiceConfig("telegram_alert", "TELEGRAM_ALERT_CHAT_ID");
  const result = await telegramTest(await required("telegram_alert", "TELEGRAM_BOT_TOKEN"));
  if (result.ok && !chatId) return { ok: false, detail: "bot ok but TELEGRAM_ALERT_CHAT_ID not set", ms: result.ms };
  return result;
}

async function testGmail(): Promise<ServiceTestResult> {
  const t = timed();
  const user = await required("gmail_emergency", "GMAIL_USER");
  const pass = await required("gmail_emergency", "GMAIL_APP_PASSWORD");
  if (!user || !pass) return { ok: false, detail: "not_configured", ms: t.done() };
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: TIMEOUT_MS,
    });
    await transport.verify();
    return { ok: true, detail: `SMTP verified for ${user}`, ms: t.done() };
  } catch (err) {
    return { ok: false, detail: errDetail(err), ms: t.done() };
  }
}

async function testHermes(): Promise<ServiceTestResult> {
  const t = timed();
  const url = await getServiceConfig("hermes", "HERMES_API_URL");
  if (!url) return { ok: false, detail: "not_configured", ms: t.done() };
  const base = url.replace(/\/+$/, "");
  for (const path of ["/health", "/v1/models", "/"]) {
    try {
      const { res } = await fetchJson(`${base}${path}`);
      if (res.status < 500) return { ok: true, detail: `reachable via ${path} (${res.status})`, ms: t.done() };
    } catch {
      /* try next probe path */
    }
  }
  return { ok: false, detail: `unreachable at ${base}`, ms: t.done() };
}

async function testInstacart(): Promise<ServiceTestResult> {
  const t = timed();
  const key = await required("instacart", "INSTACART_API_KEY");
  if (!key) return { ok: false, detail: "not_configured", ms: t.done() };
  try {
    const res = await fetch(`https://connect.instacart.com/idp/v1/retailers`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, detail: `key rejected (${res.status})`, ms: t.done() };
    return { ok: true, detail: `accepted (${res.status})`, ms: t.done() };
  } catch (err) {
    return { ok: false, detail: errDetail(err), ms: t.done() };
  }
}

async function testThemealdb(): Promise<ServiceTestResult> {
  const t = timed();
  const key = (await getServiceConfig("themealdb", "MEALDB_KEY")) || "1";
  try {
    const { res, body } = await fetchJson(
      `https://www.themealdb.com/api/json/v1/${key}/search.php?s=chicken`
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, ms: t.done() };
    if (body?.meals === null) return { ok: false, detail: "key rejected (invalid key)", ms: t.done() };
    return { ok: true, detail: "catalog reachable", ms: t.done() };
  } catch (err) {
    return { ok: false, detail: errDetail(err), ms: t.done() };
  }
}

async function bearerReachable(
  service: string,
  key: string,
  url: string,
  headerName: string
): Promise<ServiceTestResult> {
  const t = timed();
  const apiKey = await getServiceConfig(service, key);
  if (!apiKey) return { ok: false, detail: "not_configured", ms: t.done() };
  try {
    const res = await fetch(url, {
      headers: { [headerName]: apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 500) return { ok: false, detail: `${url} returned ${res.status}`, ms: t.done() };
    return { ok: true, detail: `reachable (${res.status})`, ms: t.done() };
  } catch (err) {
    return { ok: false, detail: errDetail(err), ms: t.done() };
  }
}

/** Registry-driven entry point. */
export async function runServiceTest(service: string): Promise<ServiceTestResult> {
  switch (service) {
    case "home_assistant": return testHa();
    case "telegram_alert": return testTelegramAlert();
    case "telegram_mirror": return telegramTest(await required("telegram_mirror", "TELEGRAM_MIRROR_BOT_TOKEN"));
    case "gmail_emergency": return testGmail();
    case "hermes": return testHermes();
    case "instacart": return testInstacart();
    case "themealdb": return testThemealdb();
    case "composio": return bearerReachable("composio", "COMPOSIO_API_KEY", "https://backend.composio.dev/api/v1/actions", "X-API-Key");
    case "greenlight":
    case "khanacademy": {
      // Stored-only integrations: report configuration state honestly.
      const status = await getServiceStatus(service);
      const anySet = status.some((f) => f.set);
      return { ok: anySet, detail: anySet ? "stored (no live test yet)" : "not_configured", ms: 0 };
    }
    default:
      return { ok: false, detail: "unknown_service", ms: 0 };
  }
}
