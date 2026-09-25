import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  authorizeCurrentParentRequest: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest }));

import {
  getPublicState,
  getStoredTokens,
  getStoredTokensStrict,
  revokeTokens,
  readPublicState,
  saveTokens,
} from "@/lib/google/token-store";
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
  mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { id: "m1", role: "parent" } });
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ==");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Google public token state", () => {
  it("distinguishes a genuinely absent token from disconnected", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([])));

    await expect(getStoredTokensStrict()).resolves.toBeNull();
    await expect(readPublicState()).resolves.toMatchObject({
      status: "available",
      state: { connected: false },
    });
    await expect(getPublicState()).resolves.toMatchObject({ connected: false });

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connected: false });
  });

  it("returns an unavailable result instead of disconnected when PB cannot be read", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("PB unavailable"));

    await expect(readPublicState()).resolves.toEqual({
      status: "unavailable",
      error: "google_state_unavailable",
    });
    await expect(getPublicState()).rejects.toThrow("google_state_unavailable");
    await expect(getStoredTokensStrict()).rejects.toThrow("PB unavailable");
    await expect(getStoredTokens()).resolves.toBeNull();

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

  it("reads an already-revoked row without treating cleared token fields as corruption", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([{
      access_token: null,
      refresh_token: null,
      scope: "calendar",
      token_type: "Bearer",
      expires_at: "2035-01-01T00:00:00.000Z",
      account_email: "family@example.com",
      granted_at: "2034-01-01T00:00:00.000Z",
      revoked_at: "2034-06-01T00:00:00.000Z",
    }])));

    await expect(readPublicState()).resolves.toMatchObject({
      status: "available",
      state: {
        connected: false,
        revoked_at: "2034-06-01T00:00:00.000Z",
      },
    });
    await expect(getStoredTokensStrict()).resolves.toMatchObject({ revoked_at: "2034-06-01T00:00:00.000Z" });
    await expect(getStoredTokens()).resolves.toBeNull();
  });

  it("returns an unavailable result when stored token decryption fails", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([{
      access_token: "v1.bad.bad.bad",
      refresh_token: null,
      scope: "calendar",
      token_type: "Bearer",
      expires_at: "2035-01-01T00:00:00.000Z",
      account_email: "family@example.com",
      granted_at: "2034-01-01T00:00:00.000Z",
      revoked_at: null,
    }])));

    await expect(readPublicState()).resolves.toEqual({
      status: "unavailable",
      error: "google_state_unavailable",
    });

    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      state: "unavailable",
      error: "google_state_unavailable",
    });
  });

  it("serializes concurrent grants into one active token row", async () => {
    const rows: any[] = [];
    let nextId = 1;
    const pb = {
      collection: () => ({
        getFullList: vi.fn(async () => rows),
        create: vi.fn(async (payload: any) => {
          await Promise.resolve();
          const row = { id: `row-${nextId++}`, ...payload };
          rows.push(row);
          return row;
        }),
        update: vi.fn(async (id: string, payload: any) => {
          const row = rows.find((candidate) => candidate.id === id);
          if (row) Object.assign(row, payload);
          return row;
        }),
        delete: vi.fn(async (id: string) => {
          const index = rows.findIndex((candidate) => candidate.id === id);
          if (index >= 0) rows.splice(index, 1);
        }),
      }),
    };
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pb));

    await Promise.all([
      saveTokens({ access_token: "access-a", refresh_token: "refresh-a", scope: "calendar", token_type: "Bearer", expires_in: 3600, account_email: "a@example.com" }),
      saveTokens({ access_token: "access-b", refresh_token: "refresh-b", scope: "calendar", token_type: "Bearer", expires_in: 3600, account_email: "b@example.com" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
  });

  it("revokes the newest canonical grant rather than the first row", async () => {
    const rows: any[] = [
      { id: "old", granted_at: "2030-01-01T00:00:00.000Z", access_token: "old-access", refresh_token: "old-refresh", revoked_at: null },
      { id: "new", granted_at: "2031-01-01T00:00:00.000Z", access_token: "new-access", refresh_token: "new-refresh", revoked_at: null },
    ];
    const pb = {
      collection: () => ({
        getFullList: vi.fn(async () => rows),
        update: vi.fn(async (id: string, payload: any) => {
          const row = rows.find((candidate) => candidate.id === id);
          if (row) Object.assign(row, payload);
          return row;
        }),
        delete: vi.fn(async (id: string) => {
          const index = rows.findIndex((candidate) => candidate.id === id);
          if (index >= 0) rows.splice(index, 1);
        }),
      }),
    };
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pb));

    await revokeTokens();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("new");
    expect(rows[0].revoked_at).toEqual(expect.any(String));
  });
});
