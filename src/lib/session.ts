export const SESSION_COOKIE = "consuela_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  memberId: string;
  name: string;
  role: string;
  iat?: number;
  exp: number;
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
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const s = secret();
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(full)));
  if (!s) return `v1.${body}.`;
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
