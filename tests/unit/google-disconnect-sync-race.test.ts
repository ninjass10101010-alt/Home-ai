import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  googleFetch: vi.fn(),
  withAdmin: vi.fn(),
  authorizeAdminRequest: vi.fn(),
  revokeGoogleToken: vi.fn(),
  getStoredTokensStrict: vi.fn(),
  revokeTokens: vi.fn(),
  clearDirectGoogleCache: vi.fn(),
  invalidateDeviceAttempt: vi.fn(),
  cancelDeviceAttempt: vi.fn(),
  invalidateAllDeviceAttempts: vi.fn(),
}));

vi.mock("@/lib/google/oauth-client.ts", () => ({ googleFetch: mocks.googleFetch }));
vi.mock("@/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/google/device-auth", () => ({ revokeGoogleToken: mocks.revokeGoogleToken }));
vi.mock("@/lib/google/device-attempts", () => ({
  invalidateDeviceAttempt: mocks.invalidateDeviceAttempt,
  cancelDeviceAttempt: mocks.cancelDeviceAttempt,
  invalidateAllDeviceAttempts: mocks.invalidateAllDeviceAttempts,
}));
vi.mock("@/lib/google/token-store", () => ({
  getStoredTokensStrict: mocks.getStoredTokensStrict,
  revokeTokens: mocks.revokeTokens,
  clearDirectGoogleCache: mocks.clearDirectGoogleCache,
}));

import { syncCalendar } from "@/lib/google/calendar";
import { POST as revoke } from "@/app/api/google/device-revoke/route";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function pbMock(eventRows: any[]) {
  const calendarRows = [{ id: "cal", calendar_id: "primary", summary: "Primary", selected: true, sync_token: null }];
  return {
    calendarRows,
    eventRows,
    collection: (name: string) => {
      if (name === "consuela_google_calendar_sync") {
        return {
          getFullList: async (args: any = {}) => {
            const match = /calendar_id = "([^"]*)"/.exec(args?.filter || "");
            return match ? calendarRows.filter((row) => row.calendar_id === match[1]) : calendarRows;
          },
          update: async (id: string, payload: any) => Object.assign(calendarRows.find((row) => row.id === id) || {}, payload),
          create: async (payload: any) => {
            const row = { id: "new-cal", ...payload };
            calendarRows.push(row);
            return row;
          },
        };
      }
      if (name === "consuela_google_calendar_events") {
        return {
          getFullList: async (args: any = {}) => {
            const filter = args?.filter || "";
            const match = /calendar_id = "([^"]*)"/.exec(filter);
            return match ? eventRows.filter((row) => row.calendar_id === match[1]) : eventRows;
          },
          create: async (row: any) => {
            const created = { id: `event-${eventRows.length + 1}`, ...row };
            eventRows.push(created);
            return created;
          },
          update: async () => ({}),
          delete: async (id: string) => {
            const index = eventRows.findIndex((row) => row.id === id);
            if (index >= 0) eventRows.splice(index, 1);
          },
        };
      }
      return { getFullList: async () => [], create: async () => ({}), update: async () => ({}), delete: async () => ({}) };
    },
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.invalidateDeviceAttempt.mockResolvedValue(true);
  mocks.cancelDeviceAttempt.mockResolvedValue({ found: true, shouldClearGrant: true });
  mocks.invalidateAllDeviceAttempts.mockImplementation(async (cleanup?: () => Promise<unknown>) => cleanup ? cleanup() : undefined);
  mocks.revokeGoogleToken.mockResolvedValue(true);
  mocks.getStoredTokensStrict.mockResolvedValue({ access_token: "access", refresh_token: "refresh", revoked_at: null });
  mocks.revokeTokens.mockResolvedValue(true);
});

describe("Google calendar sync and disconnect serialization", () => {
  it("does not recreate event rows after a deferred read and direct cleanup", async () => {
    const releaseFetch = deferred<void>();
    const store = pbMock([]);
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(store));
    mocks.googleFetch.mockImplementation(async () => {
      await releaseFetch.promise;
      return {
        status: 200,
        data: {
          items: [{
            id: "remote-1",
            status: "confirmed",
            summary: "Late event",
            start: { dateTime: "2026-09-25T10:00:00Z" },
            end: { dateTime: "2026-09-25T11:00:00Z" },
          }],
          nextSyncToken: "TOKEN",
        },
        headers: new Headers(),
      };
    });
    mocks.clearDirectGoogleCache.mockImplementation(async () => {
      store.eventRows.length = 0;
      store.calendarRows.length = 0;
      return true;
    });

    const syncPromise = syncCalendar();
    await vi.waitFor(() => expect(mocks.googleFetch).toHaveBeenCalledTimes(1));
    const revokePromise = revoke(new NextRequest("http://localhost/api/google/device-revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFetch.resolve(undefined);
    const [, revokeResponse] = await Promise.all([syncPromise, revokePromise]);

    expect(revokeResponse.status).toBe(200);
    expect(store.eventRows).toHaveLength(0);
  });
});
