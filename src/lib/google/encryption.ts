import {
  encryptSecret,
  decryptStrict,
  isEncryptedPayload as sharedIsEncryptedPayload,
  resetSecretKeyCacheForTests,
} from "../secret-box.ts";

// Google OAuth token encryption — now a thin wrapper over the shared
// secret-box (same wire format v1.<iv>.<tag>.<ct>, same key derivation),
// kept so existing encrypted tokens and call sites are unchanged.

export function encrypt(plaintext: string): string {
  return encryptSecret(plaintext);
}

export function decrypt(payload: string): string {
  return decryptStrict(payload);
}

export function isEncryptedPayload(value: unknown): value is string {
  return sharedIsEncryptedPayload(value);
}

export function resetKeyCacheForTests(): void {
  resetSecretKeyCacheForTests();
}
