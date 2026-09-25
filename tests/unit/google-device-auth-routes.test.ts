import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeAdminRequest: vi.fn(),
  requestDeviceGrant: vi.fn(),
  ensureGoogleCollections: vi.fn(),
  revokeGoogleToken: vi.fn(),
  getStoredTokens: vi.fn(),
  getStoredTokensStrict: vi.fn(),
  revokeTokens: vi.fn(),
  clearDirectGoogleCache: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminRequest: mocks.authorizeAdminRequest,
}));
vi.mock("@/lib/google/device-auth", () => ({
  requestDeviceGrant: mocks.requestDeviceGrant,
  revokeGoogleToken: mocks.revokeGoogleToken,
}));
vi.mock("@/lib/google/pb-collections", () => ({
  ensureGoogleCollections: mocks.ensureGoogleCollections,
}));
vi.mock("@/lib/google/token-store", () => ({
  getStoredTokens: mocks.getStoredTokens,
  getStoredTokensStrict: mocks.getStoredTokensStrict,
  revokeTokens: mocks.revokeTokens,
  clearDirectGoogleCache: mocks.clearDirectGoogleCache,
}));

import { POST as grant } from "@/app/api/google/device-grant/route";
import { POST as revoke } from "@/app/api/google/device-revoke/route";

function request(path: string, body: unknown = { action: "disconnect" }) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(path: string, body: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.ensureGoogleCollections.mockResolvedValue(undefined);
  mocks.requestDeviceGrant.mockResolvedValue({
    device_code: "device",
    user_code: "code",
    verification_url: "https://google.test/device",
    expires_in: 600,
    interval: 5,
  });
  mocks.revokeGoogleToken.mockResolvedValue(true);
  mocks.getStoredTokens.mockResolvedValue({ access_token: "access", refresh_token: "refresh", revoked_at: null });
  mocks.getStoredTokensStrict.mockResolvedValue({ access_token: "access", refresh_token: "refresh", revoked_at: null });
  mocks.revokeTokens.mockResolvedValue(undefined);
  mocks.clearDirectGoogleCache.mockResolvedValue(true);
});

it.each([
  ["malformed JSON", "{"],
  ["null", "null"],
  ["array", "[]"],
  ["missing action", JSON.stringify({ attempt_id: "attempt-1" })],
  ["invalid action", JSON.stringify({ action: "other" })],
  ["missing cancel attempt", JSON.stringify({ action: "cancel" })],
])("rejects %s revoke input before token work", async (_label, body) => {
  const result = await revoke(rawRequest("/api/google/device-revoke", body));

  expect(result.status).toBe(400);
  expect(await result.json()).toMatchObject({ ok: false });
  expect(mocks.getStoredTokensStrict).not.toHaveBeenCalled();
  expect(mocks.revokeTokens).not.toHaveBeenCalled();
  expect(mocks.clearDirectGoogleCache).not.toHaveBeenCalled();
});

describe("Google device authorization routes", () => {
  it.each(["child", "pet"])("rejects a %s session before starting a device grant", async (role) => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });

    const result = await grant(request("/api/google/device-grant"));
    const body = await result.json();

    expect(result.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
    expect(mocks.requestDeviceGrant).not.toHaveBeenCalled();
    expect(role).toBeTruthy();
  });

  it("allows a parent session to start a device grant", async () => {
    const result = await grant(request("/api/google/device-grant"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ ok: true, device_code: "device", user_code: "code" });
    expect(mocks.ensureGoogleCollections).toHaveBeenCalledTimes(1);
    expect(mocks.requestDeviceGrant).toHaveBeenCalledTimes(1);
  });

  it.each(["child", "pet"])("rejects a %s session before revoking Google tokens", async (role) => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.getStoredTokensStrict).not.toHaveBeenCalled();
    expect(mocks.revokeTokens).not.toHaveBeenCalled();
    expect(role).toBeTruthy();
  });

  it("keeps the local disconnect successful with a warning when remote revoke fails", async () => {
    mocks.revokeGoogleToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      outcome: "local_only",
      remoteRevoked: false,
      localRevoked: true,
    });
    expect(body.warning).toContain("Google access may remain");
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(1);
  });

  it("treats refresh-token revocation as remote success when access-token revocation fails", async () => {
    mocks.revokeGoogleToken.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true });
    expect(mocks.revokeGoogleToken).toHaveBeenCalledTimes(2);
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(1);
  });

  it("uses access-token revocation when no refresh token exists", async () => {
    mocks.getStoredTokensStrict.mockResolvedValueOnce({ access_token: "access", refresh_token: "", revoked_at: null });
    mocks.revokeGoogleToken.mockResolvedValueOnce(true);

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true });
    expect(mocks.revokeGoogleToken).toHaveBeenCalledTimes(1);
    expect(mocks.revokeGoogleToken).toHaveBeenCalledWith("access");
  });

  it("reports failure when local token removal fails", async () => {
    mocks.revokeTokens.mockRejectedValue(new Error("local store unavailable"));

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(500);
    expect(body).toMatchObject({ ok: false, outcome: "failed", localRevoked: false });
  });

  it("preserves remote success when local token removal fails", async () => {
    mocks.revokeTokens.mockRejectedValue(new Error("local store unavailable"));

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      outcome: "failed",
      remoteRevoked: true,
      localRevoked: false,
      error: "local store unavailable",
    });
  });

  it("reports local token removal separately when direct cache cleanup fails", async () => {
    mocks.clearDirectGoogleCache.mockRejectedValueOnce(new Error("cache unavailable"));

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(500);
    expect(body).toMatchObject({ ok: false, outcome: "failed", localRevoked: true, error: "cache_clear_failed" });
  });

  it("clears direct Google calendar cache after disconnect", async () => {
    const result = await revoke(request("/api/google/device-revoke"));

    expect(result.status).toBe(200);
    expect(mocks.clearDirectGoogleCache).toHaveBeenCalledTimes(1);
  });

  it("allows a parent session to revoke Google tokens", async () => {
    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      outcome: "disconnected",
      remoteRevoked: true,
      localRevoked: true,
    });
    expect(mocks.getStoredTokensStrict).toHaveBeenCalledTimes(1);
    expect(mocks.revokeGoogleToken).toHaveBeenCalledTimes(2);
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(1);
  });

  it("does not claim disconnect success when the strict token read is unavailable", async () => {
    mocks.getStoredTokensStrict.mockRejectedValueOnce(new Error("PB unavailable"));

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      outcome: "failed",
      remoteRevoked: false,
      localRevoked: false,
      error: "token_read_failed",
    });
    expect(mocks.revokeGoogleToken).not.toHaveBeenCalled();
    expect(mocks.revokeTokens).not.toHaveBeenCalled();
  });

  it("treats a genuinely absent token as disconnected without remote calls", async () => {
    mocks.getStoredTokensStrict.mockResolvedValueOnce(null);

    const result = await revoke(request("/api/google/device-revoke"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true });
    expect(mocks.revokeGoogleToken).not.toHaveBeenCalled();
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(1);
  });
});
