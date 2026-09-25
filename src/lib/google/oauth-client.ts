import { refreshAccessToken, revokeGoogleToken } from "./device-auth.ts";
import { getStoredTokensStrict, updateAccessToken, revokeTokens } from "./token-store.ts";
import { recordApiCall } from "./api-quota.ts";

const SAFETY_MARGIN_MS = 60_000;
const REFRESH_LOCK_MS = 30_000;

let inflightRefresh: Promise<string> | null = null;
let lastRefreshAttempt = 0;

export type GoogleAuthErrorCode =
  | "no_grant"
  | "unavailable"
  | "revoked"
  | "expired"
  | "refresh_failed"
  | "config";

export class GoogleAuthError extends Error {
  code: GoogleAuthErrorCode;
  constructor(code: GoogleAuthErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface GoogleAuthErrorResponse {
  status: 401 | 409 | 500 | 503;
  body: {
    ok: false;
    code: GoogleAuthErrorCode | "unknown";
    error: string;
  };
}

export function mapGoogleAuthError(error: unknown): GoogleAuthErrorResponse {
  if (error instanceof GoogleAuthError) {
    const status = error.code === "unavailable"
      ? 503
      : error.code === "no_grant"
        ? 409
        : 401;
    return {
      status,
      body: { ok: false, code: error.code, error: error.message },
    };
  }

  const message = error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error
      ? error
      : "Unknown Google auth error";
  return {
    status: 500,
    body: { ok: false, code: "unknown", error: message },
  };
}

async function readStoredTokensStrict() {
  try {
    return await getStoredTokensStrict();
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw new GoogleAuthError("unavailable", "Google token state unavailable");
  }
}

export interface GoogleFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  endpoint?: string;
}

function buildUrl(base: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function refresh(): Promise<string> {
  if (inflightRefresh) return inflightRefresh;
  const now = Date.now();
  if (now - lastRefreshAttempt < REFRESH_LOCK_MS && inflightRefresh) {
    return inflightRefresh;
  }
  lastRefreshAttempt = now;

  inflightRefresh = (async () => {
    try {
      const tokens = await readStoredTokensStrict();
      if (!tokens || tokens.revoked_at) {
        throw new GoogleAuthError("no_grant", "Google account is not connected");
      }
      if (!tokens.refresh_token) {
        throw new GoogleAuthError("revoked", "Refresh token missing; reconnect required");
      }
      const fresh = await refreshAccessToken(tokens.refresh_token);
      await updateAccessToken(fresh.access_token, fresh.expires_in);
      return fresh.access_token;
    } catch (e: any) {
      if (e instanceof GoogleAuthError) throw e;
      throw new GoogleAuthError("refresh_failed", e?.message || "Token refresh failed");
    } finally {
      setTimeout(() => {
        inflightRefresh = null;
      }, 1000);
    }
  })();

  return inflightRefresh;
}

async function getValidAccessToken(): Promise<string> {
  const tokens = await readStoredTokensStrict();
  if (!tokens || tokens.revoked_at) {
    throw new GoogleAuthError("no_grant", "Google account is not connected");
  }
  const now = Date.now();
  if (tokens.expires_at - SAFETY_MARGIN_MS > now) {
    return tokens.access_token;
  }
  return refresh();
}

export async function googleFetch<T = unknown>(
  url: string,
  opts: GoogleFetchOptions = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  const endpoint = opts.endpoint || new URL(url, "https://www.googleapis.com").pathname;
  await recordApiCall(endpoint).catch(() => null);

  const doFetch = async (token: string) => {
    const fullUrl = buildUrl(url, opts.query);
    const res = await fetch(fullUrl, {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    return res;
  };

  let token: string;
  try {
    token = await getValidAccessToken();
  } catch (e: any) {
    if (e instanceof GoogleAuthError) throw e;
    throw new GoogleAuthError("unavailable", e?.message || "Google token state unavailable");
  }

  let res = await doFetch(token);

  if (res.status === 401) {
    try {
      token = await refresh();
      res = await doFetch(token);
    } catch (e: any) {
      if (e instanceof GoogleAuthError) throw e;
      throw new GoogleAuthError("refresh_failed", e?.message || "Token refresh failed");
    }
  }

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (res.status === 401 || res.status === 403) {
    const reason = (data && (data.error?.message || data.error_description)) || res.statusText;
    throw new GoogleAuthError(
      res.status === 401 ? "expired" : "revoked",
      `Google API ${res.status}: ${reason}`,
    );
  }

  if (!res.ok) {
    const reason = (data && (data.error?.message || data.error_description)) || text || res.statusText;
    // Carry the HTTP status on the error so callers can react to specific
    // codes — notably 410 GONE, which means an incremental syncToken expired
    // and the caller must clear it and fall back to a full resync.
    const err = new Error(`Google API ${res.status}: ${reason}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return { status: res.status, data: data as T, headers: res.headers };
}

export async function isGoogleConnected(): Promise<boolean> {
  try {
    const tokens = await readStoredTokensStrict();
    return !!(tokens && !tokens.revoked_at && tokens.refresh_token);
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw new GoogleAuthError("unavailable", "Google token state unavailable");
  }
}

export async function disconnectGoogle(): Promise<void> {
  const tokens = await readStoredTokensStrict();
  if (tokens && !tokens.revoked_at) {
    await revokeGoogleToken(tokens.access_token).catch(() => false);
    if (tokens.refresh_token) {
      await revokeGoogleToken(tokens.refresh_token).catch(() => false);
    }
  }
  await revokeTokens();
}
