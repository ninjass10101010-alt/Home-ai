import { sessionTtlSeconds, type SessionRole } from "./session-policy";

export const SESSION_COOKIE = "consuela_session";

export interface SessionPayload {
  memberId: string;
  name: string;
  role: SessionRole;
  iat?: number;
  exp: number;
}

// The dashboard is served over plain HTTP on the LAN (http://192.168.0.28:3000).
// Browsers refuse to send Secure cookies over http, so a hardcoded
// `secure: NODE_ENV === "production"` silently killed every session-gated call
// in the NAS deployment (recipes wouldn't save, chat tools 401'd, etc.).
// Default stays secure in production; set SESSION_COOKIE_SECURE=false for
// HTTP-only LAN deployments.
export function sessionCookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false";
}

export function sessionCookieOptions(
  role: SessionRole,
  maxAge?: number
): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    path: "/",
    maxAge: maxAge ?? sessionTtlSeconds(role),
  };
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function secret(): string {
  return process.env.SESSION_SECRET || "";
}

export async function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  ttlSeconds: number = sessionTtlSeconds(payload.role)
): Promise<string> {
  const s = secret();
  if (!s) throw new Error("SESSION_SECRET is not configured");
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(full)));
  const sig = await crypto.subtle.sign("HMAC", await key(s), enc.encode(`v1.${body}`));
  return `v1.${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(secret()),
      fromB64url(parts[2]),
      enc.encode(`v1.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
