import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  googleFetch: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("../../src/lib/google/oauth-client.ts", () => ({
  googleFetch: mocks.googleFetch,
}));

vi.mock("../../src/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { syncCalendar } from "../../src/lib/google/calendar.ts";

function pbMock() {
  const stateUpdates: any[] = [];
  const eventCreates: any[] = [];
  const pb = {
    collection: (name: string) => {
      if (name === "consuela_google_sync_state") {
        return {
          getFullList: async () => [{ id: "state-row", resource: "calendar", sync_token: "STALE_TOKEN" }],
          update: async (_id: string, payload: any) => {
            stateUpdates.push(payload);
            return { id: "state-row" };
          },
          create: async (payload: any) => {
            stateUpdates.push(payload);
            return { id: "new-row" };
          },
        };
      }
      return {
        getFullList: async () => [],
        create: async (row: any) => {
          eventCreates.push(row);
          return { id: "ev1" };
        },
        update: async () => ({ id: "x" }),
        delete: async () => ({}),
      };
    },
  };
  return { pb, stateUpdates, eventCreates };
}

beforeEach(() => {
  mocks.googleFetch.mockReset();
  mocks.withAdmin.mockReset();
});

describe("syncCalendar — expired sync token (HTTP 410)", () => {
  it("clears the invalid token and falls back to a full resync in the same run", async () => {
    const { pb, stateUpdates } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    mocks.googleFetch
      .mockRejectedValueOnce(Object.assign(new Error("Google API 410: Sync token is no longer valid."), { status: 410 }))
      .mockResolvedValueOnce({
        status: 200,
        data: {
          items: [
            {
              id: "g1",
              status: "confirmed",
              summary: "Dentist",
              start: { dateTime: "2026-08-25T10:00:00Z" },
              end: { dateTime: "2026-08-25T11:00:00Z" },
            },
          ],
          nextSyncToken: "FRESH_TOKEN",
        },
        headers: new Headers(),
      });

    const outcome = await syncCalendar();

    expect("skipped" in (outcome as object)).toBe(false);
    expect((outcome as any).events).toBe(1);
    expect(mocks.googleFetch).toHaveBeenCalledTimes(2);

    // Second call must be a FULL resync: no syncToken, explicit window instead
    const secondCall = mocks.googleFetch.mock.calls[1][1] as { query: Record<string, unknown> };
    expect(secondCall.query.syncToken).toBeUndefined();
    expect(secondCall.query.timeMin).toBeTruthy();
    expect(secondCall.query.timeMax).toBeTruthy();

    // The fresh token replaces the dead one and status is ok
    expect(stateUpdates).toHaveLength(1);
    expect(stateUpdates[0].sync_token).toBe("FRESH_TOKEN");
    expect(stateUpdates[0].last_status).toBe("ok");
  });

  it("still fails loudly for non-410 errors without wiping the token", async () => {
    const { pb, stateUpdates } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    mocks.googleFetch.mockRejectedValueOnce(Object.assign(new Error("Google API 500: Backend Error"), { status: 500 }));

    await expect(syncCalendar()).rejects.toThrow("Google API 500");
    expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
    expect(stateUpdates).toHaveLength(0);
  });
});
