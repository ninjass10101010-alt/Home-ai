import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  listConnectedAccounts: vi.fn(),
  getConnectedAccount: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/google/composio", () => ({
  listConnectedAccounts: mocks.listConnectedAccounts,
  getConnectedAccount: mocks.getConnectedAccount,
}));

import {
  clearConnectionSnapshot,
  disconnectGoogle,
  GoogleAuthError,
  isGoogleConnected,
  mapGoogleAuthError,
  readConnectionSnapshot,
  reconcileGoogleConnection,
  TASKS_SNAPSHOT_KEY,
  writeConnectionSnapshot,
} from "@/lib/google/connection-state";

const EMPTY_SNAPSHOT = {
  connectedAccountId: null,
  status: null,
  accountEmail: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

function pbForRows(rows: unknown[]) {
  return {
    collection: () => ({
      getFullList: vi.fn(async () => rows),
      create: vi.fn(async (payload: unknown) => ({ id: "row-new", ...(payload as object) })),
      update: vi.fn(async (id: string, payload: unknown) => ({ id, ...(payload as object) })),
      delete: vi.fn(async () => true),
    }),
  };
}

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    key: "google_composio_connection",
    data: {
      connectedAccountId: "ca_calendar_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastVerifiedAt: "2030-01-02T00:00:00.000Z",
      ...overrides,
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.listConnectedAccounts.mockReset();
  mocks.getConnectedAccount.mockReset();
  mocks.listConnectedAccounts.mockResolvedValue([]);
  mocks.getConnectedAccount.mockResolvedValue(null);
});

describe("google connection snapshot store", () => {
  it("returns an empty snapshot and reports disconnected when no row exists", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([])));

    await expect(readConnectionSnapshot()).resolves.toEqual(EMPTY_SNAPSHOT);
    await expect(isGoogleConnected()).resolves.toBe(false);
  });

  it("reports connected when the snapshot is ACTIVE", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbForRows([activeRow()])));

    await expect(readConnectionSnapshot()).resolves.toEqual({
      connectedAccountId: "ca_calendar_1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastVerifiedAt: "2030-01-02T00:00:00.000Z",
    });
    await expect(isGoogleConnected()).resolves.toBe(true);
  });

  it("adopts an ACTIVE Composio calendar account when the snapshot was lost", async () => {
    const rows: any[] = [];
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFullList: vi.fn(async () => rows),
          create: vi.fn(async (payload: any) => {
            const row = { id: "row-new", ...payload };
            rows.push(row);
            return row;
          }),
          update: vi.fn(async (id: string, payload: any) => {
            const row = { id, ...payload };
            rows[0] = row;
            return row;
          }),
          delete: vi.fn(async () => true),
        }),
      })
    );
    mocks.listConnectedAccounts.mockResolvedValueOnce([
      { id: "ca_live", status: "ACTIVE", toolkitSlug: "googlecalendar", email: "family@example.com" },
    ]);

    await expect(reconcileGoogleConnection()).resolves.toMatchObject({
      connectedAccountId: "ca_live",
      status: "ACTIVE",
      accountEmail: "family@example.com",
    });
    expect(mocks.listConnectedAccounts).toHaveBeenCalledWith("googlecalendar");
    expect(rows[0]?.data).toMatchObject({
      connectedAccountId: "ca_live",
      status: "ACTIVE",
      accountEmail: "family@example.com",
    });
  });

  it("replaces a stale pending snapshot with a newly ACTIVE account", async () => {
    const rows = [{
      id: "row-1",
      key: "google_composio_connection",
      data: {
        connectedAccountId: "ca_pending",
        status: "INITIALIZING",
        accountEmail: null,
        connectedAt: null,
        lastVerifiedAt: null,
      },
    }];
    const update = vi.fn(async (id: string, payload: any) => {
      const row = { id, ...payload };
      rows[0] = row;
      return row;
    });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFullList: vi.fn(async () => rows),
          create: vi.fn(),
          update,
          delete: vi.fn(async () => true),
        }),
      })
    );
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_pending",
      status: "FAILED",
      toolkitSlug: "googlecalendar",
      email: null,
    });
    mocks.listConnectedAccounts.mockResolvedValueOnce([
      { id: "ca_live", status: "ACTIVE", toolkitSlug: "googlecalendar", email: "family@example.com" },
    ]);

    await expect(reconcileGoogleConnection()).resolves.toMatchObject({
      connectedAccountId: "ca_live",
      status: "ACTIVE",
    });
    expect(update).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({
        data: expect.objectContaining({ connectedAccountId: "ca_live", status: "ACTIVE" }),
      }),
      expect.anything(),
    );
  });

  it("leaves a genuinely pending snapshot pending when no account is ACTIVE", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn(pbForRows([activeRow({ status: "INITIALIZING" })]))
    );
    mocks.getConnectedAccount.mockResolvedValueOnce({
      id: "ca_calendar_1",
      status: "INITIALIZING",
      toolkitSlug: "googlecalendar",
      email: null,
    });

    await expect(reconcileGoogleConnection()).resolves.toMatchObject({
      connectedAccountId: "ca_calendar_1",
      status: "INITIALIZING",
    });
    expect(mocks.listConnectedAccounts).toHaveBeenCalledWith("googlecalendar");
  });

  it("reports disconnected when the snapshot is FAILED even with an account id", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn(pbForRows([activeRow({ status: "FAILED" })]))
    );

    await expect(isGoogleConnected()).resolves.toBe(false);
  });

  it("reports disconnected when ACTIVE has no connected account id", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn(pbForRows([activeRow({ connectedAccountId: null })]))
    );

    await expect(isGoogleConnected()).resolves.toBe(false);
  });

  it("rejects with GoogleAuthError unavailable when PocketBase cannot be read", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("PB unavailable"));

    await expect(isGoogleConnected()).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(isGoogleConnected()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("reads and writes the calendar snapshot under the calendar key by default", async () => {
    const getFullList = vi.fn(async (_options?: Record<string, unknown>) => []);
    const create = vi.fn(async (payload: unknown) => ({ id: "row-new", ...(payload as object) }));
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({ collection: () => ({ getFullList, create, update: vi.fn(), delete: vi.fn() }) })
    );

    await readConnectionSnapshot();
    await writeConnectionSnapshot({ status: "ACTIVE" });

    for (const call of getFullList.mock.calls) {
      expect(call[0]).toMatchObject({ filter: 'key = "google_composio_connection"' });
    }
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "google_composio_connection", data: expect.objectContaining({ status: "ACTIVE" }) }),
      expect.anything()
    );
  });

  it("supports an explicit snapshot key for the optional Tasks connection", async () => {
    const getFullList = vi.fn(async () => []);
    const create = vi.fn(async (payload: unknown) => ({ id: "row-new", ...(payload as object) }));
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({ collection: () => ({ getFullList, create, update: vi.fn(), delete: vi.fn() }) })
    );

    await writeConnectionSnapshot({ connectedAccountId: "ca_tasks_1", status: "ACTIVE" }, TASKS_SNAPSHOT_KEY);

    expect(TASKS_SNAPSHOT_KEY).toBe("google_composio_tasks");
    expect(getFullList).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'key = "google_composio_tasks"' })
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "google_composio_tasks" }),
      expect.anything()
    );
  });

  it("updates the existing row with the merged patch instead of creating", async () => {
    const getFullList = vi.fn(async () => [activeRow({ status: "FAILED" })]);
    const create = vi.fn();
    const update = vi.fn(async (id: string, payload: unknown) => ({ id, ...(payload as object) }));
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({ collection: () => ({ getFullList, create, update, delete: vi.fn() }) })
    );

    await writeConnectionSnapshot({ status: "ACTIVE", lastVerifiedAt: "2030-02-01T00:00:00.000Z" });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({
        key: "google_composio_connection",
        data: expect.objectContaining({
          connectedAccountId: "ca_calendar_1",
          accountEmail: "family@example.com",
          connectedAt: "2030-01-01T00:00:00.000Z",
          status: "ACTIVE",
          lastVerifiedAt: "2030-02-01T00:00:00.000Z",
        }),
      }),
      expect.anything()
    );
  });

  it("clears the snapshot rows (disconnectGoogle)", async () => {
    const rows = [activeRow(), { id: "row-2", key: "google_composio_connection", data: {} }];
    const deleted: string[] = [];
    const del = vi.fn(async (id: string) => {
      deleted.push(id);
    });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({ collection: () => ({ getFullList: vi.fn(async () => rows), create: vi.fn(), update: vi.fn(), delete: del }) })
    );

    await disconnectGoogle();

    expect(del).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual(["row-1", "row-2"]);
  });
});

describe("mapGoogleAuthError", () => {
  it("maps unavailable and not_configured to 503, no_grant to 409, and other auth codes to 401", () => {
    expect(mapGoogleAuthError(new GoogleAuthError("unavailable", "state down"))).toEqual({
      status: 503,
      body: { ok: false, code: "unavailable", error: "state down" },
    });
    expect(mapGoogleAuthError(new GoogleAuthError("not_configured", "no broker key"))).toEqual({
      status: 503,
      body: { ok: false, code: "not_configured", error: "no broker key" },
    });
    expect(mapGoogleAuthError(new GoogleAuthError("no_grant", "not connected"))).toEqual({
      status: 409,
      body: { ok: false, code: "no_grant", error: "not connected" },
    });
    for (const code of ["revoked", "expired", "refresh_failed", "config"] as const) {
      expect(mapGoogleAuthError(new GoogleAuthError(code, "nope"))).toEqual({
        status: 401,
        body: { ok: false, code, error: "nope" },
      });
    }
  });

  it("maps unknown errors to 500 with code unknown", () => {
    expect(mapGoogleAuthError(new Error("boom"))).toEqual({
      status: 500,
      body: { ok: false, code: "unknown", error: "boom" },
    });
  });
});
