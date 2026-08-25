import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncryptedPayload,
  resetSecretKeyCacheForTests,
} from "../../src/lib/secret-box";

const KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa="; // 32 bytes base64

beforeEach(() => {
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", KEY);
  resetSecretKeyCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretKeyCacheForTests();
});

describe("secret-box", () => {
  it("round-trips encrypt→decrypt", () => {
    const ct = encryptSecret("ha-token-abc123");
    expect(isEncryptedPayload(ct)).toBe(true);
    expect(decryptSecret(ct)).toBe("ha-token-abc123");
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("returns null on tampered ciphertext", () => {
    const ct = encryptSecret("secret");
    const parts = ct.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(decryptSecret(parts.join("."))).toBeNull();
  });

  it("returns null when decrypted with a different key", async () => {
    const ct = encryptSecret("secret");
    vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=");
    resetSecretKeyCacheForTests();
    expect(decryptSecret(ct)).toBeNull();
  });

  it("returns null (never throws) on malformed payloads", () => {
    expect(decryptSecret("")).toBeNull();
    expect(decryptSecret("not-a-payload")).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
  });
});
