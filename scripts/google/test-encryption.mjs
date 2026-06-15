#!/usr/bin/env node
import { encrypt, decrypt, isEncryptedPayload, resetKeyCacheForTests } from "../../src/lib/google/encryption.ts";
import { randomBytes } from "node:crypto";

let failed = 0;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = "") {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, matcher, msg = "") {
  try {
    fn();
  } catch (e) {
    if (matcher instanceof RegExp ? matcher.test(e.message) : e.message.includes(matcher)) {
      return;
    }
    throw new Error(`${msg} threw but with wrong message: ${e.message}`);
  }
  throw new Error(`${msg} did not throw`);
}

if (!process.env.CONSUELA_ENCRYPTION_KEY) {
  process.env.CONSUELA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

console.log("encryption.ts round-trip tests");

test("encrypt then decrypt returns original", () => {
  const input = "ya29.a0AfH6SMBxxx-access-token-12345";
  const ct = encrypt(input);
  assertEqual(decrypt(ct), input, "round-trip");
});

test("encrypt produces a v1. payload with 4 parts", () => {
  const ct = encrypt("hello");
  const parts = ct.split(".");
  assertEqual(parts.length, 4, "part count");
  assertEqual(parts[0], "v1", "version");
});

test("two encryptions of the same input produce different ciphertexts (random IV)", () => {
  const a = encrypt("same");
  const b = encrypt("same");
  if (a === b) throw new Error("ciphertexts should differ due to random IV");
});

test("isEncryptedPayload recognizes encrypted strings", () => {
  assertEqual(isEncryptedPayload(encrypt("x")), true);
  assertEqual(isEncryptedPayload("v1.aaa.bbb.ccc"), true);
  assertEqual(isEncryptedPayload("plain string"), false);
  assertEqual(isEncryptedPayload(""), false);
  assertEqual(isEncryptedPayload(null), false);
  assertEqual(isEncryptedPayload(123), false);
});

test("tampered ciphertext is rejected (GCM auth tag)", () => {
  const ct = encrypt("secret");
  const parts = ct.split(".");
  parts[3] = Buffer.from(parts[3], "base64");
  parts[3][0] = parts[3][0] ^ 0xff;
  parts[3] = Buffer.from(parts[3]).toString("base64");
  const tampered = parts.join(".");
  assertThrows(() => decrypt(tampered), /unsupported state|auth|invalid/i, "tamper");
});

test("tampered auth tag is rejected", () => {
  const ct = encrypt("secret");
  const parts = ct.split(".");
  parts[2] = Buffer.from(parts[2], "base64");
  parts[2][0] = parts[2][0] ^ 0xff;
  parts[2] = Buffer.from(parts[2]).toString("base64");
  const tampered = parts.join(".");
  assertThrows(() => decrypt(tampered), /unsupported state|auth|invalid/i, "tag tamper");
});

test("truncated payload is rejected", () => {
  assertThrows(() => decrypt("v1.a"), /malformed/i, "truncated");
});

test("empty plaintext round-trips", () => {
  const ct = encrypt("");
  assertEqual(decrypt(ct), "", "empty");
});

test("unicode and emoji round-trip", () => {
  const input = "Refresh 🔄 token — Résumé — 𝓤𝓷𝓲𝓬𝓸𝓭𝓮";
  const ct = encrypt(input);
  assertEqual(decrypt(ct), input, "unicode");
});

test("long token (refresh token length) round-trips", () => {
  const input = "1//0gXxX" + "x".repeat(150);
  const ct = encrypt(input);
  assertEqual(decrypt(ct), input, "long token");
});

test("decrypt rejects non-string", () => {
  // @ts-ignore
  assertThrows(() => decrypt(null), /non-empty/i, "null");
  // @ts-ignore
  assertThrows(() => decrypt(undefined), /non-empty/i, "undefined");
  // @ts-ignore
  assertThrows(() => decrypt(123), /non-empty/i, "number");
});

test("wrong key produces auth failure", () => {
  const ct = encrypt("secret");
  process.env.CONSUELA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetKeyCacheForTests();
  let threw = false;
  try {
    decrypt(ct);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("decrypt with wrong key should fail");
});

process.exit(failed > 0 ? 1 : 0);

console.log(`\n${passed} passed, ${failed} failed`);
