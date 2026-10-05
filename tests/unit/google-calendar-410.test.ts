import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("../../src/lib/google/composio.ts", () => ({
  executeComposioAction: mocks.execute,
}));

vi.mock("../../src/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { syncCalendar } from "../../src/lib/google/calendar.ts";

// This suite replaces the old direct-Google HTTP 410 fallback tests. There is
// no incremental sync token under Composio (no SYNC_EVENTS action), so a
// persisted `sync_token` is dead state: it is never read, never sent, and
// never overwritten by a full-window pull. The filename is kept so the
// focused verification command stays stable.
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
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async () => [{ id: "snap", data: { connectedAccountId: "ca_test", status: "ACTIVE" } }],
          create: async () => ({}),
          update: async () => ({}),
          delete: async () => ({}),
        };
      }
      if (name === "consuela_google_calendar_sync") {
        return {
          getFullList: async () => [calRow],
          update: async (_id: string, payload: any) => {
            calUpdates.push(payload);
            Object.assign(calRow, payload);
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

function composioApiError(status: number) {
  return Object.assign(new Error(`Composio error (${status})`), { code: "api_error", status });
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.withAdmin.mockReset();
});

describe("syncCalendar — persisted sync tokens are ignored (Composio full-window)", () => {
  it("full-pulls with an explicit window, never sends the stale token, and leaves it untouched", async () => {
    const { pb, calUpdates, eventCreates } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    mocks.execute.mockResolvedValueOnce({
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
      },
      successful: true,
      error: null,
    });

    const outcome = await syncCalendar();

    expect("skipped" in (outcome as object)).toBe(false);
    expect((outcome as any).events).toBe(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    const [action, args, accountId] = mocks.execute.mock.calls[0];
    expect(action).toBe("GOOGLECALENDAR_EVENTS_LIST");
    expect(accountId).toBe("ca_test");
    expect(args.syncToken).toBeUndefined();
    expect(args.page_token).toBeUndefined();
    expect(args.time_min).toBeTruthy();
    expect(args.time_max).toBeTruthy();
    expect(eventCreates).toHaveLength(1);

    // The fresh state says ok but does not touch the (dead) token field.
    const saved = calUpdates.find((p) => p.last_status === "ok");
    expect(saved).toBeTruthy();
    expect("sync_token" in saved).toBe(false);
    expect(saved.calendar_id).toBe("primary");
  });

  it("isolates a non-auth Composio failure to the calendar (recorded, token untouched, run completes)", async () => {
    const { pb, calUpdates } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    mocks.execute.mockRejectedValueOnce(composioApiError(500));

    const outcome = (await syncCalendar()) as any;

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(outcome.perCalendar).toHaveLength(1);
    expect(outcome.perCalendar[0].ok).toBe(false);
    expect(outcome.perCalendar[0].error).toContain("Composio error (500)");
    expect(outcome.events).toBe(0);

    // The failure is recorded against the calendar WITHOUT wiping its token
    const errSave = calUpdates.find((p) => p.last_status === "error");
    expect(errSave).toBeTruthy();
    expect(errSave.last_error).toContain("Composio error (500)");
    expect("sync_token" in errSave).toBe(false);
  });
});
