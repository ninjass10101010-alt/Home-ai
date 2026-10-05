// Task 13 — Composio-era sync/disconnect serialization contract.
//
// The direct Device Flow route that this file used to drive is gone. The
// disconnect path now is: clearConnectionSnapshot() (drop the Composio
// snapshot), invalidateGoogleIntegrationOperation() (bump the generation),
// clearCalendarCache() (prune cached calendar rows). This test proves the
// ordering guarantee that a late in-flight Composio pull cannot resurrect a
// disconnected calendar: the sync captured the generation BEFORE the pull,
// re-checks it after the pull resolves, and must bail before any PocketBase
// upsert once the disconnect bumped it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeComposioAction: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/google/composio", () => ({
  executeComposioAction: mocks.executeComposioAction,
}));
vi.mock("@/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { syncCalendar } from "@/lib/google/calendar";
import { clearConnectionSnapshot } from "@/lib/google/connection-state";
import {
  __resetGoogleIntegrationOperationForTests,
  invalidateGoogleIntegrationOperation,
} from "@/lib/google/integration-operation";
import { clearCalendarCache } from "@/lib/google/token-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function pbMock() {
  const snapshotRows: any[] = [{
    id: "snap",
    key: "google_composio_connection",
    data: { connectedAccountId: "ca_1", status: "ACTIVE" },
  }];
  const calendarRows: any[] = [
    { id: "cal", calendar_id: "primary", summary: "Primary", selected: true, sync_token: null },
  ];
  const eventRows: any[] = [
    { id: "evt-cached", google_id: "old-remote", calendar_id: "primary", summary: "Cached event" },
  ];
  const writes = {
    eventCreates: [] as any[],
    eventUpdates: [] as any[],
    eventDeletes: [] as string[],
    calendarWrites: [] as any[],
  };

  const pb = {
    collection: (name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async (args: any = {}) => {
            const match = /key = "([^"]+)"/.exec(args?.filter || "");
            return match ? snapshotRows.filter((row) => row.key === match[1]) : snapshotRows;
          },
          delete: async (id: string) => {
            const index = snapshotRows.findIndex((row) => row.id === id);
            if (index >= 0) snapshotRows.splice(index, 1);
          },
          create: async () => ({}),
          update: async () => ({}),
        };
      }
      if (name === "consuela_google_calendar_sync") {
        return {
          getFullList: async (args: any = {}) => {
            const match = /calendar_id = "([^"]+)"/.exec(args?.filter || "");
            return match ? calendarRows.filter((row) => row.calendar_id === match[1]) : calendarRows;
          },
          update: async (id: string, payload: any) => {
            writes.calendarWrites.push({ op: "update", id, payload });
            return {};
          },
          create: async (payload: any) => {
            writes.calendarWrites.push({ op: "create", payload });
            return { id: "new-cal" };
          },
          delete: async (id: string) => {
            writes.calendarWrites.push({ op: "delete", id });
            const index = calendarRows.findIndex((row) => row.id === id);
            if (index >= 0) calendarRows.splice(index, 1);
          },
        };
      }
      if (name === "consuela_google_calendar_events") {
        return {
          getFullList: async () => eventRows,
          create: async (row: any) => {
            writes.eventCreates.push(row);
            const created = { id: `event-${eventRows.length + 1}`, ...row };
            eventRows.push(created);
            return created;
          },
          update: async (id: string, row: any) => {
            writes.eventUpdates.push({ id, row });
            return {};
          },
          delete: async (id: string) => {
            writes.eventDeletes.push(id);
            const index = eventRows.findIndex((row) => row.id === id);
            if (index >= 0) eventRows.splice(index, 1);
          },
        };
      }
      return {
        getFullList: async () => [],
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
      };
    },
  };
  return { pb, writes, snapshotRows, calendarRows, eventRows };
}

beforeEach(() => {
  mocks.executeComposioAction.mockReset();
  mocks.withAdmin.mockReset();
  __resetGoogleIntegrationOperationForTests();
});

describe("Google calendar sync and disconnect serialization", () => {
  it("aborts an in-flight Composio pull after disconnect and never resurrects pruned rows", async () => {
    const releasePull = deferred<unknown>();
    const store = pbMock();
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(store.pb));
    mocks.executeComposioAction.mockImplementation(async () => {
      await releasePull.promise;
      return {
        data: {
          items: [{
            id: "remote-1",
            status: "confirmed",
            summary: "Late event",
            start: { dateTime: "2026-09-25T10:00:00Z" },
            end: { dateTime: "2026-09-25T11:00:00Z" },
          }],
        },
        successful: true,
        error: null,
      };
    });

    const syncPromise = syncCalendar();
    await vi.waitFor(() => expect(mocks.executeComposioAction).toHaveBeenCalledTimes(1));

    // Disconnect path exactly as POST /api/google/composio/disconnect runs it:
    // snapshot first, then generation bump, then cache prune.
    await clearConnectionSnapshot();
    invalidateGoogleIntegrationOperation();
    await clearCalendarCache();

    expect(store.snapshotRows).toHaveLength(0);
    expect(store.eventRows).toHaveLength(0);
    const writesAtDisconnect = {
      eventCreates: store.writes.eventCreates.length,
      eventUpdates: store.writes.eventUpdates.length,
      calendarWrites: store.writes.calendarWrites.length,
    };

    releasePull.resolve(undefined);
    const outcome = await syncPromise;

    // The generation re-check after the pull must abort the run...
    expect(outcome).toEqual({ skipped: true, reason: "disconnected" });
    // ...so no event was upserted and no calendar/sync state was rewritten
    // after the disconnect (the pruned rows stay pruned).
    expect(store.writes.eventCreates).toHaveLength(writesAtDisconnect.eventCreates);
    expect(store.writes.eventUpdates).toHaveLength(writesAtDisconnect.eventUpdates);
    expect(store.writes.calendarWrites).toHaveLength(writesAtDisconnect.calendarWrites);
    expect(store.eventRows).toHaveLength(0);
  });
});
