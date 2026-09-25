import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeAdminRequest: vi.fn(),
  requestDeviceGrant: vi.fn(),
  pollForToken: vi.fn(),
  fetchAccountEmail: vi.fn(),
  ensureGoogleCollections: vi.fn(),
  saveTokens: vi.fn(),
  getStoredTokensStrict: vi.fn(),
  revokeTokens: vi.fn(),
  clearDirectGoogleCache: vi.fn(),
  revokeGoogleToken: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/google/device-auth", () => ({
  requestDeviceGrant: mocks.requestDeviceGrant,
  pollForToken: mocks.pollForToken,
  fetchAccountEmail: mocks.fetchAccountEmail,
  revokeGoogleToken: mocks.revokeGoogleToken,
}));
vi.mock("@/lib/google/pb-collections", () => ({ ensureGoogleCollections: mocks.ensureGoogleCollections }));
vi.mock("@/lib/google/token-store", () => ({
  saveTokens: mocks.saveTokens,
  getStoredTokensStrict: mocks.getStoredTokensStrict,
  revokeTokens: mocks.revokeTokens,
  clearDirectGoogleCache: mocks.clearDirectGoogleCache,
}));

import { POST as grant } from "@/app/api/google/device-grant/route";
import { POST as poll } from "@/app/api/google/device-poll/route";
import { POST as revoke } from "@/app/api/google/device-revoke/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";
import { __resetDeviceAttemptsForTests, isDeviceAttemptActive, withDeviceAttemptCommit } from "@/lib/google/device-attempts";

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  __resetDeviceAttemptsForTests();
  __resetKeyedLockForTests();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.ensureGoogleCollections.mockResolvedValue(undefined);
  mocks.requestDeviceGrant.mockResolvedValue({
    device_code: "device-code",
    user_code: "user-code",
    verification_url: "https://google.test/device",
    expires_in: 600,
    interval: 5,
  });
  mocks.fetchAccountEmail.mockResolvedValue("family@example.com");
  mocks.saveTokens.mockResolvedValue(undefined);
  mocks.getStoredTokensStrict.mockResolvedValue(null);
  mocks.revokeTokens.mockResolvedValue(true);
  mocks.clearDirectGoogleCache.mockResolvedValue(true);
  mocks.revokeGoogleToken.mockResolvedValue(true);
});

describe("Google device attempt lifecycle", () => {
  it("revokes and clears a grant when cancellation arrives after persistence begins", async () => {
    const grantResponse = await grant(request("/api/google/device-grant"));
    const grantBody = await grantResponse.json();
    const savePending = deferred<any>();
    mocks.pollForToken.mockResolvedValueOnce({
      status: "complete",
      tokens: {
        status: "complete",
        access_token: "access",
        refresh_token: "refresh",
        id_token: null,
        expires_in: 3600,
        scope: "calendar",
        token_type: "Bearer",
      },
    });
    mocks.saveTokens.mockReturnValueOnce(savePending.promise);
    mocks.getStoredTokensStrict.mockResolvedValueOnce({ access_token: "access", refresh_token: "refresh", revoked_at: null });

    const pollPromise = poll(request("/api/google/device-poll", {
      attempt_id: grantBody.attempt_id,
      device_code: "device-code",
    }));
    await vi.waitFor(() => expect(mocks.saveTokens).toHaveBeenCalledTimes(1));
    const revokePromise = revoke(request("/api/google/device-revoke", {
      action: "cancel",
      attempt_id: grantBody.attempt_id,
    }));
    savePending.resolve(undefined);

    const pollResponse = await pollPromise;
    const revokeResponse = await revokePromise;

    expect(pollResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(isDeviceAttemptActive(grantBody.attempt_id, "device-code")).toBe(false);
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(1);
    expect(mocks.clearDirectGoogleCache).toHaveBeenCalledTimes(1);
  });

  it("invalidates older active attempts when a newer grant starts", async () => {
    const first = await (await grant(request("/api/google/device-grant"))).json();
    const second = await (await grant(request("/api/google/device-grant"))).json();

    expect(isDeviceAttemptActive(first.attempt_id, "device-code")).toBe(false);
    expect(isDeviceAttemptActive(second.attempt_id, "device-code")).toBe(true);
  });

  it("does not let a stale cancel revoke or clear a newer committed grant", async () => {
    const first = await (await grant(request("/api/google/device-grant"))).json();
    const second = await (await grant(request("/api/google/device-grant"))).json();
    mocks.pollForToken.mockResolvedValueOnce({
      status: "complete",
      tokens: {
        status: "complete",
        access_token: "new-access",
        refresh_token: "new-refresh",
        id_token: null,
        expires_in: 3600,
        scope: "calendar",
        token_type: "Bearer",
      },
    });

    const pollResponse = await poll(request("/api/google/device-poll", {
      attempt_id: second.attempt_id,
      device_code: "device-code",
    }));
    expect(pollResponse.status).toBe(200);

    const cancelResponse = await revoke(request("/api/google/device-revoke", {
      action: "cancel",
      attempt_id: first.attempt_id,
    }));

    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.json()).toMatchObject({ ok: true, outcome: "cancelled" });
    expect(mocks.revokeTokens).not.toHaveBeenCalled();
    expect(mocks.clearDirectGoogleCache).not.toHaveBeenCalled();
  });

  it("full disconnect invalidates every attempt and clears the canonical grant", async () => {
    const first = await (await grant(request("/api/google/device-grant"))).json();
    const second = await (await grant(request("/api/google/device-grant"))).json();

    const response = await revoke(request("/api/google/device-revoke", { action: "disconnect" }));

    expect(response.status).toBe(200);
    expect(isDeviceAttemptActive(first.attempt_id, "device-code")).toBe(false);
    expect(isDeviceAttemptActive(second.attempt_id, "device-code")).toBe(false);
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(1);
    expect(mocks.clearDirectGoogleCache).toHaveBeenCalledTimes(1);
  });  it("keeps cancellation and a new attempt progressing during account lookup", async () => {
    mocks.requestDeviceGrant
      .mockResolvedValueOnce({
        device_code: "device-a",
        user_code: "user-a",
        verification_url: "https://google.test/device-a",
        expires_in: 600,
        interval: 5,
      })
      .mockResolvedValueOnce({
        device_code: "device-b",
        user_code: "user-b",
        verification_url: "https://google.test/device-b",
        expires_in: 600,
        interval: 5,
      });
    mocks.pollForToken.mockResolvedValueOnce({
      status: "complete",
      tokens: {
        status: "complete",
        access_token: "access-a",
        refresh_token: "refresh-a",
        id_token: null,
        expires_in: 3600,
        scope: "calendar",
        token_type: "Bearer",
      },
    });
    const emailPending = deferred<string | null>();
    mocks.fetchAccountEmail.mockReturnValueOnce(emailPending.promise);
    const first = await (await grant(request("/api/google/device-grant"))).json();

    const pollPromise = poll(request("/api/google/device-poll", {
      attempt_id: first.attempt_id,
      device_code: "device-a",
    }));
    await vi.waitFor(() => expect(mocks.fetchAccountEmail).toHaveBeenCalledTimes(1));

    let cancelResolved = false;
    const cancelPromise = revoke(request("/api/google/device-revoke", {
      action: "cancel",
      attempt_id: first.attempt_id,
    })).then((response) => {
      cancelResolved = true;
      return response;
    });
    let nextResolved = false;
    const nextPromise = grant(request("/api/google/device-grant")).then((response) => {
      nextResolved = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.requestDeviceGrant).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cancelResolved).toBe(true);
    expect(nextResolved).toBe(true);
    emailPending.resolve("family@example.com");
    const [pollResponse, cancelResponse, nextResponse] = await Promise.all([pollPromise, cancelPromise, nextPromise]);

    expect(pollResponse.status).toBe(409);
    expect(cancelResponse.status).toBe(200);
    expect(nextResponse.status).toBe(200);
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("serializes a new attempt behind an in-flight commit", async () => {
    mocks.requestDeviceGrant
      .mockResolvedValueOnce({
        device_code: "device-a",
        user_code: "user-a",
        verification_url: "https://google.test/device-a",
        expires_in: 600,
        interval: 5,
      })
      .mockResolvedValueOnce({
        device_code: "device-b",
        user_code: "user-b",
        verification_url: "https://google.test/device-b",
        expires_in: 600,
        interval: 5,
      });
    const first = await (await grant(request("/api/google/device-grant"))).json();
    const savePending = deferred<any>();
    mocks.pollForToken.mockResolvedValueOnce({
      status: "complete",
      tokens: {
        status: "complete",
        access_token: "access-a",
        refresh_token: "refresh-a",
        id_token: null,
        expires_in: 3600,
        scope: "calendar",
        token_type: "Bearer",
      },
    });
    mocks.saveTokens.mockReturnValueOnce(savePending.promise);

    const pollPromise = poll(request("/api/google/device-poll", {
      attempt_id: first.attempt_id,
      device_code: "device-a",
    }));
    await vi.waitFor(() => expect(mocks.saveTokens).toHaveBeenCalledTimes(1));

    let secondResolved = false;
    const secondPromise = grant(request("/api/google/device-grant")).then((response) => {
      secondResolved = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.requestDeviceGrant).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondResolved).toBe(false);

    savePending.resolve(undefined);
    const [pollResponse, secondResponse] = await Promise.all([pollPromise, secondPromise]);
    expect(pollResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
  });

  it("does not allow a new attempt during full-disconnect cleanup", async () => {
    mocks.requestDeviceGrant
      .mockResolvedValueOnce({
        device_code: "device-a",
        user_code: "user-a",
        verification_url: "https://google.test/device-a",
        expires_in: 600,
        interval: 5,
      })
      .mockResolvedValueOnce({
        device_code: "device-b",
        user_code: "user-b",
        verification_url: "https://google.test/device-b",
        expires_in: 600,
        interval: 5,
      });
    await grant(request("/api/google/device-grant"));
    const tokenPending = deferred<any>();
    mocks.getStoredTokensStrict.mockReturnValueOnce(tokenPending.promise);

    const disconnectPromise = revoke(request("/api/google/device-revoke", { action: "disconnect" }));
    await vi.waitFor(() => expect(mocks.getStoredTokensStrict).toHaveBeenCalledTimes(1));

    let secondResolved = false;
    const secondPromise = grant(request("/api/google/device-grant")).then((response) => {
      secondResolved = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.requestDeviceGrant).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondResolved).toBe(false);

    tokenPending.resolve({ access_token: "access", refresh_token: "refresh", revoked_at: null });
    const disconnectResponse = await disconnectPromise;
    const secondResponse = await secondPromise;
    expect(disconnectResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
  });

  it("does not mark a null pre-save result as a grant for cancellation", async () => {
    const grantResponse = await grant(request("/api/google/device-grant"));
    const grantBody = await grantResponse.json();

    const committed = await withDeviceAttemptCommit(grantBody.attempt_id, async () => null);
    const cancelResponse = await revoke(request("/api/google/device-revoke", {
      action: "cancel",
      attempt_id: grantBody.attempt_id,
    }));

    expect(committed).toBeNull();
    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.json()).toMatchObject({ ok: true, outcome: "cancelled" });
    expect(mocks.revokeTokens).not.toHaveBeenCalled();
    expect(mocks.clearDirectGoogleCache).not.toHaveBeenCalled();
  });

  it("invalidates a pending attempt before a deferred poll can persist tokens", async () => {
    const grantResponse = await grant(request("/api/google/device-grant"));
    const grantBody = await grantResponse.json();
    expect(typeof grantBody.attempt_id).toBe("string");

    const pending = deferred<any>();
    mocks.pollForToken.mockReturnValueOnce(pending.promise);
    const pollPromise = poll(request("/api/google/device-poll", {
      attempt_id: grantBody.attempt_id,
      device_code: "device-code",
    }));
    await vi.waitFor(() => expect(mocks.pollForToken).toHaveBeenCalledTimes(1));

    const revokeResponse = await revoke(request("/api/google/device-revoke", {
      action: "cancel",
      attempt_id: grantBody.attempt_id,
    }));
    expect(revokeResponse.status).toBe(200);

    pending.resolve({
      status: "complete",
      tokens: {
        status: "complete",
        access_token: "access",
        refresh_token: "refresh",
        id_token: null,
        expires_in: 3600,
        scope: "calendar",
        token_type: "Bearer",
      },
    });
    const pollResponse = await pollPromise;

    expect(pollResponse.status).toBeGreaterThanOrEqual(400);
    expect(mocks.saveTokens).not.toHaveBeenCalled();
    expect((await pollResponse.json()).error).toMatch(/attempt|cancel|revoke/i);
  });
});
