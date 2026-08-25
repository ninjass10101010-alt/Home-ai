import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// Shared AES-256-GCM secret box. Encrypts service credentials (and Google
// tokens) at rest using CONSUELA_ENCRYPTION_KEY. Wire format:
//   v1.<iv>.<tag>.<ciphertext>  (base64 segments)
// Extracted verbatim from google/encryption.ts so existing payloads stay
// readable; new consumers should prefer the null-safe decryptSecret().

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const SCRYPT_SALT = "consuela_google_token_encryption_v1";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.CONSUELA_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "CONSUELA_ENCRYPTION_KEY is not set. Run: node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"base64\"))' and add it to .env.local",
    );
  }

  let key: Buffer;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === KEY_LEN) {
      key = decoded;
    } else {
      key = scryptSync(raw, SCRYPT_SALT, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      });
    }
  } catch {
    key = scryptSync(raw, SCRYPT_SALT, KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
  }

  if (key.length !== KEY_LEN) {
    throw new Error(
      `CONSUELA_ENCRYPTION_KEY resolved to ${key.length} bytes, expected ${KEY_LEN}`,
    );
  }

  cachedKey = key;
  return key;
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret() requires a string plaintext");
  }
  const key = resolveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decryptStrict(payload: string): string {
  if (typeof payload !== "string" || payload === "") {
    throw new Error("decrypt() requires a non-empty payload string");
  }
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("decrypt(): malformed payload (expected v1.<iv>.<tag>.<ct>)");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LEN) throw new Error("decrypt(): invalid IV length");
  if (tag.length !== 16) throw new Error("decrypt(): invalid auth tag length");

  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

/** Null-safe variant for service config: any failure (tamper, wrong key,
 * malformed payload, unset key) yields null instead of throwing. */
export function decryptSecret(payload: string | undefined | null): string | null {
  if (!payload) return null;
  try {
    return decryptStrict(payload);
  } catch {
    return null;
  }
}

export function isEncryptedPayload(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("v1.") &&
    value.split(".").length === 4
  );
}

export function resetSecretKeyCacheForTests(): void {
  cachedKey = null;
}
