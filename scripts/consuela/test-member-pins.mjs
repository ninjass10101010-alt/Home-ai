#!/usr/bin/env node
// Unit tests for shared member-PIN resolution (client/server pin agreement).
//
// Usage:
//   npx tsx scripts/consuela/test-member-pins.mjs
//
// What it verifies:
//   1. resolveMemberPin returns the stored PB pin when one is set
//   2. resolveMemberPin falls back to the known default pin for a member whose
//      PB record has no pin (client and server must agree on this)
//   3. resolveMemberPin is case-insensitive on first names and works with the
//      parenthetical display names ("Rebecca (Mom)")
//   4. resolveMemberPin returns "" for unknown members (no pin, no fallback)
//   5. memberPinMatches accepts the fallback pin when the PB record has no pin
//      (regression: profile avatar save used to reject with "Invalid PIN")
//   6. memberPinMatches still rejects wrong pins and unknown members

import assert from "node:assert/strict";

const { resolveMemberPin, memberPinMatches } = await import(
  "../../src/lib/member-pins.ts"
);

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

await step("resolveMemberPin keeps a stored PB pin", () => {
  assert.equal(resolveMemberPin({ name: "Rebecca (Mom)", pin: "1234" }), "1234");
});

await step("resolveMemberPin falls back for a pin-less PB record", () => {
  assert.equal(resolveMemberPin({ name: "Rebecca (Mom)", pin: "" }), "0202");
  assert.equal(resolveMemberPin({ name: "Caspian", pin: undefined }), "1010");
});

await step("resolveMemberPin matches first names case-insensitively", () => {
  assert.equal(resolveMemberPin({ name: "caspian", pin: "" }), "1010");
  assert.equal(resolveMemberPin({ name: "Emily Garcia", pin: "" }), "1024");
});

await step("resolveMemberPin returns empty for unknown members", () => {
  assert.equal(resolveMemberPin({ name: "Stranger", pin: "" }), "");
  assert.equal(resolveMemberPin({ name: "", pin: "" }), "");
});

await step("memberPinMatches accepts the fallback pin for pin-less records", () => {
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "" }, "0202"), true);
});

await step("memberPinMatches accepts the stored pin when set", () => {
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "1234" }, "1234"), true);
});

await step("memberPinMatches rejects a wrong pin", () => {
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "1234" }, "0202"), false);
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "" }, "1111"), false);
});

await step("memberPinMatches rejects unknown members", () => {
  assert.equal(memberPinMatches({ name: "Stranger", pin: "" }, "0202"), false);
});

await step("memberPinMatches rejects non-digit stray pins", () => {
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "" }, " 0202"), false);
});

if (failures > 0) {
  console.error(`\n${failures} step(s) failed`);
  process.exit(1);
}
console.log("\nAll member-pin tests passed.");
