import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoredTokens: vi.fn(),
  getStoredTokensStrict: vi.fn(),
  updateAccessToken: vi.fn(),
  revokeTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeGoogleToken: vi.fn(),
  recordApiCall: vi.fn(),
}));

vi.mock("@/lib/google/device-auth", () => ({
  refreshAccessToken: mocks.refreshAccessToken,
  revokeGoogleToken: mocks.revokeGoogleToken,
}));

vi.mock("@/lib/google/token-store", () => ({
  getStoredTokens: mocks.getStoredTokens,
  getStoredTokensStrict: mocks.getStoredTokensStrict,
  updateAccessToken: mocks.updateAccessToken,
  revokeTokens: mocks.revokeTokens,
}));

vi.mock("@/lib/google/api-quota", () => ({
  recordApiCall: mocks.recordApiCall,
}));

import {
  disconnectGoogle,
  GoogleAuthError,
  googleFetch,
  isGoogleConnected,
  mapGoogleAuthError,
} from "@/lib/google/oauth-client";

const validToken = {
  access_token: "access",
  refresh_token: "refresh",
  expires_at: Date.now() + 3_600_000,
  revoked_at: null,
  account_email: "family@example.com",
  granted_at: "",
  scope: "calendar",
  token_type: "Bearer" as const,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getStoredTokens.mockResolvedValue(null);
  mocks.getStoredTokensStrict.mockResolvedValue(validToken);
  mocks.updateAccessToken.mockResolvedValue(undefined);
  mocks.revokeTokens.mockResolvedValue(true);
  mocks.revokeGoogleToken.mockResolvedValue(true);
  mocks.refreshAccessToken.mockResolvedValue({ access_token: "fresh", expires_in: 3600 });
  mocks.recordApiCall.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
    headers: new Headers(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google OAuth strict token propagation", () => {
  it("uses the strict token read for a valid access token", async () => {
    await googleFetch("https://www.googleapis.com/test");

    expect(mocks.getStoredTokensStrict).toHaveBeenCalledTimes(1);
    expect(mocks.getStoredTokens).not.toHaveBeenCalled();
  });

  it("reports a token-store read failure as unavailable, not no_grant", async () => {
    mocks.getStoredTokensStrict.mockRejectedValueOnce(new Error("PB unavailable"));

    await expect(googleFetch("https://www.googleapis.com/test")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("uses the strict token read when refreshing an expired token", async () => {
    mocks.getStoredTokensStrict.mockResolvedValueOnce({ ...validToken, expires_at: Date.now() - 1 });

    await googleFetch("https://www.googleapis.com/test");

    expect(mocks.getStoredTokensStrict).toHaveBeenCalledTimes(2);
    expect(mocks.getStoredTokens).not.toHaveBeenCalled();
    expect(mocks.refreshAccessToken).toHaveBeenCalledWith("refresh");
    expect(mocks.updateAccessToken).toHaveBeenCalledWith("fresh", 3600);
  });

  it("does not turn a strict read failure into a disconnected result", async () => {
    mocks.getStoredTokensStrict.mockRejectedValueOnce(new Error("PB unavailable"));

    await expect(isGoogleConnected()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not disconnect when the strict token read is unavailable", async () => {
    mocks.getStoredTokensStrict.mockRejectedValueOnce(new Error("PB unavailable"));

    await expect(disconnectGoogle()).rejects.toMatchObject({ code: "unavailable" });
    expect(mocks.revokeGoogleToken).not.toHaveBeenCalled();
    expect(mocks.revokeTokens).not.toHaveBeenCalled();
  });
});

describe("mapGoogleAuthError", () => {
  it.each([
    ["unavailable", 503],
    ["no_grant", 409],
    ["revoked", 401],
    ["expired", 401],
    ["refresh_failed", 401],
    ["config", 401],
  ] as const)("maps %s to %i", (code, status) => {
    expect(mapGoogleAuthError(new GoogleAuthError(code, "Auth failed"))).toEqual({
      status,
      body: { ok: false, code, error: "Auth failed" },
    });
  });

  it("maps an unknown error to 500", () => {
    expect(mapGoogleAuthError(new Error("Unexpected failure"))).toEqual({
      status: 500,
      body: { ok: false, code: "unknown", error: "Unexpected failure" },
    });
  });
});
