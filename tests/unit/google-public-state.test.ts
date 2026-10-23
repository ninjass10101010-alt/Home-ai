// Task 13 — GET /api/google/state is Composio-only now.
//
// The direct token-store (`consuela_google_tokens`) is gone, so this file
// covers the public state route against the connection snapshot store: an
// absent snapshot is disconnected, an ACTIVE Composio snapshot reports the
// calendar account email/connected-at, and a PocketBase read failure is an
// unavailable state — never a false disconnect.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  authorizeCurrentParentRequest: vi.fn(),
  listConnectedAccounts: vi.fn(),
  getConnectedAccount: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest }));

vi.mock("@/lib/google/composio", () => ({
  listConnectedAccounts: mocks.listConnectedAccounts,
  getConnectedAccount: mocks.getConnectedAccount,
}));

import { GET } from "@/app/api/google/state/route";

function pbForRows(rows: unknown[]) {
  return {
    collection: () => ({
      getFullList: vi.fn(async () => rows),
    }),
  };
}

function request() {
  return new NextRequest("http://localhost/api/google/state", { headers: { cookie: "consuela_session=token" } });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.listConnectedAccounts.mockReset();
  mocks.getConnectedAccount.mockReset();
  mocks.listConnectedAccounts.mockResolvedValue([]);
  mocks.getConnectedAccount.mockResolvedValue(null);
  mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { id: "m1", role: "parent" } });
});

describe("Google public connection state (Composio)", () => {
  it("reports disconnected when no Composio snapshot exists", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([])));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      connected: false,
      pending: false,
      connection_status: null,
      account_email: null,
      granted_at: null,
      revoked_at: null,
      expires_at: null,
      scope: null,
      minutes_until_expiry: null,
    });
  });

  it("reports a pending sign-in instead of hiding it as disconnected", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([{
      key: "google_composio_connection",
      data: {
        connectedAccountId: "composio-account-pending",
        status: "INITIALIZING",
        accountEmail: null,
        connectedAt: null,
        lastVerifiedAt: "2026-09-24T00:00:00.000Z",
      },
    }])));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      connected: false,
      pending: true,
      connection_status: "INITIALIZING",
      account_email: null,
      granted_at: null,
      revoked_at: null,
      expires_at: null,
      scope: null,
      minutes_until_expiry: null,
    });
  });

  it("reports a connected Composio snapshot in the hook's state shape", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([{
      key: "google_composio_connection",
      data: {
        connectedAccountId: "composio-account-1",
        status: "ACTIVE",
        accountEmail: "family@example.com",
        connectedAt: "2026-09-24T00:00:00.000Z",
        lastVerifiedAt: "2026-09-24T00:00:00.000Z",
      },
    }])));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      connected: true,
      pending: false,
      connection_status: "ACTIVE",
      account_email: "family@example.com",
      granted_at: "2026-09-24T00:00:00.000Z",
      revoked_at: null,
      expires_at: null,
      scope: null,
      minutes_until_expiry: null,
    });
  });

  it("returns an unavailable result instead of disconnected when PB cannot be read", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("PB unavailable"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      state: "unavailable",
      error: "google_state_unavailable",
    });
    expect(body).not.toHaveProperty("connected");
  });
});
