import { createHmac, timingSafeEqual } from "node:crypto";

// MUSE inbound identity tokens (Task 7 / B1, B2-token). Deliberately
// separate from src/lib/session.ts: a distinct HMAC context means a session
// token can never be replayed as a MUSE token and vice versa, and the token
// additionally carries the identity version + admin flag so a key rotation
// (version bump) revokes every outstanding token.
export const MUSE_TOKEN_TTL_SECONDS = 86400;

const CONTEXT = "muse-token-v1:";

export interface MuseTokenPayload {
  sub: "muse";
  ver: number;
  adm: boolean;
  exp: number;
}

export interface SignMuseTokenOptions {
  ver: number;
  adm: boolean;
}

export interface VerifyMuseTokenContext {
  currentVersion: number;
  enabled: boolean;
}

export type VerifyMuseTokenResult =
  | { ok: true; adm: boolean }
  | {
      ok: false;
      reason: "malformed" | "bad_signature" | "expired" | "revoked" | "disabled";
    };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function secret(): string {
  return process.env.SESSION_SECRET || "";
}

export function signMuseToken(
  opts: SignMuseTokenOptions,
  now: number = Date.now()
): { token: string; expiresAt: string } {
  const s = secret();
  if (!s) throw new Error("SESSION_SECRET is not set");
  const exp = Math.floor(now / 1000) + MUSE_TOKEN_TTL_SECONDS;
  const payload: MuseTokenPayload = { sub: "muse", ver: opts.ver, adm: opts.adm, exp };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = createHmac("sha256", s).update(`${CONTEXT}${body}`).digest();
  return { token: `v1.${body}.${b64url(sig)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyMuseToken(
  token: string | undefined | null,
  ctx: VerifyMuseTokenContext,
  now: number = Date.now()
): VerifyMuseTokenResult {
  const s = secret();
  if (!s || !token) return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "malformed" };

  let payload: MuseTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as MuseTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || payload.sub !== "muse" || typeof payload.ver !== "number") {
    return { ok: false, reason: "malformed" };
  }

  try {
    const provided = fromB64url(parts[2]);
    const expected = createHmac("sha256", s).update(`${CONTEXT}${parts[1]}`).digest();
    if (provided.length !== expected.length) return { ok: false, reason: "bad_signature" };
    if (!timingSafeEqual(Buffer.from(provided), expected)) {
      return { ok: false, reason: "bad_signature" };
    }
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) {
    return { ok: false, reason: "expired" };
  }
  if (!ctx.enabled) return { ok: false, reason: "disabled" };
  if (payload.ver !== ctx.currentVersion) return { ok: false, reason: "revoked" };

  return { ok: true, adm: payload.adm === true };
}
