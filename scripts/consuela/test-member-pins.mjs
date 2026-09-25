#!/usr/bin/env node
// Unit tests for shared member-PIN resolution (Task 9 contract).
//
// Usage:
//   npx tsx scripts/consuela/test-member-pins.mjs
//
// What it verifies (after "PINs leave the client bundle"):
//   1. resolveMemberPin returns a stored PB pin and "" otherwise — there are
//      NO client-side default pins anymore
//   2. memberPinMatches requires the stored pin and rejects wrong/unknown
// 3. The fallback member list carries NO pin fields at all (nothing real
//      ships in the client bundle)
//   4. mergeMemberFallbacks keeps live pins when PB covers everyone, appends
//      fallbacks missing from PB, and covers an empty PB instance — for the
//      non-production opt-in only. The last step pins the production behavior:
//      with no opt-in (or under NODE_ENV=production) an empty PB resolves to
//      NO members at all.
//   5. Seed-side defaults exist server-only (pb-seed.ts) and agree with the
//      known family first names

import assert from "node:assert/strict";

// The merge steps below run in the opt-in world (a dev/integration instance).
// The gate is read per call by canonicalMemberFallbacksEnabled(), so setting
// the env before the imports is enough; the final step deletes it again to
// prove the ungated/production path. NODE_ENV is cleared for the same reason —
// a shell that happens to export "production" must not silently disable the
// opt-in these steps describe. Both are restored before the script exits.
const OPT_IN = "NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS";
const CALLER_NODE_ENV = process.env.NODE_ENV;
process.env[OPT_IN] = "true";
delete process.env.NODE_ENV;

const { resolveMemberPin, memberPinMatches } = await import(
  "../../src/lib/member-pins.ts"
);
const { mergeMemberFallbacks, memberFallbacks } = await import(
  "../../src/lib/member-fallback.ts"
);
const { MEMBER_DEFAULT_PINS, resolveDefaultMemberPin } = await import(
  "../../src/lib/pb-seed.ts"
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

await step("resolveMemberPin has NO default-pin fallback anymore", () => {
  assert.equal(resolveMemberPin({ name: "Rebecca (Mom)", pin: "" }), "");
  assert.equal(resolveMemberPin({ name: "Caspian", pin: undefined }), "");
  assert.equal(resolveMemberPin({ name: "", pin: "" }), "");
});

await step("memberPinMatches accepts the stored pin when set", () => {
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "1234" }, "1234"), true);
});

await step("memberPinMatches rejects wrong pins, unknown members, and stray input", () => {
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "1234" }, "0202"), false);
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "" }, "1111"), false);
  assert.equal(memberPinMatches({ name: "Stranger", pin: "" }, "1234"), false);
  assert.equal(memberPinMatches({ name: "Rebecca (Mom)", pin: "" }, " 1234"), false);
});

await step("fallback list contains all 9 known members with NO pin fields", () => {
  assert.equal(memberFallbacks.length, 9);
  assert.ok(memberFallbacks.some((m) => m.name === "Rebecca (Mom)"));
  assert.ok(memberFallbacks.every((m) => !("pin" in m)));
});

await step("mergeMemberFallbacks keeps live pins when PB covers everyone", () => {
  const pbMembers = memberFallbacks.map((m) => ({ ...m, pin: "1111" }));
  const merged = mergeMemberFallbacks(pbMembers);
  assert.equal(merged.length, 9);
  assert.ok(merged.every((m) => m.pin === "1111"));
});

await step("mergeMemberFallbacks appends fallbacks missing from PB", () => {
  const pbMembers = [{ name: "Rebecca (Mom)", pin: "1111" }];
  const merged = mergeMemberFallbacks(pbMembers);
  assert.ok(merged.some((m) => m.name === "Rebecca (Mom)" && m.pin === "1111"));
  assert.ok(merged.some((m) => m.name === "Aurora" && !("pin" in m)));
  assert.ok(merged.some((m) => m.name === "Caspian" && !("pin" in m)));
});

await step("mergeMemberFallbacks returns all fallbacks for an empty PB (dev opt-in)", () => {
  const merged = mergeMemberFallbacks([]);
  assert.equal(merged.length, 9);
  assert.ok(merged.every((m) => !("pin" in m)));
});

await step("mergeMemberFallbacks invents nobody without the opt-in (production path)", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env[OPT_IN];
    // No opt-in (a bare dev shell) and NODE_ENV=production must both resolve
    // an empty PocketBase roster to zero members — never the built-in family.
    assert.deepEqual(mergeMemberFallbacks([]), []);
    assert.deepEqual(mergeMemberFallbacks([{ name: "   " }]), []);

    process.env.NODE_ENV = "production";
    process.env[OPT_IN] = "true";
    assert.deepEqual(mergeMemberFallbacks([]), []);

    // A live PocketBase roster is still the only source once the gate is off.
    const live = [{ name: "Rebecca (Mom)", pin: "1111" }];
    assert.deepEqual(mergeMemberFallbacks(live), live);
  } finally {
    process.env[OPT_IN] = "true";
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

await step("seed-side defaults cover the family and are server-resolved only", () => {
  assert.equal(typeof MEMBER_DEFAULT_PINS.rebecca, "string");
  assert.ok(Object.keys(MEMBER_DEFAULT_PINS).length >= 9);
  assert.notEqual(resolveDefaultMemberPin("Rebecca (Mom)"), "");
  assert.notEqual(resolveDefaultMemberPin("caspian garcia"), "");
  assert.equal(resolveDefaultMemberPin("Stranger"), "");
  // The seed-side map must never leak into the client-reachable libs.
  assert.ok(!JSON.stringify(memberFallbacks).includes(Object.values(MEMBER_DEFAULT_PINS)[0]));
});

// Restore the caller's env so importing this script has no side effects.
if (CALLER_NODE_ENV === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = CALLER_NODE_ENV;
delete process.env[OPT_IN];

if (failures > 0) {
  console.error(`\n${failures} step(s) failed`);
  process.exit(1);
}
console.log("\nAll member-pin tests passed.");
