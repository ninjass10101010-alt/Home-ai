import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class ComposioError extends Error {
    code: string;
    status?: number;
    constructor(code: string, message: string, status?: number) {
      super(message);
      this.name = "ComposioError";
      this.code = code;
      this.status = status;
    }
  }
  return {
    ComposioError,
    authorizeAdminRequest: vi.fn(),
    authorizeCurrentParentRequest: vi.fn(),
    ensureGoogleCollections: vi.fn(),
    createConnectedAccountLink: vi.fn(),
    getConnectedAccount: vi.fn(),
    deleteConnectedAccount: vi.fn(),
    readConnectionSnapshot: vi.fn(),
    writeConnectionSnapshot: vi.fn(),
    disconnectGoogle: vi.fn(),
    syncCalendar: vi.fn(),
    clearDirectGoogleCache: vi.fn(),
    invalidateGoogleIntegrationOperation: vi.fn(),
  };
});

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest }));
vi.mock("@/lib/google/pb-collections", () => ({ ensureGoogleCollections: mocks.ensureGoogleCollections }));
vi.mock("@/lib/google/composio", () => ({
  ComposioError: mocks.ComposioError,
  COMPOSIO_TOOLKITS: { CALENDAR: "googlecalendar", TASKS: "googletasks" },
  createConnectedAccountLink: mocks.createConnectedAccountLink,
  getConnectedAccount: mocks.getConnectedAccount,
  deleteConnectedAccount: mocks.deleteConnectedAccount,
}));
vi.mock("@/lib/google/connection-state", () => ({
  TASKS_SNAPSHOT_KEY: "google_composio_tasks",
  readConnectionSnapshot: mocks.readConnectionSnapshot,
  writeConnectionSnapshot: mocks.writeConnectionSnapshot,
  disconnectGoogle: mocks.disconnectGoogle,
}));
vi.mock("@/lib/google/calendar", () => ({ syncCalendar: mocks.syncCalendar }));
vi.mock("@/lib/google/token-store", () => ({ clearDirectGoogleCache: mocks.clearDirectGoogleCache }));
vi.mock("@/lib/google/integration-operation", () => ({
  invalidateGoogleIntegrationOperation: mocks.invalidateGoogleIntegrationOperation,
}));

import { POST as setup } from "@/app/api/google/composio/setup/route";
import { GET as status } from "@/app/api/google/composio/status/route";
import { POST as disconnect } from "@/app/api/google/composio/disconnect/route";

const EMPTY_SNAPSHOT = {
  connectedAccountId: null,
  status: null,
  accountEmail: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

function post(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

const spies = [
  mocks.authorizeAdminRequest,
  mocks.authorizeCurrentParentRequest,
  mocks.ensureGoogleCollections,
  mocks.createConnectedAccountLink,
  mocks.getConnectedAccount,
  mocks.deleteConnectedAccount,
  mocks.readConnectionSnapshot,
  mocks.writeConnectionSnapshot,
  mocks.disconnectGoogle,
  mocks.syncCalendar,
  mocks.clearDirectGoogleCache,
  mocks.invalidateGoogleIntegrationOperation,
];

beforeEach(() => {
  for (const spy of spies) spy.mockReset();
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.authorizeCurrentParentRequest.mockResolvedValue({
    ok: true,
    member: { id: "m1", role: "parent" },
  });
  mocks.ensureGoogleCollections.mockResolvedValue([]);
  mocks.createConnectedAccountLink.mockResolvedValue({
    redirectUrl: "https://backend.composio.dev/link/abc",
    connectedAccountId: "ca_1",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  mocks.readConnectionSnapshot.mockResolvedValue({ ...EMPTY_SNAPSHOT });
  mocks.writeConnectionSnapshot.mockResolvedValue(undefined);
  mocks.disconnectGoogle.mockResolvedValue(undefined);
  mocks.syncCalendar.mockResolvedValue({ events: 0, deleted: 0, perCalendar: [] });
  mocks.clearDirectGoogleCache.mockResolvedValue(true);
  mocks.deleteConnectedAccount.mockResolvedValue(true);
  mocks.getConnectedAccount.mockResolvedValue(null);
});

describe("POST /api/google/composio/setup", () => {
  it("returns the hosted auth link for the calendar toolkit by default", async () => {
    const response = await setup(post("/api/google/composio/setup"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      toolkit: "googlecalendar",
      auth_url: "https://backend.composio.dev/link/abc",
      connected_account_id: "ca_1",
      expires_at: "2030-01-01T00:00:00.000Z",
    });
    expect(mocks.ensureGoogleCollections).toHaveBeenCalledTimes(1);
    expect(mocks.createConnectedAccountLink).toHaveBeenCalledWith("googlecalendar");
    expect(mocks.writeConnectionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca_1", status: "INITIATED" }),
      undefined,
    );
  });

  it("supports the optional tasks toolkit on its own snapshot key", async () => {
    const response = await setup(post("/api/google/composio/setup", { toolkit: "googletasks" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, toolkit: "googletasks" });
    expect(mocks.createConnectedAccountLink).toHaveBeenCalledWith("googletasks");
    expect(mocks.writeConnectionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca_1", status: "INITIATED" }),
      "google_composio_tasks",
    );
  });

  it("rejects an unknown toolkit", async () => {
    const response = await setup(post("/api/google/composio/setup", { toolkit: "gmail" }));

    expect(response.status).toBe(400);
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
    expect(mocks.createConnectedAccountLink).not.toHaveBeenCalled();
  });

  it("blocks a non-parent before collection setup or link creation", async () => {
    mocks.authorizeAdminRequest.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "adult_only",
    });

    const response = await setup(post("/api/google/composio/setup"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
    expect(mocks.createConnectedAccountLink).not.toHaveBeenCalled();
  });

  it.each([
    ["not_configured", 503],
    ["auth_failed", 401],
    ["api_error", 502],
  ] as const)("maps ComposioError %s to %i", async (code, expected) => {
    mocks.createConnectedAccountLink.mockRejectedValueOnce(
      new mocks.ComposioError(code, "composio says no"),
    );

    const response = await setup(post("/api/google/composio/setup"));

    expect(response.status).toBe(expected);
    expect(await response.json()).toMatchObject({ ok: false, code, error: "composio says no" });
    expect(mocks.writeConnectionSnapshot).not.toHaveBeenCalled();
  });

  it("returns 503 when the pending snapshot cannot be persisted", async () => {
    mocks.writeConnectionSnapshot.mockRejectedValueOnce(new Error("PB down"));

    const response = await setup(post("/api/google/composio/setup"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "google_state_unavailable" });
  });
});

describe("GET /api/google/composio/status", () => {
  it("reports disconnected when no account has been linked yet", async () => {
    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, connected: false });
    expect(mocks.getConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.writeConnectionSnapshot).not.toHaveBeenCalled();
    expect(mocks.syncCalendar).not.toHaveBeenCalled();
  });

  it("persists an ACTIVE account and triggers one sync", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_1",
      status: "INITIATED",
      accountEmail: null,
      connectedAt: null,
      lastVerifiedAt: null,
    });
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_1",
      status: "ACTIVE",
      toolkitSlug: "googlecalendar",
      email: "family@example.com",
    });

    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      connected: true,
      status: "ACTIVE",
      account_email: "family@example.com",
    });
    expect(mocks.getConnectedAccount).toHaveBeenCalledWith("ca_1");
    expect(mocks.writeConnectionSnapshot).toHaveBeenCalledTimes(1);
    const [patch, key] = mocks.writeConnectionSnapshot.mock.calls[0];
    expect(patch).toMatchObject({
      connectedAccountId: "ca_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
    });
    expect(typeof patch.connectedAt).toBe("string");
    expect(typeof patch.lastVerifiedAt).toBe("string");
    expect(key).toBeUndefined();
    expect(mocks.syncCalendar).toHaveBeenCalledTimes(1);
  });

  it("does not re-persist or re-sync an already ACTIVE connection", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastVerifiedAt: "2030-01-02T00:00:00.000Z",
    });
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_1",
      status: "ACTIVE",
      toolkitSlug: "googlecalendar",
      email: "family@example.com",
    });

    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connected: true, status: "ACTIVE" });
    expect(mocks.writeConnectionSnapshot).not.toHaveBeenCalled();
    expect(mocks.syncCalendar).not.toHaveBeenCalled();
  });

  it("reports a non-active account with its status and does not sync", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_1",
      status: "INITIATED",
      accountEmail: null,
      connectedAt: null,
      lastVerifiedAt: null,
    });
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_1",
      status: "FAILED",
      toolkitSlug: "googlecalendar",
      email: null,
    });

    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      connected: false,
      status: "FAILED",
    });
    expect(mocks.writeConnectionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
      undefined,
    );
    expect(mocks.syncCalendar).not.toHaveBeenCalled();
  });

  it("polls the tasks snapshot when toolkit=googletasks", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_tasks",
      status: "INITIATED",
      accountEmail: null,
      connectedAt: null,
      lastVerifiedAt: null,
    });
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_tasks",
      status: "ACTIVE",
      toolkitSlug: "googletasks",
      email: "family@example.com",
    });

    const response = await status(get("/api/google/composio/status?toolkit=googletasks"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connected: true, status: "ACTIVE" });
    expect(mocks.readConnectionSnapshot).toHaveBeenCalledWith("google_composio_tasks");
    expect(mocks.writeConnectionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca_tasks", status: "ACTIVE" }),
      "google_composio_tasks",
    );
  });

  it("rejects an unknown toolkit", async () => {
    const response = await status(get("/api/google/composio/status?toolkit=gmail"));

    expect(response.status).toBe(400);
    expect(mocks.readConnectionSnapshot).not.toHaveBeenCalled();
  });

  it("returns 503 google_state_unavailable when PocketBase cannot be read", async () => {
    mocks.readConnectionSnapshot.mockRejectedValueOnce(new Error("PB down"));

    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "google_state_unavailable" });
    expect(mocks.getConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.writeConnectionSnapshot).not.toHaveBeenCalled();
  });

  it("maps a Composio status-check failure instead of reporting a false disconnect", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastVerifiedAt: "2030-01-02T00:00:00.000Z",
    });
    mocks.getConnectedAccount.mockRejectedValueOnce(
      new mocks.ComposioError("api_error", "Composio error (500)", 500),
    );

    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, code: "api_error" });
    expect(mocks.writeConnectionSnapshot).not.toHaveBeenCalled();
  });

  it("blocks a non-parent session", async () => {
    mocks.authorizeCurrentParentRequest.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "adult_only",
    });

    const response = await status(get("/api/google/composio/status"));

    expect(response.status).toBe(403);
    expect(mocks.readConnectionSnapshot).not.toHaveBeenCalled();
  });
});

describe("POST /api/google/composio/disconnect", () => {
  it("deletes the remote account, clears the snapshot and prunes the cache", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastVerifiedAt: "2030-01-02T00:00:00.000Z",
    });

    const response = await disconnect(post("/api/google/composio/disconnect"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      outcome: "disconnected",
      remoteRevoked: true,
      localRevoked: true,
    });
    expect(mocks.deleteConnectedAccount).toHaveBeenCalledWith("ca_1");
    expect(mocks.disconnectGoogle).toHaveBeenCalledTimes(1);
    expect(mocks.clearDirectGoogleCache).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateGoogleIntegrationOperation).toHaveBeenCalledTimes(1);
  });

  it("reports local_only when the remote delete fails", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "ca_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastVerifiedAt: "2030-01-02T00:00:00.000Z",
    });
    mocks.deleteConnectedAccount.mockRejectedValueOnce(
      new mocks.ComposioError("api_error", "Composio error (500)", 500),
    );

    const response = await disconnect(post("/api/google/composio/disconnect"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      outcome: "local_only",
      remoteRevoked: false,
      localRevoked: true,
    });
    expect(typeof body.warning).toBe("string");
    expect(body.warning.length).toBeGreaterThan(0);
    expect(mocks.disconnectGoogle).toHaveBeenCalledTimes(1);
    expect(mocks.clearDirectGoogleCache).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateGoogleIntegrationOperation).toHaveBeenCalledTimes(1);
  });

  it("still clears locally when no account id is stored", async () => {
    const response = await disconnect(post("/api/google/composio/disconnect"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      outcome: "disconnected",
      remoteRevoked: true,
      localRevoked: true,
    });
    expect(mocks.deleteConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.disconnectGoogle).toHaveBeenCalledTimes(1);
    expect(mocks.clearDirectGoogleCache).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateGoogleIntegrationOperation).toHaveBeenCalledTimes(1);
  });

  it("blocks a non-parent before touching the connection", async () => {
    mocks.authorizeAdminRequest.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "adult_only",
    });

    const response = await disconnect(post("/api/google/composio/disconnect"));

    expect(response.status).toBe(403);
    expect(mocks.readConnectionSnapshot).not.toHaveBeenCalled();
    expect(mocks.deleteConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.disconnectGoogle).not.toHaveBeenCalled();
  });
});
