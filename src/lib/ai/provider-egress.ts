// Provider egress policy (2026-10-03) — the ONE place that decides where a
// stored provider key is allowed to travel, plus the redaction used by every
// provider-facing error path (models listing, the settings probe, and the
// parent-facing AI health panel).
//
// THE BUG THIS EXISTS FOR: `POST /api/ai/models` used to accept a caller-supplied
// `baseUrl` and pair it with the DECRYPTED key of a stored provider, so an
// admin-authenticated caller could post `{ providerId: "1", baseUrl: "<any host>" }`
// and have the real provider key land on a host of their choosing — a key
// exfiltration primitive (and a way to burn the key against a hostile endpoint).
//
// THE RULE: a STORED key only ever goes to the endpoint its own provider record
// defines. A caller may supply an endpoint ONLY together with the credential
// that belongs to it (the unsaved-draft flow), never instead of the stored one.
// A stored provider's endpoint is therefore never negotiable by the caller.
//
// Deliberately NOT an SSRF blocklist: family deployments legitimately point at
// LAN hosts (`http://router.internal:8080`), so private IPs stay allowed. The
// protection is key→endpoint BINDING, not host geography.

export interface ParsedBaseUrl {
  /** Absolute http(s) origin+path, no query/hash, no trailing slash. */
  url: string;
  /** Lowercased `scheme://host[:port]` with the default port collapsed away. */
  host: string;
}

export type KeySource = "posted" | "stored" | "none";

export interface EgressTarget {
  ok: true;
  baseUrl: string;
  key: string | null;
  keySource: KeySource;
}

export interface EgressRefusal {
  ok: false;
  status: number;
  error: EgressErrorCode;
}

export type EgressErrorCode =
  | "base_url_required"
  | "invalid_base_url"
  | "provider_not_found"
  | "provider_endpoint_unusable"
  | "stored_key_endpoint_conflict";

export type EgressDecision = EgressTarget | EgressRefusal;

export interface EgressProvider {
  id: string;
  baseUrl: string;
  apiKey?: string | null;
}

const MAX_URL_LENGTH = 2048;

/** Validate a caller- or store-supplied endpoint. Returns null for anything
 *  that isn't a plain absolute http(s) URL (no embedded credentials — a secret
 *  in the URL is a secret in a log line). */
export function parseProviderBaseUrl(raw: unknown): ParsedBaseUrl | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  url.search = "";
  url.hash = "";
  return {
    url: url.toString().replace(/\/+$/, ""),
    host: `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`,
  };
}

function pathOf(url: string): string {
  const slash = url.indexOf("/", url.indexOf("://") + 3);
  return slash === -1 ? "" : url.slice(slash);
}

/** Endpoint equality for key-binding purposes. Host+port must match exactly
 *  (no suffix games: `api.b.ai` ≠ `api.b.ai.attacker.example`) and the path must
 *  match, tolerating the house "…/v1" paste form that `normalizeBaseUrl` also
 *  tolerates. */
export function isSameProviderEndpoint(a: unknown, b: unknown): boolean {
  const left = parseProviderBaseUrl(a);
  const right = parseProviderBaseUrl(b);
  if (!left || !right) return false;
  if (left.host !== right.host) return false;
  return pathOf(left.url).replace(/\/v1$/, "") === pathOf(right.url).replace(/\/v1$/, "");
}

/**
 * Decide the endpoint + credential for one outbound provider call.
 *
 * - No `providerId` → unsaved draft: the caller's own endpoint + own key.
 * - `providerId` known → the provider's OWN endpoint; a matching override is
 *   ignored, and the stored key rides along.
 * - `providerId` known + a DIFFERENT endpoint → allowed ONLY with a posted key
 *   (the caller's own credential for that host). The stored key is never read,
 *   so it can never be sent there.
 * - `providerId` known + different endpoint + no posted key → refused.
 * - `providerId` unknown → refused (never silently probe unkeyed).
 */
export function resolveEgressTarget(input: {
  providerId?: unknown;
  requestedBaseUrl?: unknown;
  postedApiKey?: unknown;
  providers: readonly EgressProvider[];
}): EgressDecision {
  const postedKey = typeof input.postedApiKey === "string" ? input.postedApiKey.trim() : "";
  const requestedRaw = typeof input.requestedBaseUrl === "string" ? input.requestedBaseUrl.trim() : "";
  const providerId = typeof input.providerId === "string" ? input.providerId.trim() : "";

  if (!providerId) {
    if (!requestedRaw) return { ok: false, status: 400, error: "base_url_required" };
    const requested = parseProviderBaseUrl(requestedRaw);
    if (!requested) return { ok: false, status: 400, error: "invalid_base_url" };
    return {
      ok: true,
      baseUrl: requested.url,
      key: postedKey || null,
      keySource: postedKey ? "posted" : "none",
    };
  }

  const stored = input.providers.find((p) => p.id === providerId);
  if (!stored) return { ok: false, status: 404, error: "provider_not_found" };
  const own = parseProviderBaseUrl(stored.baseUrl);
  if (!own) return { ok: false, status: 409, error: "provider_endpoint_unusable" };
  const storedKey = (stored.apiKey ?? "").trim();

  if (requestedRaw) {
    const requested = parseProviderBaseUrl(requestedRaw);
    if (!requested) return { ok: false, status: 400, error: "invalid_base_url" };
    if (!isSameProviderEndpoint(stored.baseUrl, requestedRaw)) {
      // A retarget. Only a credential the caller typed for THAT host is usable.
      if (!postedKey) return { ok: false, status: 409, error: "stored_key_endpoint_conflict" };
      return { ok: true, baseUrl: requested.url, key: postedKey, keySource: "posted" };
    }
  }

  return {
    ok: true,
    baseUrl: own.url,
    key: postedKey || storedKey || null,
    keySource: postedKey ? "posted" : storedKey ? "stored" : "none",
  };
}

const MAX_DETAIL = 200;

// Words that follow a credential label in ordinary prose ("Incorrect API key
// provided") and must NOT be mistaken for the credential itself.
const CREDENTIAL_LABEL =
  "api[_ -]?key|apikey|access[_ -]?token|refresh[_ -]?token|token|secret|password|passwd|authorization|bearer";

function extractMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    const data = JSON.parse(trimmed) as any;
    const candidates = [data?.error?.message, data?.error, data?.message, data?.detail];
    const hit = candidates.find((c) => typeof c === "string" && c.trim());
    return typeof hit === "string" ? hit : text;
  } catch {
    return text;
  }
}

/**
 * Reduce any provider-supplied text (an upstream error body, a thrown fetch
 * error, a recorded chat failure reason) to something safe to log and to show a
 * parent: credential shapes are replaced with `[redacted]`, the JSON envelope is
 * unwrapped to its message, and the result is length-capped.
 *
 * Providers routinely echo the offending credential back ("Incorrect API key
 * provided: sk-live-…"), sometimes masked. Masked is not safe — it identifies
 * the secret and trains the reader to expect it.
 */
export function redactUpstreamText(raw: unknown, max = MAX_DETAIL): string {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Error) text = raw.message;
  else if (raw == null) text = "";
  else {
    try {
      text = JSON.stringify(raw) ?? "";
    } catch {
      text = "";
    }
  }

  const limit = Math.max(16, Math.min(Number(max) || MAX_DETAIL, MAX_DETAIL * 2));
  const redacted = extractMessage(text)
    // Control characters are DELETED, not spaced out: a newline wedged into the
    // middle of a secret would otherwise split it into two short innocent tokens.
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\bbearer\s+\S+/gi, "bearer [redacted]")
    .replace(/\b(sk|pk|rk|ghp|gho|xox[abps])[-_][A-Za-z0-9_-]{4,}/gi, "$1-[redacted]")
    // `api_key=…` / `key: …` — an explicit assignment is always a credential.
    .replace(new RegExp(`\\b(${CREDENTIAL_LABEL})\\b\\s*[:=]\\s*"?[^\\s"',}]+`, "gi"), "$1=[redacted]")
    // `token <opaque>` — only when the value is long enough to BE one, so
    // "Incorrect API key provided" survives for the admin to read.
    .replace(new RegExp(`\\b(${CREDENTIAL_LABEL})\\b\\s+(?=[A-Za-z0-9_./+=-]{16,})\\S+`, "gi"), "$1 [redacted]")
    // Anything long and opaque is treated as a credential: real keys are ≥ 20
    // chars, and a provider echoing one is the case we must never log.
    .replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  return redacted.length > limit ? `${redacted.slice(0, limit - 1)}…` : redacted;
}
