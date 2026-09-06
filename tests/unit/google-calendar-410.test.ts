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

// Multi-calendar world (Fix-C): per-calendar tokens live in
// consuela_google_calendar_sync. This mock seeds the primary calendar's row
// with the stale token (mirroring the post-migration state).
function pbMock() {
  const calUpdates: any[] = [];
  const eventCreates: any[] = [];
  const calRow = {
    id: "cal-row",
    calendar_id: "primary",
    summary: "Primary",
    selected: true,
    sync_token: "STALE_TOKEN",
  };
  const pb = {
    collection: (name: string) => {
      if (name === "consuela_google_calendar_sync") {
        return {
          getFullList: async () => [calRow],
          update: async (_id: string, payload: any) => {
            calUpdates.push(payload);
            return { id: "cal-row" };
          },
          create: async (payload: any) => {
            calUpdates.push(payload);
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
  return { pb, calUpdates, eventCreates };
}

beforeEach(() => {
  mocks.googleFetch.mockReset();
  mocks.withAdmin.mockReset();
});

describe("syncCalendar — expired sync token (HTTP 410)", () => {
  it("clears the invalid token and falls back to a full resync in the same run", async () => {
    const { pb, calUpdates } = pbMock();
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
    const saved = calUpdates.find((p) => p.last_status === "ok");
    expect(saved).toBeTruthy();
    expect(saved.sync_token).toBe("FRESH_TOKEN");
    expect(saved.calendar_id).toBe("primary");
  });

  it("isolates a non-410 failure to the calendar (recorded, token untouched, run completes)", async () => {
    const { pb, calUpdates } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    mocks.googleFetch.mockRejectedValueOnce(Object.assign(new Error("Google API 500: Backend Error"), { status: 500 }));

    const outcome = (await syncCalendar()) as any;

    expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
    expect(outcome.perCalendar).toHaveLength(1);
    expect(outcome.perCalendar[0].ok).toBe(false);
    expect(outcome.perCalendar[0].error).toContain("Google API 500");
    expect(outcome.events).toBe(0);

    // The failure is recorded against the calendar WITHOUT wiping its token
    const errSave = calUpdates.find((p) => p.last_status === "error");
    expect(errSave).toBeTruthy();
    expect(errSave.last_error).toContain("Google API 500");
    expect("sync_token" in errSave).toBe(false);
  });
});
