#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONSUELA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_OAUTH_SCOPES = "openid email https://www.googleapis.com/auth/calendar";

const realFetch = globalThis.fetch;
let grantCalls = 0;
let tokenCalls = 0;

function installMockFetch() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/device/code")) {
      grantCalls++;
      return new Response(
        JSON.stringify({
          device_code: "device-abc",
          user_code: "ABCD-1234",
          verification_url: "https://www.google.com/device",
          expires_in: 600,
          interval: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("/token")) {
      tokenCalls++;
      const body = String((init && init.body) || "");
      if (body.includes("grant_type=refresh_token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.refreshed",
            expires_in: 3600,
            scope: "openid email",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.includes("urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.fresh",
            refresh_token: "1//refresh",
            id_token: "fake.jwt.token",
            expires_in: 3600,
            scope: "openid email",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unknown grant_type", { status: 400 });
    }
    if (u.includes("/revoke")) {
      return new Response("", { status: 200 });
    }
    if (u.includes("openidconnect.googleapis.com")) {
      return new Response(
        JSON.stringify({ email: "tester@example.com" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not mocked: " + u, { status: 404 });
  };
}
installMockFetch();
const mockFetch = globalThis.fetch;

const { requestDeviceGrant, pollForToken, refreshAccessToken, fetchAccountEmail, revokeGoogleToken } =
  await import("../../src/lib/google/device-auth.ts");

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

await t("requestDeviceGrant returns parsed grant", async () => {
  const g = await requestDeviceGrant();
  assert.equal(g.device_code, "device-abc");
  assert.equal(g.user_code, "ABCD-1234");
  assert.equal(g.verification_url, "https://www.google.com/device");
  assert.equal(g.expires_in, 600);
  assert.equal(g.interval, 5);
  assert.equal(grantCalls, 1);
});

await t("requestDeviceGrant includes client_id and scopes in request body", async () => {
  grantCalls = 0;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/device/code")) {
      capturedBody = String((init && init.body) || "");
      return new Response(
        JSON.stringify({
          device_code: "x", user_code: "Y-1", verification_url: "u",
          expires_in: 600, interval: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return mockFetch(url, init);
  };
  await requestDeviceGrant();
  globalThis.fetch = mockFetch;
  assert.match(capturedBody, /client_id=test-client-id\.apps\.googleusercontent\.com/);
  assert.match(capturedBody, /client_secret=test-client-secret/);
  assert.match(capturedBody, /scope=openid\+email\+https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fcalendar/);
});

await t("pollForToken returns complete with parsed tokens", async () => {
  const r = await pollForToken("device-abc", 5);
  assert.equal(r.status, "complete");
  if (r.status === "complete") {
    assert.equal(r.tokens.access_token, "ya29.fresh");
    assert.equal(r.tokens.refresh_token, "1//refresh");
    assert.equal(r.tokens.expires_in, 3600);
  }
});

await t("pollForToken passes device_code in body", async () => {
  tokenCalls = 0;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/token")) {
      captured = String((init && init.body) || "");
      return new Response(
        JSON.stringify({ access_token: "x", refresh_token: "y", expires_in: 1, scope: "s", token_type: "Bearer" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return mockFetch(url, init);
  };
  await pollForToken("my-device", 7);
  globalThis.fetch = mockFetch;
  assert.match(captured, /device_code=my-device/);
  assert.match(captured, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code/);
});

await t("refreshAccessToken uses refresh_token grant type", async () => {
  const r = await refreshAccessToken("1//refresh");
  assert.equal(r.access_token, "ya29.refreshed");
  assert.equal(r.expires_in, 3600);
});

await t("fetchAccountEmail returns email from userinfo", async () => {
  const e = await fetchAccountEmail("ya29.x");
  assert.equal(e, "tester@example.com");
});

await t("revokeGoogleToken returns true on 200", async () => {
  const ok = await revokeGoogleToken("ya29.x");
  assert.equal(ok, true);
});

await t("error responses surface useful message", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_client", error_description: "bad" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  let threw = null;
  try {
    await pollForToken("x", 5);
  } catch (e) {
    threw = e;
  }
  globalThis.fetch = mockFetch;
  assert.ok(threw, "should have thrown");
  assert.match(threw.message, /invalid_client|bad/);
});

console.log(`\n${passed} passed, ${failed} failed`);
globalThis.fetch = realFetch;
process.exit(failed > 0 ? 1 : 0);
