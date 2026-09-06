import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("../../src/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import {
  ensureGoogleCollections,
  EVENTS_COMPOSITE_INDEX,
  LEGACY_EVENTS_INDEX_NAME,
} from "../../src/lib/google/pb-collections.ts";

const LEGACY_INDEX = `CREATE UNIQUE INDEX ${LEGACY_EVENTS_INDEX_NAME} ON consuela_google_calendar_events (google_id)`;
const FAMILY = "family@gmail.com";

const FIELDS: Record<string, string[]> = {
  consuela_google_tokens: ["access_token", "refresh_token", "scope", "token_type", "expires_at", "account_email", "granted_at", "revoked_at"],
  consuela_google_calendar_events: ["google_id", "calendar_id", "summary", "description", "location", "start_iso", "end_iso", "all_day", "etag", "html_link", "updated_remote", "source", "raw", "next_sync_token"],
  consuela_google_tasks: ["google_id", "tasklist_id", "title", "notes", "due", "status", "completed", "kind", "etag", "updated_remote", "raw", "source"],
  consuela_google_tasklists: ["google_id", "title", "owned_by_dashboard", "updated_remote"],
  consuela_google_sync_state: ["resource", "sync_token", "last_sync_at", "last_status", "last_error"],
  consuela_google_calendar_sync: ["calendar_id", "summary", "color_rgb", "selected", "sync_token", "last_sync_at", "last_status", "last_error"],
  consuela_google_api_usage: ["date", "count", "last_endpoint", "last_reset_at"],
  consuela_data_snapshots: ["key", "data", "updated_at"],
};

function metaCol(name: string, id: string, indexes: string[] = []) {
  return { id, name, indexes, fields: (FIELDS[name] || []).map((f) => ({ name: f })) };
}

function pbMock(opts: {
  cols: any[];
  eventRows?: any[];
  calRows?: any[];
  legacyRows?: any[];
}) {
  const calls = {
    colCreates: [] as any[],
    colUpdates: [] as any[],
    eventUpdates: [] as any[],
    eventDeletes: [] as string[],
    calCreates: [] as any[],
    calUpdates: [] as any[],
  };
  const pb = {
    collections: {
      getFullList: async () => opts.cols,
      create: async (rec: any) => {
        calls.colCreates.push(rec);
        return { id: "new-" + rec.name };
      },
      update: async (id: string, data: any) => {
        calls.colUpdates.push({ id, data });
        return {};
      },
    },
    collection: (name: string) => {
      if (name === "consuela_google_calendar_events") {
        return {
          getFullList: async () => opts.eventRows ?? [],
          update: async (id: string, payload: any) => {
            calls.eventUpdates.push({ id, payload });
            return {};
          },
          delete: async (id: string) => {
            calls.eventDeletes.push(id);
            return {};
          },
          create: async () => ({}),
        };
      }
      if (name === "consuela_google_calendar_sync") {
        return {
          getFullList: async () => opts.calRows ?? [],
          create: async (payload: any) => {
            calls.calCreates.push(payload);
            return { id: "nc" };
          },
          update: async (id: string, payload: any) => {
            calls.calUpdates.push({ id, payload });
            return {};
          },
        };
      }
      if (name === "consuela_google_sync_state") {
        return { getFullList: async () => opts.legacyRows ?? [] };
      }
      return {
        getFullList: async () => [],
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
      };
    },
  };
  return { pb, calls };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("ensureGoogleCollections — events index self-heal", () => {
  it("normalizes empty calendar_id, dedupes collisions, then swaps in the composite unique index", async () => {
    const { pb, calls } = pbMock({
      cols: [
        metaCol("consuela_google_calendar_events", "ev_col", [LEGACY_INDEX]),
        metaCol("consuela_google_calendar_sync", "cal_col"),
      ],
      eventRows: [
        { id: "r1", calendar_id: "", google_id: "g1" },
        { id: "r2", calendar_id: "primary", google_id: "g1" },
        { id: "r3", calendar_id: FAMILY, google_id: "g1" },
      ],
      calRows: [{ id: "c1", calendar_id: "primary" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const log = await ensureGoogleCollections();

    // 1. empty calendar_id normalized to "primary"
    expect(calls.eventUpdates).toEqual([{ id: "r1", payload: { calendar_id: "primary" } }]);
    // 2. the (primary, g1) collision is deduped — first row kept
    expect(calls.eventDeletes).toEqual(["r2"]);
    // 3. legacy single-column index dropped, composite unique added
    const idxUpdate = calls.colUpdates.find((u) => u.id === "ev_col");
    expect(idxUpdate).toBeTruthy();
    expect(idxUpdate.data.indexes).toEqual([EVENTS_COMPOSITE_INDEX]);
    expect(log.join("\n")).toContain("index healed");
  });

  it("is a no-op once the composite index exists (steady state)", async () => {
    const { pb, calls } = pbMock({
      cols: [
        metaCol("consuela_google_calendar_events", "ev_col", [EVENTS_COMPOSITE_INDEX]),
        metaCol("consuela_google_calendar_sync", "cal_col"),
      ],
      eventRows: [{ id: "r1", calendar_id: "primary", google_id: "g1" }],
      calRows: [{ id: "c1", calendar_id: "primary" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await ensureGoogleCollections();

    expect(calls.eventUpdates).toHaveLength(0);
    expect(calls.eventDeletes).toHaveLength(0);
    expect(calls.colUpdates.filter((u) => u.id === "ev_col")).toHaveLength(0);
  });

  it("fresh installs create the collection with the composite index straight away", async () => {
    const { pb, calls } = pbMock({ cols: [] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await ensureGoogleCollections();

    const eventsCreate = calls.colCreates.find((c) => c.name === "consuela_google_calendar_events");
    expect(eventsCreate.indexes).toEqual([EVENTS_COMPOSITE_INDEX]);
    // No heal attempted on a just-created collection
    expect(calls.colUpdates.find((u) => u.data?.indexes)).toBeUndefined();
  });
});

describe("ensureGoogleCollections — selection migration", () => {
  it("copies the legacy resource=calendar token onto a selected primary row", async () => {
    const { pb, calls } = pbMock({
      cols: [
        metaCol("consuela_google_calendar_events", "ev_col", [EVENTS_COMPOSITE_INDEX]),
        metaCol("consuela_google_calendar_sync", "cal_col"),
      ],
      calRows: [],
      legacyRows: [{ id: "s1", resource: "calendar", sync_token: "LEGACY_TOKEN" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await ensureGoogleCollections();

    expect(calls.calCreates).toHaveLength(1);
    expect(calls.calCreates[0]).toMatchObject({
      calendar_id: "primary",
      selected: true,
      sync_token: "LEGACY_TOKEN",
    });
  });

  it("does not re-migrate once selection rows exist", async () => {
    const { pb, calls } = pbMock({
      cols: [
        metaCol("consuela_google_calendar_events", "ev_col", [EVENTS_COMPOSITE_INDEX]),
        metaCol("consuela_google_calendar_sync", "cal_col"),
      ],
      calRows: [{ id: "c1", calendar_id: "primary", selected: true }],
      legacyRows: [{ id: "s1", resource: "calendar", sync_token: "LEGACY_TOKEN" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await ensureGoogleCollections();

    expect(calls.calCreates).toHaveLength(0);
  });
});
